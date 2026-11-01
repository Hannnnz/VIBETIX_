-- ══════════════════════════════════════════════════════════════════
--  VIBETIX complete database schema (Supabase / PostgreSQL)
--  Run this ONCE in Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────
-- 1 · PROFILES (extends Supabase auth.users with VIBETIX roles)
-- ──────────────────────────────────────────────────────────────────
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text not null unique,
  full_name     text not null default '',
  role          text not null default 'customer'
                check (role in ('admin', 'staff', 'customer')),
  -- staff managed account toggle (MS-Teams style join)
  joined        boolean not null default false,
  avatar_url    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Everyone can read profiles (name/role needed across the app).
create policy "profiles_select_authenticated"
  on public.profiles for select to authenticated using (true);

-- Users can update their own profile; admins can update anyone.
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id or exists (
    select 1 from public.profiles me
    where me.id = auth.uid() and me.role = 'admin'
  ));

-- Auto-create a profile row whenever a user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role, joined)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce(new.raw_user_meta_data->>'role', 'customer'),
    coalesce(new.raw_user_meta_data->>'role', 'customer') = 'customer'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper: is the caller an admin? (used everywhere below)
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Helper: is the caller a staff member or admin? (gate + team screens)
create or replace function public.is_staff_or_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('staff', 'admin')
  );
$$;

-- ──────────────────────────────────────────────────────────────────
-- 2 · COMPANY (admin's join code + team management)
-- ──────────────────────────────────────────────────────────────────
create table public.company_settings (
  id            integer primary key default 1 check (id = 1), -- singleton
  company_code  text not null unique default 'VIBETIX2026',
  company_name  text not null default 'VIBETIX',
  updated_at    timestamptz not null default now()
);

insert into public.company_settings (company_code) values ('VIBETIX2026');

alter table public.company_settings enable row level security;

-- Staff/customers can READ the join code (they need it to type it in),
-- only admins can change it.
create policy "company_read_all"
  on public.company_settings for select to authenticated using (true);

create policy "company_update_admin"
  on public.company_settings for update to authenticated using (public.is_admin());

-- Removed / banned accounts (admin blocklist for staff)
create table public.removed_accounts (
  email         text primary key,
  removed_by    uuid references public.profiles (id),
  created_at    timestamptz not null default now()
);

alter table public.removed_accounts enable row level security;
create policy "removed_select_admin"
  on public.removed_accounts for select to authenticated using (public.is_admin());
create policy "removed_manage_admin"
  on public.removed_accounts for all to authenticated using (public.is_admin());

-- Staff cannot re-register with a removed email.
create or replace function public.block_removed_email()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if exists (select 1 from public.removed_accounts where email = lower(new.email)) then
    raise exception 'This email was removed from the company.';
  end if;
  return new;
end;
$$;

create trigger prevent_removed_signup
  before insert on auth.users
  for each row execute function public.block_removed_email();

-- ──────────────────────────────────────────────────────────────────
-- 3 · CONCERTS + TICKET TIERS
-- ──────────────────────────────────────────────────────────────────
create table public.concerts (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  artist        text not null,
  genre         text not null default 'Various',
  venue         text not null,
  event_date    date not null,
  event_time    time not null default '20:00',
  base_price    numeric(10,2) not null check (base_price >= 0),
  description   text not null default '',
  image_url     text,
  rules         text,
  emoji         text not null default '🎤',
  color         smallint not null default 1 check (color between 1 and 6),
  status        text not null default 'published'
                check (status in ('draft', 'published', 'cancelled')),
  created_by    uuid references public.profiles (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index concerts_date_idx   on public.concerts (event_date);
create index concerts_genre_idx  on public.concerts (genre);
create index concerts_artist_idx on public.concerts (artist);

alter table public.concerts enable row level security;

create policy "concerts_read_all"
  on public.concerts for select
  to authenticated using (status <> 'draft' or public.is_admin() or created_by = auth.uid());

create policy "concerts_write_admin"
  on public.concerts for all to authenticated using (public.is_admin());

-- Tiers within a concert (Gen Ad / Upper Box / Lower Box / VIP / SVIP)
create table public.ticket_tiers (
  id            uuid primary key default gen_random_uuid(),
  concert_id    uuid not null references public.concerts (id) on delete cascade,
  name          text not null,
  multiplier    numeric(4,2) not null default 1.00, -- price = base × multiplier
  created_at    timestamptz not null default now(),
  unique (concert_id, name)
);

alter table public.ticket_tiers enable row level security;
create policy "tiers_read_all"     on public.ticket_tiers for select to authenticated using (true);
create policy "tiers_write_admin"  on public.ticket_tiers for all to authenticated using (public.is_admin());

-- Default tiers for every new concert.
create or replace function public.seed_default_tiers()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.ticket_tiers (concert_id, name, multiplier) values
    (new.id, 'Gen Ad',      1.00),
    (new.id, 'Upper Box',   1.25),
    (new.id, 'Lower Box',   1.50),
    (new.id, 'VIP',         2.00),
    (new.id, 'SVIP',        3.00);
  return new;
end;
$$;

create trigger concert_created_tiers
  after insert on public.concerts
  for each row execute function public.seed_default_tiers();

-- ──────────────────────────────────────────────────────────────────
-- 4 · BOOKINGS + SEATS
-- ──────────────────────────────────────────────────────────────────
create type booking_status as enum ('pending', 'paid', 'cancelled', 'refunded');

create table public.bookings (
  id              uuid primary key default gen_random_uuid(),
  ticket_code     text not null unique
                  default 'VTX-' ||
                          upper(substring(gen_random_uuid()::text from 1 for 6)) || '-' ||
                          lpad((random() * 9999)::int::text, 4, '0'),
  concert_id      uuid not null references public.concerts (id),
  customer_id     uuid not null references public.profiles (id),
  tier_id         uuid references public.ticket_tiers (id),
  tier_name       text not null default 'Gen Ad',
  unit_price      numeric(10,2) not null,
  quantity        int not null check (quantity between 1 and 6),
  total_amount    numeric(12,2) generated always as (unit_price * quantity) stored,
  status          booking_status not null default 'pending',
  paid_via        text not null default 'Unknown',
  -- masked payment reference only — NEVER store full card numbers/CVV
  payment_ref     text,
  created_at      timestamptz not null default now(),
  paid_at         timestamptz,
  -- set when staff scan the ticket at the gate (source of truth for "attended")
  checked_in_at   timestamptz
);

create index bookings_customer_idx on public.bookings (customer_id);
create index bookings_concert_idx  on public.bookings (concert_id);
create index bookings_status_idx   on public.bookings (status);

alter table public.bookings enable row level security;

-- customers read their own bookings
create policy "bookings_select_own_or_admin"
  on public.bookings for select to authenticated using (
    customer_id = auth.uid() or public.is_admin()
  );

-- customers may only CREATE pending bookings (payment webhook raises to 'paid')
create policy "bookings_insert_own_pending"
  on public.bookings for insert to authenticated with check (
    customer_id = auth.uid() and status = 'pending'
  );

create policy "bookings_update_admin_or_system"
  on public.bookings for update to authenticated using (
    public.is_admin() or (select auth.role() = 'service_role')
  );

create policy "bookings_delete_admin"
  on public.bookings for delete to authenticated using (public.is_admin());

-- Seat assignments (A4, C7 …) — one row per seat per booking
create table public.seats (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references public.bookings (id) on delete cascade,
  concert_id    uuid not null references public.concerts (id),
  seat_code     text not null, -- 'A4', 'D2', …
  -- NULL while a pending booking holds the seat in a temp hold;
  -- a seat is TAKEN when referenced by a PAID booking.
  created_at    timestamptz not null default now(),
  unique (concert_id, seat_code)
);

create index seats_concert_idx on public.seats (concert_id, seat_code);

alter table public.seats enable row level security;
create policy "seats_read_all"       on public.seats for select to authenticated using (true);
create policy "seats_insert_system"  on public.seats for insert to authenticated with check (true);
create policy "seats_delete_owner_or_admin"
  on public.seats for delete to authenticated using (
    public.is_admin() or exists (
      select 1 from public.bookings b
      where b.id = booking_id and b.customer_id = auth.uid()
    )
  );

-- ──────────────────────────────────────────────────────────────────
-- 5 · SAVED PAYMENT METHODS (masked references ONLY)
-- ──────────────────────────────────────────────────────────────────
create table public.payment_methods (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references public.profiles (id) on delete cascade,
  kind          text not null check (kind in ('gcash', 'card', 'play')),
  label         text not null,          -- e.g. 'Visa Debit'
  detail        text not null,          -- masked: '•••• 5299' / '+63 ••• 4021'
  meta          text,                   -- holder name / expiry
  verified_at   timestamptz,
  created_at    timestamptz not null default now()
);

alter table public.payment_methods enable row level security;

create policy "methods_select_own"
  on public.payment_methods for select to authenticated
  using (customer_id = auth.uid());

create policy "methods_manage_own"
  on public.payment_methods for all to authenticated
  using (customer_id = auth.uid());

-- ──────────────────────────────────────────────────────────────────
-- 6 · PAYMENTS (PayMongo-style intents + webhooks)
-- ──────────────────────────────────────────────────────────────────
create table public.payments (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references public.bookings (id),
  provider      text not null default 'paymongo'
                check (provider in ('paymongo', 'gcash', 'qr', 'play', 'card')),
  provider_ref  text,                            -- PaymentIntent / source id
  amount        numeric(12,2) not null,
  status        text not null default 'pending'
                check (status in ('pending', 'succeeded', 'failed', 'refunded')),
  receiver_tag  text not null default 'VTX-MERCH-PH',
  created_at    timestamptz not null default now(),
  settled_at    timestamptz
);

alter table public.payments enable row level security;
-- Users see their own payment records; the webhook runs as service_role.
create policy "payments_select_related"
  on public.payments for select to authenticated using (
    public.is_admin() or exists (
      select 1 from public.bookings b where b.id = payments.booking_id
      and b.customer_id = auth.uid()
    )
  );

-- When a payment succeeds → flip the booking to paid automatically.
create or replace function public.mark_booking_paid()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'succeeded' and (old.status is distinct from 'succeeded') then
    update public.bookings
      set status = 'paid', paid_via = new.provider, paid_at = now(),
          payment_ref = new.provider_ref
      where id = new.booking_id;
  end if;
  return new;
end;
$$;

create trigger payment_succeeded_confirm
  after update on public.payments
  for each row execute function public.mark_booking_paid();

-- ──────────────────────────────────────────────────────────────────
-- 7 · CHECK-INS (staff scanning tickets at the door)
-- ──────────────────────────────────────────────────────────────────
create table public.check_ins (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references public.bookings (id),
  concert_id    uuid not null references public.concerts (id),
  scanned_by    uuid not null references public.profiles (id), -- staff
  scanned_at    timestamptz not null default now(),
  unique (booking_id)               -- one entry per e-ticket
);

alter table public.check_ins enable row level security;

create policy "checkins_select_staff_or_admin"
  on public.check_ins for select to authenticated using (
    public.is_staff_or_admin()
  );

create policy "checkins_insert_staff"
  on public.check_ins for insert to authenticated with check (
    exists (
      select 1 from public.profiles p where p.id = auth.uid()
      and p.role in ('staff', 'admin')
    )
  );

-- Keep bookings.checked_in_at in sync with the gate log.
create or replace function public.mark_booking_checked_in()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    update public.bookings
       set checked_in_at = null
     where id = old.booking_id
       and not exists (
         select 1 from public.check_ins where booking_id = old.booking_id
       );
    return old;
  end if;
  update public.bookings
     set checked_in_at = coalesce(checked_in_at, new.scanned_at)
   where id = new.booking_id;
  return new;
end;
$$;

create trigger check_ins_mark_booking
  after insert or delete on public.check_ins
  for each row execute function public.mark_booking_checked_in();

-- Security-definer helper the app calls when RLS hides the door log.
create or replace function public.get_all_check_ins()
returns setof public.check_ins
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_staff_or_admin() then
    raise exception 'Not allowed.' using errcode = 'P0001';
  end if;
  return query select * from public.check_ins;
end;
$$;

grant execute on function public.get_all_check_ins() to authenticated;

-- ──────────────────────────────────────────────────────────────────
-- 8 · RECOMMENDATION ENGINE DATA (loves, views, purchases)
-- ──────────────────────────────────────────────────────────────────
create table public.concert_loves (
  user_id       uuid not null references public.profiles (id) on delete cascade,
  concert_id    uuid not null references public.concerts (id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (user_id, concert_id)
);

alter table public.concert_loves enable row level security;
create policy "loves_select_own"  on public.concert_loves for select to authenticated using (user_id = auth.uid());
create policy "loves_manage_own"  on public.concert_loves for all    to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.concert_views (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  concert_id    uuid not null references public.concerts (id) on delete cascade,
  viewed_at     timestamptz not null default now()
);

create index views_user_idx on public.concert_views (user_id, concert_id);

alter table public.concert_views enable row level security;
create policy "views_select_own"  on public.concert_views for select to authenticated using (user_id = auth.uid());
create policy "views_manage_own"  on public.concert_views for insert to authenticated with check (user_id = auth.uid());

-- ──────────────────────────────────────────────────────────────────
-- 9 · ARTICLE — updated_at helper
-- ──────────────────────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql
as $$ begin new.updated_at = now(); return new; end $$;

create trigger profiles_touch   before update on public.profiles  for each row execute function public.touch_updated_at();
create trigger concerts_touch   before update on public.concerts  for each row execute function public.touch_updated_at();
create trigger company_touch    before update on public.company_settings for each row execute function public.touch_updated_at();

-- ══════════════════════════════════════════════════════════════════
-- DONE. Tables: profiles · company_settings · removed_accounts ·
-- concerts · ticket_tiers · bookings · seats · payment_methods ·
-- payments · check_ins · concert_loves · concert_views
-- ══════════════════════════════════════════════════════════════════

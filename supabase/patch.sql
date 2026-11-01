-- ══════════════════════════════════════════════════════════════════
--  VIBETIX patch script — run ONCE in Supabase → SQL Editor
--  Safe to run even if you already ran other SQL.
--  1) Ensures all Row Level Security policies exist
--  2) Creates the backend RPC functions the app calls:
--       • place_booking()      — race-proof seat booking
--       • check_in_ticket()    — staff gate scanning
-- ══════════════════════════════════════════════════════════════════

-- ── Helper: admin? ────────────────────────────────────────────────
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- ── Helper: staff or admin? ───────────────────────────────────────
create or replace function public.is_staff_or_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('staff', 'admin')
  );
$$;

-- ── Gate check-in source of truth (see supabase/fix-checkins.sql) ─
alter table public.bookings
  add column if not exists checked_in_at timestamptz;

-- ── Helper: keep updated_at fresh ─────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql
as $$ begin new.updated_at = now(); return new; end $$;

-- ── Auto-profile on signup ────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role, joined)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    -- SECURITY: self-registered users can never claim admin; admins are
    -- promoted from the SQL editor / dashboard only.
    case
      when coalesce(new.raw_user_meta_data->>'role', 'customer') = 'staff'
        then 'staff'
      else 'customer'
    end,
    -- customers are instantly part of the "audience"; staff must join
    coalesce(new.raw_user_meta_data->>'role', 'customer') = 'customer'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Auto tiers on concert creation ────────────────────────────────
create or replace function public.seed_default_tiers()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.ticket_tiers (concert_id, name, multiplier) values
    (new.id, 'Gen Ad',    1.00),
    (new.id, 'Upper Box', 1.25),
    (new.id, 'Lower Box', 1.50),
    (new.id, 'VIP',       2.00),
    (new.id, 'SVIP',      3.00);
  return new;
end;
$$;

drop trigger if exists concert_created_tiers on public.concerts;
create trigger concert_created_tiers
  after insert on public.concerts
  for each row execute function public.seed_default_tiers();

-- Payment success → booking paid (in case schema.sql wasn't fully run)
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

-- ══════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (drop-if-exists → create, fully idempotent)
-- ══════════════════════════════════════════════════════════════════

alter table public.profiles         enable row level security;
alter table public.company_settings enable row level security;
alter table public.removed_accounts enable row level security;
alter table public.concerts         enable row level security;
alter table public.ticket_tiers     enable row level security;
alter table public.bookings         enable row level security;
alter table public.seats            enable row level security;
alter table public.payment_methods  enable row level security;
alter table public.payments         enable row level security;
alter table public.check_ins        enable row level security;
alter table public.concert_loves    enable row level security;
alter table public.concert_views    enable row level security;

-- profiles
drop policy if exists profiles_select_authenticated on public.profiles;
create policy "profiles_select_authenticated"
  on public.profiles for select to authenticated using (true);

drop policy if exists profiles_update_own on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update to authenticated
  using (auth.uid() = id or public.is_admin());

-- company settings: everyone reads the join code, only admin changes it
drop policy if exists company_read_all on public.company_settings;
create policy "company_read_all"
  on public.company_settings for select to authenticated using (true);

drop policy if exists company_update_admin on public.company_settings;
create policy "company_update_admin"
  on public.company_settings for update to authenticated using (public.is_admin());

-- removed accounts: admin only
drop policy if exists removed_select_admin on public.removed_accounts;
create policy "removed_select_admin"
  on public.removed_accounts for select to authenticated using (public.is_admin());

drop policy if exists removed_manage_admin on public.removed_accounts;
create policy "removed_manage_admin"
  on public.removed_accounts for all to authenticated using (public.is_admin());

-- concerts
drop policy if exists concerts_read_all on public.concerts;
create policy "concerts_read_all"
  on public.concerts for select to authenticated
  using (status <> 'draft' or public.is_admin() or created_by = auth.uid());

drop policy if exists concerts_manage_admin on public.concerts;
create policy "concerts_manage_admin"
  on public.concerts for all to authenticated using (public.is_admin());

-- ticket tiers
drop policy if exists tiers_read_all on public.ticket_tiers;
create policy "tiers_read_all"
  on public.ticket_tiers for select to authenticated using (true);

drop policy if exists tiers_write_admin on public.ticket_tiers;
create policy "tiers_write_admin"
  on public.ticket_tiers for all to authenticated using (public.is_admin());

-- bookings
drop policy if exists bookings_select_own_or_admin on public.bookings;
create policy "bookings_select_own_or_admin"
  on public.bookings for select to authenticated using (
    customer_id = auth.uid() or public.is_admin()
    -- staff can read bookings to run the door (in reality limited via rpc)
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('staff','admin'))
  );

drop policy if exists bookings_insert_own on public.bookings;
create policy "bookings_insert_own"
  on public.bookings for insert to authenticated with check (
    customer_id = auth.uid() and status = 'pending'
  );

drop policy if exists bookings_update_admin_or_system on public.bookings;
create policy "bookings_update_admin_or_system"
  on public.bookings for update to authenticated using (
    public.is_admin() or (select auth.role() = 'service_role')
  );

drop policy if exists bookings_delete_admin on public.bookings;
create policy "bookings_delete_admin"
  on public.bookings for delete to authenticated using (public.is_admin());

-- seats
drop policy if exists seats_read_all on public.seats;
create policy "seats_read_all"
  on public.seats for select to authenticated using (true);

-- (insertions happen through place_booking rpc as definer)

-- payment methods
drop policy if exists methods_select_own on public.payment_methods;
create policy "methods_select_own"
  on public.payment_methods for select to authenticated
  using (customer_id = auth.uid());

drop policy if exists methods_manage_own on public.payment_methods;
create policy "methods_manage_own"
  on public.payment_methods for all to authenticated
  using (customer_id = auth.uid());

-- payments: read only (webhook/service-role writes)
drop policy if exists payments_select_related on public.payments;
create policy "payments_select_related"
  on public.payments for select to authenticated using (
    public.is_admin() or exists (
      select 1 from public.bookings b where b.id = payments.booking_id
      and b.customer_id = auth.uid()
    )
  );

-- check-ins
drop policy if exists checkins_select_staff_or_admin on public.check_ins;
create policy "checkins_select_staff_or_admin"
  on public.check_ins for select to authenticated using (
    public.is_staff_or_admin()
  );

drop policy if exists checkins_insert_staff on public.check_ins;
create policy "checkins_insert_staff"
  on public.check_ins for insert to authenticated with check (
    exists (
      select 1 from public.profiles p where p.id = auth.uid()
      and p.role in ('staff', 'admin')
    )
  );

-- recommendation data
drop policy if exists loves_select_own on public.concert_loves;
create policy "loves_select_own"
  on public.concert_loves for select to authenticated using (user_id = auth.uid());

drop policy if exists loves_manage_own on public.concert_loves;
create policy "loves_manage_own"
  on public.concert_loves for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists views_select_own on public.concert_views;
create policy "views_select_own"
  on public.concert_views for select to authenticated using (user_id = auth.uid());

drop policy if exists views_insert_own on public.concert_views;
create policy "views_insert_own"
  on public.concert_views for insert to authenticated with check (user_id = auth.uid());

-- updated_at triggers
drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists concerts_touch on public.concerts;
create trigger concerts_touch before update on public.concerts
  for each row execute function public.touch_updated_at();

-- ══════════════════════════════════════════════════════════════════
-- RPC · place_booking — the real money path
-- ══════════════════════════════════════════════════════════════════
create or replace function public.place_booking(
  p_concert_id uuid,
  p_tier_id uuid,
  p_tier_name text,
  p_seat_codes text[],
  p_paid_via text
)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_concert public.concerts%rowtype;
  v_tier public.ticket_tiers%rowtype;
  v_booking public.bookings%rowtype;
  v_unit numeric;
  v_code text;
  v_seat text;
begin
  if v_user is null then
    raise exception 'Sign in first.' using errcode = 'P0001';
  end if;

  select * into v_concert from public.concerts where id = p_concert_id;
  if not found then
    raise exception 'Concert not found.' using errcode = 'P0001';
  end if;

  -- Resolve tier & charge the SERVER-computed price (never trust the client)
  if p_tier_id is not null then
    select * into v_tier from public.ticket_tiers where id = p_tier_id;
  else
    select * into v_tier from public.ticket_tiers
      where concert_id = p_concert_id and name = p_tier_name limit 1;
  end if;
  if not found then
    raise exception 'Ticket tier not found.' using errcode = 'P0001';
  end if;
  v_unit := round(v_concert.base_price * v_tier.multiplier * 100) / 100.0;

  if coalesce(array_length(p_seat_codes, 1), 0) < 1
     or array_length(p_seat_codes, 1) > 6 then
    raise exception 'Pick between 1 and 6 seats.' using errcode = 'P0001';
  end if;

  -- Seat race protection: the unique(concert_id, seat_code) constraint
  -- makes double-selling IMPOSSIBLE at the database level.
  insert into public.bookings (
    concert_id, customer_id, tier_id, tier_name,
    unit_price, quantity, status, paid_via, paid_at
  ) values (
    p_concert_id, v_user, v_tier.id, v_tier.name,
    v_unit, array_length(p_seat_codes, 1), 'paid',
    coalesce(p_paid_via, 'Unknown'), now()
  )
  returning * into v_booking;

  begin
    foreach v_seat in array p_seat_codes loop
      insert into public.seats (booking_id, concert_id, seat_code)
      values (v_booking.id, p_concert_id, upper(trim(v_seat)));
    end loop;
  exception when others then
    delete from public.seats where booking_id = v_booking.id;
    delete from public.bookings where id = v_booking.id;
    raise exception 'Seat already taken or invalid — pick again friendly!'
      using errcode = 'P0001';
  end;

  return json_build_object(
    'id', v_booking.id,
    'ticket_code', v_booking.ticket_code,
    'tier', v_booking.tier_name,
    'unit_price', v_booking.unit_price,
    'quantity', v_booking.quantity,
    'total', v_booking.total_amount,
    'paid_via', v_booking.paid_via,
    'created_at', v_booking.created_at,
    'seats', p_seat_codes
  );
end;
$$;

grant execute on function public.place_booking(uuid, uuid, text, text[], text)
  to authenticated;

-- ══════════════════════════════════════════════════════════════════
-- RPC · check_in_ticket — staff gate scanning
-- ══════════════════════════════════════════════════════════════════
create or replace function public.check_in_ticket(
  p_ticket_code text
)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_me public.profiles%rowtype;
  v_booking public.bookings%rowtype;
  v_concert public.concerts%rowtype;
  v_seats text[];
  v_seat record;
begin
  select * into v_me from public.profiles where id = v_user;
  if not found or (v_me.role not in ('staff', 'admin')) then
    raise exception 'Only staff can check in tickets.' using errcode = 'P0001';
  end if;
  if v_me.role = 'staff' and not v_me.joined then
    raise exception 'Join the company first.' using errcode = 'P0001';
  end if;

  select * into v_booking from public.bookings
    where upper(ticket_code) = upper(trim(p_ticket_code));
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_booking.status <> 'paid' then
    raise exception 'NOT_PAID' using errcode = 'P0001';
  end if;

  select * into v_concert from public.concerts where id = v_booking.concert_id;

  begin
    insert into public.check_ins (booking_id, concert_id, scanned_by)
    values (v_booking.id, v_booking.concert_id, v_user);
  exception when unique_violation then
    raise exception 'ALREADY_USED' using errcode = 'P0001';
  end;

  update public.bookings
     set checked_in_at = coalesce(checked_in_at, now())
   where id = v_booking.id;

  v_seats := '{}';
  for v_seat in
    select seat_code from public.seats where booking_id = v_booking.id
      order by seat_code
  loop
    v_seats := array_append(v_seats, v_seat.seat_code);
  end loop;

  return json_build_object(
    'ticket_code', v_booking.ticket_code,
    'customer', v_booking.customer_id,
    'tier', v_booking.tier_name,
    'quantity', v_booking.quantity,
    'concert', v_concert.name,
    'venue', v_concert.venue,
    'seats', v_seats,
    'status', 'checked-in'
  );
end;
$$;

grant execute on function public.check_in_ticket(text) to authenticated;

-- ══════════════════════════════════════════════════════════════════
-- DONE — Run this once. Then the app's services can call:
--   supabase.rpc('place_booking', {...})
--   supabase.rpc('check_in_ticket', { p_ticket_code: 'VTX-xxxx' })
-- ══════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════════
--  VIBETIX — checkout fix (run ONCE in Supabase → SQL Editor)
--  Project: https://vtocnpgguwggpgvvylzn.supabase.co
--
--  WHY: the app calls the `place_booking` / `check_in_ticket` RPCs, but
--  they were never created in this project. Every checkout therefore
--  failed and the UI showed "Seat conflict or payment issue".
--  The same file also fixes the payment_methods RLS policies (the
--  "Add payment method" screen used to fail with 42501).
--
--  This script is idempotent — safe to run again at any time.
-- ══════════════════════════════════════════════════════════════════

-- ── Read policies used by the seat map / tiers ────────────────────
alter table public.seats         enable row level security;
alter table public.ticket_tiers  enable row level security;

drop policy if exists seats_read_all on public.seats;
create policy "seats_read_all"
  on public.seats for select to authenticated using (true);

drop policy if exists tiers_read_all on public.ticket_tiers;
create policy "tiers_read_all"
  on public.ticket_tiers for select to authenticated using (true);

-- ── Saved payment methods: owner-only CRUD ────────────────────────
--  The live table had SELECT allowed but no usable INSERT policy, so
--  "Add payment method" failed with 42501 (row-level security).
alter table public.payment_methods enable row level security;

grant select, insert, update, delete on public.payment_methods to authenticated;

drop policy if exists methods_manage_own on public.payment_methods;
drop policy if exists methods_select_own on public.payment_methods;
drop policy if exists methods_insert_own on public.payment_methods;
drop policy if exists methods_update_own on public.payment_methods;
drop policy if exists methods_delete_own on public.payment_methods;

create policy "methods_select_own"
  on public.payment_methods for select to authenticated
  using (customer_id = auth.uid());

create policy "methods_insert_own"
  on public.payment_methods for insert to authenticated
  with check (customer_id = auth.uid());

create policy "methods_update_own"
  on public.payment_methods for update to authenticated
  using (customer_id = auth.uid())
  with check (customer_id = auth.uid());

create policy "methods_delete_own"
  on public.payment_methods for delete to authenticated
  using (customer_id = auth.uid());

-- ── Drop old variants (arg names/return types may have drifted) ────
drop function if exists public.place_booking(uuid, uuid, text, text[], text);
drop function if exists public.check_in_ticket(text);

-- ══════════════════════════════════════════════════════════════════
--  place_booking — race-proof seat booking, server-computed price
-- ══════════════════════════════════════════════════════════════════
create or replace function public.place_booking(
  p_concert_id uuid,
  p_tier_id uuid,
  p_tier_name text,
  p_seat_codes text[],
  p_paid_via text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user    uuid := auth.uid();
  v_concert public.concerts%rowtype;
  v_tier    public.ticket_tiers%rowtype;
  v_booking public.bookings%rowtype;
  v_unit    numeric;
  v_seats   text[];
  v_seat    text;
begin
  if v_user is null then
    raise exception 'Sign in first.' using errcode = 'P0001';
  end if;

  select * into v_concert from public.concerts where id = p_concert_id;
  if not found then
    raise exception 'Concert not found.' using errcode = 'P0001';
  end if;

  -- Resolve the tier for THIS concert and charge the server-side price.
  if p_tier_id is not null then
    select * into v_tier
      from public.ticket_tiers
      where id = p_tier_id and concert_id = p_concert_id;
  else
    select * into v_tier
      from public.ticket_tiers
      where concert_id = p_concert_id and name = p_tier_name
      limit 1;
  end if;
  if not found then
    raise exception 'Ticket tier not found.' using errcode = 'P0001';
  end if;
  v_unit := round(v_concert.base_price * v_tier.multiplier * 100) / 100.0;

  -- Normalise + de-duplicate the requested seats.
  select array_agg(distinct upper(trim(s)))
    into v_seats
    from unnest(coalesce(p_seat_codes, '{}')) as s
    where trim(s) <> '';

  if coalesce(array_length(v_seats, 1), 0) < 1
     or array_length(v_seats, 1) > 6 then
    raise exception 'Pick between 1 and 6 seats.' using errcode = 'P0001';
  end if;

  -- Create the paid booking (security definer → bypasses the
  -- "insert pending only" RLS rule, price is never trusted from the client).
  insert into public.bookings (
    concert_id, customer_id, tier_id, tier_name,
    unit_price, quantity, status, paid_via, paid_at
  ) values (
    p_concert_id, v_user, v_tier.id, v_tier.name,
    v_unit, array_length(v_seats, 1), 'paid',
    coalesce(nullif(trim(p_paid_via), ''), 'Unknown'), now()
  )
  returning * into v_booking;

  -- unique(concert_id, seat_code) makes double-selling impossible.
  begin
    foreach v_seat in array v_seats loop
      insert into public.seats (booking_id, concert_id, seat_code)
      values (v_booking.id, p_concert_id, v_seat);
    end loop;
  exception when others then
    raise exception 'Seat already taken — pick another seat.' using errcode = 'P0001';
  end;

  return json_build_object(
    'id',          v_booking.id,
    'ticket_code', v_booking.ticket_code,
    'tier',        v_booking.tier_name,
    'unit_price',  v_booking.unit_price,
    'quantity',    v_booking.quantity,
    'total',       v_booking.total_amount,
    'paid_via',    v_booking.paid_via,
    'created_at',  v_booking.created_at,
    'seats',       v_seats
  );
end;
$$;

grant execute on function public.place_booking(uuid, uuid, text, text[], text)
  to authenticated;

-- ══════════════════════════════════════════════════════════════════
--  check_in_ticket — staff gate scanning (one entry per ticket)
-- ══════════════════════════════════════════════════════════════════
create or replace function public.check_in_ticket(
  p_ticket_code text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user    uuid := auth.uid();
  v_me      public.profiles%rowtype;
  v_booking public.bookings%rowtype;
  v_concert public.concerts%rowtype;
  v_seats   text[];
  v_seat    record;
begin
  select * into v_me from public.profiles where id = v_user;
  if not found or v_me.role not in ('staff', 'admin') then
    raise exception 'Only staff can check in tickets.' using errcode = 'P0001';
  end if;
  if v_me.role = 'staff' and not v_me.joined then
    raise exception 'Join the company first.' using errcode = 'P0001';
  end if;

  select * into v_booking
    from public.bookings
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

  select array_agg(seat_code order by seat_code)
    into v_seats
    from public.seats
    where booking_id = v_booking.id;

  return json_build_object(
    'ticket_code', v_booking.ticket_code,
    'customer',    v_booking.customer_id,
    'tier',        v_booking.tier_name,
    'quantity',    v_booking.quantity,
    'concert',     v_concert.name,
    'venue',       v_concert.venue,
    'seats',       coalesce(v_seats, '{}'),
    'status',      'checked-in'
  );
end;
$$;

grant execute on function public.check_in_ticket(text) to authenticated;

-- ── Read helpers that bypass RLS (used by the app as a fallback) ──
create or replace function public.get_my_bookings()
returns setof public.bookings
language sql security definer set search_path = public
as $$
  select * from public.bookings where customer_id = auth.uid();
$$;

create or replace function public.get_all_bookings()
returns setof public.bookings
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles where id = auth.uid() and role in ('admin', 'staff')
  ) then
    raise exception 'Not allowed.' using errcode = 'P0001';
  end if;
  return query select * from public.bookings;
end;
$$;

grant execute on function public.get_my_bookings() to authenticated;
grant execute on function public.get_all_bookings() to authenticated;

-- ── Make PostgREST see the new functions immediately ──────────────
notify pgrst, 'reload schema';

-- Confirm everything now exists (4 policies + 2 functions expected):
select 'policy' as kind, policyname as name, cmd as detail
from pg_policies
where schemaname = 'public' and tablename = 'payment_methods'
union all
select 'function', proname, pg_get_function_identity_arguments(oid)
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('place_booking', 'check_in_ticket')
order by 1, 2;

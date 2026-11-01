-- ══════════════════════════════════════════════════════════════════
--  VIBETIX — checked-in fix (run ONCE in Supabase → SQL Editor)
--  Project: https://vtocnpgguwggpgvvylzn.supabase.co
--
--  WHY: the staff dashboard read `check_ins` directly, but its SELECT
--  policy only allowed rows whose `scanned_by` matched the signed-in
--  user. Gate scans made by another staff session therefore came back
--  as [] and the dashboard showed 0 checked-in tickets even though the
--  table already had 6 rows.
--
--  WHAT THIS DOES
--   1. adds bookings.checked_in_at (one source of truth for "attended")
--   2. backfills it from the existing check_ins rows
--   3. keeps it in sync with a trigger on check_ins
--   4. replaces check_in_ticket() so every gate scan stamps it too
--   5. lets every staff/admin read the whole check_ins table
--   6. adds the security-definer get_all_check_ins() RPC
--   7. enables realtime push for check_ins
--
--  This script is idempotent — safe to run again at any time.
-- ══════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────
-- 1 · One column the whole app can trust
-- ──────────────────────────────────────────────────────────────────
alter table public.bookings
  add column if not exists checked_in_at timestamptz;

-- ──────────────────────────────────────────────────────────────────
-- 2 · Backfill from gate scans already recorded
-- ──────────────────────────────────────────────────────────────────
update public.bookings b
   set checked_in_at = ci.scanned_at
  from public.check_ins ci
 where ci.booking_id = b.id
   and b.checked_in_at is null;

-- ──────────────────────────────────────────────────────────────────
-- 3 · Keep the column in sync whenever check_ins change
-- ──────────────────────────────────────────────────────────────────
create or replace function public.mark_booking_checked_in()
returns trigger
language plpgsql
security definer
set search_path = public
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

drop trigger if exists check_ins_mark_booking on public.check_ins;
create trigger check_ins_mark_booking
  after insert or delete on public.check_ins
  for each row execute function public.mark_booking_checked_in();

-- ──────────────────────────────────────────────────────────────────
-- 4 · Gate scans now stamp the booking row too
-- ──────────────────────────────────────────────────────────────────
-- Drop first so an older argument name can never block the replace.
drop function if exists public.check_in_ticket(text);

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

  update public.bookings
     set checked_in_at = coalesce(checked_in_at, now())
   where id = v_booking.id;

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

-- ──────────────────────────────────────────────────────────────────
-- 5 · Staff/admin helpers + fixed SELECT policy
-- ──────────────────────────────────────────────────────────────────
create or replace function public.is_staff_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('staff', 'admin')
  );
$$;

alter table public.check_ins enable row level security;

grant select, insert on public.check_ins to authenticated;

-- Remove every policy on the table first, so an older restrictive policy
-- with a different name can never keep hiding the door log.
do $$
declare
  pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'check_ins'
  loop
    execute format('drop policy if exists %I on public.check_ins', pol.policyname);
  end loop;
end $$;

-- Every staff member (not only the one who scanned) and every admin can
-- read the full door log.
create policy "checkins_select_staff_or_admin"
  on public.check_ins for select to authenticated
  using (public.is_staff_or_admin());

create policy "checkins_insert_staff"
  on public.check_ins for insert to authenticated
  with check (public.is_staff_or_admin());

-- ──────────────────────────────────────────────────────────────────
-- 6 · RPC the app uses as a fallback (bypasses RLS safely)
-- ──────────────────────────────────────────────────────────────────
create or replace function public.get_all_check_ins()
returns setof public.check_ins
language plpgsql
security definer
set search_path = public
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
-- 7 · Realtime push for gate scans (skip if already published)
-- ──────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'check_ins'
     ) then
    alter publication supabase_realtime add table public.check_ins;
  end if;
end $$;

-- Make PostgREST pick up the new column + functions immediately.
notify pgrst, 'reload schema';

-- ──────────────────────────────────────────────────────────────────
-- Verify: every scanned ticket should now carry checked_in_at.
-- ──────────────────────────────────────────────────────────────────
select b.ticket_code, b.checked_in_at, ci.scanned_at
from public.bookings b
left join public.check_ins ci on ci.booking_id = b.id
order by ci.scanned_at desc nulls last;

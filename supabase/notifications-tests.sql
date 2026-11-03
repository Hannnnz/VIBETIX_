-- ══════════════════════════════════════════════════════════════════
--  VIBETIX — notifications test suite (Supabase → SQL Editor)
--
--  Runs entirely inside ONE transaction and ROLLS BACK, so it never
--  leaves test bookings/notifications behind.
--
--  Requires: notifications.sql + device-tokens.sql have been applied.
--  Run this whole file. If everything passes it prints "ALL TESTS PASSED".
--
--  Scenarios covered:
--    1. Buying a ticket → 1 customer notification + 1 per admin
--    2. Marking the same ticket ATTENDED twice → exactly 1 check-in
--    3. Reminder: event 23h away → 1; run again → still 1;
--       event 48h away → 0; cancelled ticket → 0
--    4. RLS: cannot read/update/delete another user's notifications
--       or device tokens; cannot insert notifications from the client
-- ══════════════════════════════════════════════════════════════════

begin;

create temp table if not exists notif_test (
  customer_id uuid,
  admin_id    uuid,
  concert_id  uuid,
  booking_a   uuid,
  booking_b   uuid,
  seat_suffix text
) on commit drop;

-- ──────────────────────────────────────────────────────────────────
-- Setup (runs as the SQL editor / postgres; triggers are deferred)
-- ──────────────────────────────────────────────────────────────────
do $$
declare
  v_customer uuid;
  v_admin    uuid;
  v_concert  uuid;
  v_booking_a uuid;
  v_booking_b uuid;
  v_suffix   text;
begin
  -- Any two distinct profiles: prefer a customer + an admin.
  select id into v_customer from public.profiles where role = 'customer'
   order by created_at limit 1;
  if v_customer is null then
    select id into v_customer from public.profiles order by created_at limit 1;
  end if;

  select id into v_admin from public.profiles
   where role = 'admin' and id <> v_customer
   order by created_at limit 1;
  if v_admin is null then
    select id into v_admin from public.profiles where id <> v_customer
     order by created_at limit 1;
  end if;

  if v_customer is null then
    raise exception 'TEST SETUP: create at least one auth user/profile first.';
  end if;

  select id into v_concert from public.concerts order by event_date limit 1;
  if v_concert is null then
    insert into public.concerts
      (name, artist, venue, event_date, event_time, base_price, status)
    values
      ('Notification Test Event', 'Tester', 'Test Venue',
       current_date + 7, '20:00', 100, 'published')
    returning id into v_concert;
  end if;

  v_suffix := substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);

  insert into public.bookings
    (concert_id, customer_id, tier_name, unit_price, quantity, status, paid_via)
  values
    (v_concert, v_customer, 'Gen Ad', 100, 2, 'paid', 'Test')
  returning id into v_booking_a;

  insert into public.seats (booking_id, concert_id, seat_code)
  values
    (v_booking_a, v_concert, 'T' || v_suffix || 'A'),
    (v_booking_a, v_concert, 'T' || v_suffix || 'B');

  insert into public.bookings
    (concert_id, customer_id, tier_name, unit_price, quantity, status, paid_via)
  values
    (v_concert, v_customer, 'VIP', 200, 1, 'paid', 'Test')
  returning id into v_booking_b;

  insert into public.seats (booking_id, concert_id, seat_code)
  values (v_booking_b, v_concert, 'T' || v_suffix || 'C');

  insert into notif_test
    (customer_id, admin_id, concert_id, booking_a, booking_b, seat_suffix)
  values
    (v_customer, v_admin, v_concert, v_booking_a, v_booking_b, v_suffix);
end $$;

-- The booking insert trigger is DEFERRED so it can read the seat rows.
set constraints all immediate;

-- ──────────────────────────────────────────────────────────────────
-- 1 + 2 · Booking confirmation, admin fan-out, check-in once
-- ──────────────────────────────────────────────────────────────────
do $$
declare
  t          notif_test;
  v_admin_count int;
  v_n        int;
begin
  select * into t from notif_test;

  select count(*) into v_admin_count from public.profiles where role = 'admin';

  select count(*) into v_n from public.notifications
   where user_id = t.customer_id
     and ticket_id = t.booking_a
     and type = 'booking_confirmed';
  if v_n <> 1 then
    raise exception 'TEST 1 FAILED: booking_confirmed = % (expected 1)', v_n;
  end if;

  select count(*) into v_n from public.notifications
   where ticket_id = t.booking_a and type = 'new_booking';
  if v_n <> v_admin_count then
    raise exception 'TEST 1 FAILED: new_booking = % (expected % admins)',
      v_n, v_admin_count;
  end if;

  -- Mark attended twice.
  update public.bookings set checked_in_at = now() where id = t.booking_a;
  update public.bookings set checked_in_at = coalesce(checked_in_at, now())
   where id = t.booking_a;

  select count(*) into v_n from public.notifications
   where user_id = t.customer_id
     and ticket_id = t.booking_a
     and type = 'checked_in';
  if v_n <> 1 then
    raise exception 'TEST 2 FAILED: checked_in = % (expected 1)', v_n;
  end if;

  raise notice 'PASS: booking confirmation + admin fan-out + single check-in';
end $$;

-- ──────────────────────────────────────────────────────────────────
-- 3 · Reminder job
-- ──────────────────────────────────────────────────────────────────
do $$
declare
  t       notif_test;
  v_start timestamptz;
  v_n     int;
begin
  select * into t from notif_test;

  -- Event 23 hours away (Asia/Manila), only booking_b is not checked in.
  v_start := now() + interval '23 hours';
  update public.concerts
     set event_date = (v_start at time zone 'Asia/Manila')::date,
         event_time = (v_start at time zone 'Asia/Manila')::time,
         timezone   = 'Asia/Manila',
         status     = 'published'
   where id = t.concert_id;

  delete from public.notifications
   where type = 'event_reminder' and ticket_id in (t.booking_a, t.booking_b);

  perform public.create_event_reminders();

  select count(*) into v_n from public.notifications
   where ticket_id = t.booking_b and type = 'event_reminder';
  if v_n <> 1 then
    raise exception 'TEST 3 FAILED: reminder for event 23h away = % (expected 1)', v_n;
  end if;

  -- Running the job again must not duplicate it.
  perform public.create_event_reminders();
  select count(*) into v_n from public.notifications
   where ticket_id = t.booking_b and type = 'event_reminder';
  if v_n <> 1 then
    raise exception 'TEST 3 FAILED: reminder duplicated (= %)', v_n;
  end if;

  -- Event 48 hours away → no reminder.
  v_start := now() + interval '48 hours';
  update public.concerts
     set event_date = (v_start at time zone 'Asia/Manila')::date,
         event_time = (v_start at time zone 'Asia/Manila')::time
   where id = t.concert_id;
  delete from public.notifications
   where type = 'event_reminder' and ticket_id = t.booking_b;
  perform public.create_event_reminders();
  select count(*) into v_n from public.notifications
   where ticket_id = t.booking_b and type = 'event_reminder';
  if v_n <> 0 then
    raise exception 'TEST 3 FAILED: reminder for event 48h away = % (expected 0)', v_n;
  end if;

  -- Cancelled ticket 23h away → no reminder.
  v_start := now() + interval '23 hours';
  update public.concerts
     set event_date = (v_start at time zone 'Asia/Manila')::date,
         event_time = (v_start at time zone 'Asia/Manila')::time
   where id = t.concert_id;
  update public.bookings set status = 'cancelled' where id = t.booking_b;
  delete from public.notifications
   where type = 'event_reminder' and ticket_id = t.booking_b;
  perform public.create_event_reminders();
  select count(*) into v_n from public.notifications
   where ticket_id = t.booking_b and type = 'event_reminder';
  if v_n <> 0 then
    raise exception 'TEST 3 FAILED: cancelled ticket got a reminder (= %)', v_n;
  end if;

  raise notice 'PASS: reminder window + no duplicates + cancelled skipped';
end $$;

-- ──────────────────────────────────────────────────────────────────
-- 4 · RLS — act as the customer
-- ──────────────────────────────────────────────────────────────────
select set_config('test.customer', (select customer_id::text from notif_test), true);
select set_config('test.other', (select admin_id::text from notif_test), true);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', current_setting('test.customer'),
    'role', 'authenticated'
  )::text,
  true
);

do $$
declare
  v_other uuid := current_setting('test.other')::uuid;
  v_me    uuid := current_setting('test.customer')::uuid;
  v_n     int;
  v_ok    boolean;
  v_token text := 'test-token-' || replace(gen_random_uuid()::text, '-', '');
begin
  -- Can read own rows.
  select count(*) into v_n from public.notifications where user_id = v_me;
  if v_n = 0 then
    raise exception 'TEST 4 FAILED: user cannot read their own notifications';
  end if;

  -- Cannot see anyone else's.
  select count(*) into v_n from public.notifications where user_id <> v_me;
  if v_n <> 0 then
    raise exception 'TEST 4 FAILED: user can see % foreign notification(s)', v_n;
  end if;

  -- Cannot mark someone else's row read.
  update public.notifications set read_at = now() where user_id = v_other;
  if found then
    raise exception 'TEST 4 FAILED: user updated a foreign notification';
  end if;

  -- Cannot delete someone else's row.
  delete from public.notifications where user_id = v_other;
  if found then
    raise exception 'TEST 4 FAILED: user deleted a foreign notification';
  end if;

  -- Cannot INSERT a notification (server-only).
  v_ok := false;
  begin
    insert into public.notifications (user_id, type, title, body)
    values (v_me, 'booking_confirmed', 'Forged', 'Should never persist');
    v_ok := true;
  exception when others then
    v_ok := false;
  end;
  if v_ok then
    raise exception 'TEST 4 FAILED: client INSERT into notifications succeeded';
  end if;

  -- Device tokens: own insert works; foreign insert is blocked.
  insert into public.device_tokens (user_id, token, platform)
  values (v_me, v_token, 'android');

  select count(*) into v_n from public.device_tokens where user_id <> v_me;
  if v_n <> 0 then
    raise exception 'TEST 4 FAILED: user can see foreign device tokens';
  end if;

  update public.device_tokens set token = v_token || '-x' where user_id = v_other;
  if found then
    raise exception 'TEST 4 FAILED: user updated a foreign device token';
  end if;

  delete from public.device_tokens where user_id = v_other;
  if found then
    raise exception 'TEST 4 FAILED: user deleted a foreign device token';
  end if;

  v_ok := false;
  begin
    insert into public.device_tokens (user_id, token, platform)
    values (v_other, v_token || '-foreign', 'android');
    v_ok := true;
  exception when others then
    v_ok := false;
  end;
  if v_ok then
    raise exception 'TEST 4 FAILED: user registered a token for another user';
  end if;

  raise notice 'PASS: notification + device token RLS';
end $$;

reset role;

-- Nothing used by the tests survives.
rollback;

select 'ALL TESTS PASSED (transaction rolled back)' as result;

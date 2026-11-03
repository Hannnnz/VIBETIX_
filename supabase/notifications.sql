-- ══════════════════════════════════════════════════════════════════
--  VIBETIX — notifications (run ONCE in Supabase → SQL Editor)
--
--  Creates:
--    • public.notifications          (in-app notification inbox)
--    • booking_confirmed + new_booking  (on paid bookings)
--    • checked_in                        (on gate check-in, exactly once)
--    • event_reminder                    (hourly pg_cron job, once/ticket)
--    • realtime publication for the inbox
--
--  SECURITY MODEL
--    Notifications are written ONLY by SECURITY DEFINER triggers/functions.
--    Clients get SELECT, DELETE and UPDATE(read_at) on their own rows only.
--    There is no INSERT policy and INSERT is revoked from clients.
--
--  Idempotent — safe to run again. If `create extension pg_cron` fails,
--  enable pg_cron in Dashboard → Database → Extensions and re-run the
--  cron block at the bottom.
-- ══════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ──────────────────────────────────────────────────────────────────
-- 1 · Table
-- ──────────────────────────────────────────────────────────────────
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  type        text not null check (type in (
                'booking_confirmed',
                'checked_in',
                'event_reminder',
                'new_booking'
              )),
  title       text not null,
  body        text not null default '',
  data        jsonb not null default '{}'::jsonb,
  -- Denormalised from data->>'ticket_id' so the dedupe index can be a
  -- real unique index. ticket_id = bookings.id (also the check-in id).
  ticket_id   uuid references public.bookings (id) on delete cascade,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists notifications_user_feed_idx
  on public.notifications (user_id, read_at, created_at desc);

-- One check-in / one reminder per user+ticket, ever.
create unique index if not exists notifications_unique_ticket_type_idx
  on public.notifications (user_id, type, ticket_id)
  where type in ('checked_in', 'event_reminder') and ticket_id is not null;

create index if not exists notifications_ticket_idx
  on public.notifications (ticket_id);

-- ──────────────────────────────────────────────────────────────────
-- 2 · RLS: read / mark-read / delete only your own rows
-- ──────────────────────────────────────────────────────────────────
alter table public.notifications enable row level security;

revoke all on public.notifications from anon, authenticated;
grant select, delete on public.notifications to authenticated;
-- Column-level grant: a client can only ever change read_at, never the
-- title/body/user_id/data of a notification.
grant update (read_at) on public.notifications to authenticated;

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own"
  on public.notifications for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own"
  on public.notifications for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "notifications_delete_own" on public.notifications;
create policy "notifications_delete_own"
  on public.notifications for delete to authenticated
  using (user_id = auth.uid());

-- No INSERT policy on purpose: only triggers / SECURITY DEFINER
-- functions / service_role can insert.

-- ──────────────────────────────────────────────────────────────────
-- 3 · Event time zone (reminders must use the event's zone)
-- ──────────────────────────────────────────────────────────────────
alter table public.concerts
  add column if not exists timezone text not null default 'Asia/Manila';

-- ──────────────────────────────────────────────────────────────────
-- 4 · Customer "Booking confirmed" + admin "New booking"
--
-- The booking row is inserted before its seats in place_booking(), so
-- this is a DEFERRED constraint trigger: it runs at commit, when the
-- seat rows exist. The UPDATE trigger covers pending → paid flows.
-- ──────────────────────────────────────────────────────────────────
create or replace function public.notify_booking_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_concert   public.concerts%rowtype;
  v_customer  public.profiles%rowtype;
  v_seats     text;
  v_admin     record;
  v_event_at  text;
begin
  -- Only paid tickets are "confirmed".
  if new.status <> 'paid' then
    return new;
  end if;

  select * into v_concert from public.concerts where id = new.concert_id;
  select * into v_customer from public.profiles where id = new.customer_id;

  select string_agg(seat_code, ', ' order by seat_code)
    into v_seats
    from public.seats
   where booking_id = new.id;

  v_event_at := coalesce(v_concert.name, 'your event') || ' · ' ||
                to_char(v_concert.event_date, 'Mon DD') || ' at ' ||
                to_char(v_concert.event_time, 'FMHH12:MI AM');

  -- 1) The customer — exactly once per booking.
  if not exists (
    select 1 from public.notifications
     where user_id = new.customer_id
       and type = 'booking_confirmed'
       and ticket_id = new.id
  ) then
    insert into public.notifications (user_id, type, title, body, data, ticket_id)
    values (
      new.customer_id,
      'booking_confirmed',
      'Booking confirmed',
      v_event_at
        || ' · ' || new.tier_name
        || case when v_seats is not null then ' · Seat(s) ' || v_seats else '' end
        || ' · ' || new.ticket_code,
      jsonb_build_object(
        'screen',      'ticket',
        'type',        'booking_confirmed',
        'event_id',    new.concert_id,
        'ticket_id',   new.id,
        'booking_id',  new.id,
        'ticket_code', new.ticket_code
      ),
      new.id
    );
  end if;

  -- 2) Every admin gets a "New booking" notification.
  for v_admin in
    select id from public.profiles where role = 'admin'
  loop
    insert into public.notifications (user_id, type, title, body, data, ticket_id)
    values (
      v_admin.id,
      'new_booking',
      'New booking',
      coalesce(nullif(v_customer.full_name, ''), v_customer.email, 'A customer')
        || ' · ' || coalesce(v_concert.name, 'Event')
        || ' · ' || new.tier_name
        || ' × ' || new.quantity
        || ' · ₱' || to_char(new.total_amount, 'FM999,999,990.00')
        || ' · ' || new.ticket_code,
      jsonb_build_object(
        'screen',      'booking',
        'type',        'new_booking',
        'event_id',    new.concert_id,
        'ticket_id',   new.id,
        'booking_id',  new.id,
        'ticket_code', new.ticket_code
      ),
      new.id
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists bookings_notify_confirmed on public.bookings;
create constraint trigger bookings_notify_confirmed
  after insert on public.bookings
  deferrable initially deferred
  for each row execute function public.notify_booking_confirmed();

drop trigger if exists bookings_notify_confirmed_paid on public.bookings;
create trigger bookings_notify_confirmed_paid
  after update of status on public.bookings
  for each row
  when (new.status = 'paid' and old.status is distinct from 'paid')
  execute function public.notify_booking_confirmed();

-- ──────────────────────────────────────────────────────────────────
-- 5 · "You're checked in" — only on the VALID → ATTENDED transition
-- ──────────────────────────────────────────────────────────────────
create or replace function public.notify_ticket_checked_in()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_concert public.concerts%rowtype;
begin
  -- The app's source of truth is checked_in_at. A status column set to
  -- 'attended' / 'ATTENDED' (if a deployment adds one) is also honoured.
  if not (
    (old.checked_in_at is null and new.checked_in_at is not null)
    or (
      upper(coalesce(new.status::text, '')) in ('ATTENDED', 'CHECKED_IN', 'CHECKED-IN')
      and upper(coalesce(old.status::text, '')) not in ('ATTENDED', 'CHECKED_IN', 'CHECKED-IN')
    )
  ) then
    return new;
  end if;

  select * into v_concert from public.concerts where id = new.concert_id;

  insert into public.notifications (user_id, type, title, body, data, ticket_id)
  values (
    new.customer_id,
    'checked_in',
    'You''re checked in',
    'You''re checked in for ' || coalesce(v_concert.name, 'the event')
      || '. Ticket ' || new.ticket_code || '. Enjoy the show!',
    jsonb_build_object(
      'screen',      'ticket',
      'type',        'checked_in',
      'action',      'review',
      'event_id',    new.concert_id,
      'ticket_id',   new.id,
      'booking_id',  new.id,
      'ticket_code', new.ticket_code
    ),
    new.id
  )
  on conflict do nothing;  -- unique index above = never duplicated

  return new;
end;
$$;

drop trigger if exists bookings_notify_checked_in on public.bookings;
create trigger bookings_notify_checked_in
  after update on public.bookings
  for each row execute function public.notify_ticket_checked_in();

-- ──────────────────────────────────────────────────────────────────
-- 6 · Hourly reminder job (event time zone, valid tickets only)
-- ──────────────────────────────────────────────────────────────────
create or replace function public.create_event_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_row   record;
begin
  for v_row in
    select
      b.id            as booking_id,
      b.customer_id,
      b.ticket_code,
      c.id            as concert_id,
      c.name          as concert_name,
      c.venue,
      coalesce(nullif(c.timezone, ''), 'Asia/Manila') as tz,
      ((c.event_date + c.event_time)
        at time zone coalesce(nullif(c.timezone, ''), 'Asia/Manila')) as starts_at
    from public.bookings b
    join public.concerts c on c.id = b.concert_id
   where b.status = 'paid'             -- skips cancelled / refunded / pending
     and b.checked_in_at is null       -- skips already-attended tickets
     and c.status <> 'cancelled'
     and ((c.event_date + c.event_time)
           at time zone coalesce(nullif(c.timezone, ''), 'Asia/Manila'))
         > now()
     and ((c.event_date + c.event_time)
           at time zone coalesce(nullif(c.timezone, ''), 'Asia/Manila'))
         <= now() + interval '24 hours'
  loop
    insert into public.notifications (user_id, type, title, body, data, ticket_id)
    values (
      v_row.customer_id,
      'event_reminder',
      'Tomorrow: ' || v_row.concert_name || ' at ' ||
        to_char(v_row.starts_at at time zone v_row.tz, 'FMHH12:MI AM'),
      v_row.venue,
      jsonb_build_object(
        'screen',      'ticket',
        'type',        'event_reminder',
        'event_id',    v_row.concert_id,
        'ticket_id',   v_row.booking_id,
        'booking_id',  v_row.booking_id,
        'ticket_code', v_row.ticket_code
      ),
      v_row.booking_id
    )
    on conflict do nothing;

    if found then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.create_event_reminders() from public, anon, authenticated;
grant execute on function public.create_event_reminders() to service_role;

-- Schedule at minute 5 of every hour (server time = UTC).
do $$
begin
  perform cron.unschedule('vibetix-event-reminders');
exception
  when others then null; -- job did not exist yet
end $$;

select cron.schedule(
  'vibetix-event-reminders',
  '5 * * * *',
  $$ select public.create_event_reminders(); $$
);

-- ──────────────────────────────────────────────────────────────────
-- 7 · Realtime for the in-app inbox
-- ──────────────────────────────────────────────────────────────────
do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception
  when duplicate_object then null; -- already published
end $$;

notify pgrst, 'reload schema';

-- ──────────────────────────────────────────────────────────────────
-- 8 · Sanity check
-- ──────────────────────────────────────────────────────────────────
select 'notifications' as object, count(*) as rows from public.notifications
union all
select 'cron job', count(*) from cron.job where jobname = 'vibetix-event-reminders';

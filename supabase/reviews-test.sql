-- ══════════════════════════════════════════════════════════════════
--  VIBETIX — review rules test harness
--
--  Run AFTER supabase/reviews.sql, in Supabase → SQL Editor.
--  Everything runs in ONE transaction and is rolled back at the end,
--  so it never leaves test reviews/reports behind.
--
--  Covered:
--    1. A user without an ATTENDED ticket cannot create a review.
--    2. The same user cannot review the same event twice.
--    3. A hidden review does not appear in the public list.
--    4. A non-admin gets 42501 (permission denied) on admin endpoints.
--
--  The script uses existing profiles/bookings:
--    • one customer with a checked-in booking whose event is not yet reviewed
--    • one other customer without an attended ticket for that event
--    • one admin profile
--  If any of those don't exist yet, SETUP fails with a clear message.
-- ══════════════════════════════════════════════════════════════════

begin;

do $$
declare
  v_attendee  uuid;
  v_outsider  uuid;
  v_admin     uuid;
  v_event     uuid;
  v_booking   uuid;
  v_review_id uuid;
  v_payload   json;
  v_found     boolean;
begin
  -- ── Setup ───────────────────────────────────────────────────────
  select b.customer_id, b.concert_id, b.id
    into v_attendee, v_event, v_booking
    from public.bookings b
    join public.concerts c on c.id = b.concert_id
   where b.checked_in_at is not null
     and c.status <> 'draft'
     and not exists (
       select 1 from public.reviews r
        where r.event_id = b.concert_id
          and r.user_id = b.customer_id
     )
     and not exists (
       select 1
         from public.reviews recent
        where recent.user_id = b.customer_id
          and recent.created_at > now() - interval '10 minutes'
        group by recent.user_id
       having count(*) >= 5
     )
   order by b.checked_in_at desc
   limit 1;

  if v_attendee is null then
    raise exception
      'SETUP: need an attended (checked_in_at) booking whose customer has not reviewed that event yet.';
  end if;

  select p.id into v_admin
    from public.profiles p
   where p.role = 'admin'
   order by p.created_at
   limit 1;

  if v_admin is null then
    raise exception 'SETUP: no admin profile found.';
  end if;

  select p.id into v_outsider
    from public.profiles p
   where p.role = 'customer'
     and p.id <> v_attendee
     and not exists (
       select 1 from public.bookings b
        where b.customer_id = p.id
          and b.concert_id = v_event
          and b.checked_in_at is not null
     )
   order by p.created_at
   limit 1;

  if v_outsider is null then
    raise exception
      'SETUP: need a second customer without an attended ticket for event %.',
      v_event;
  end if;

  -- Helper: act as a specific Supabase user for auth.uid().
  -- (All review RPCs are security definer, so the SQL role stays the same.)

  -- ── Test 1 · no attended ticket → rejected ──────────────────────
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_outsider, 'role', 'authenticated')::text,
    true
  );

  begin
    perform public.create_review(v_event, 5, 'Should be rejected', null);
    raise exception
      'FAIL (attended): a customer without an attended ticket created a review.';
  exception
    when sqlstate '42501' then
      raise notice 'PASS 1/4 — no attended ticket cannot create a review.';
  end;

  -- ── Test 2 · attendee creates once; duplicate rejected ──────────
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_attendee, 'role', 'authenticated')::text,
    true
  );

  v_payload := public.create_review(
    v_event,
    5,
    'Automated test review — safe to ignore.',
    v_booking
  );
  v_review_id := (v_payload::jsonb ->> 'id')::uuid;

  if v_review_id is null then
    raise exception 'FAIL (create): attendee review was not created.';
  end if;

  begin
    perform public.create_review(v_event, 4, 'Duplicate', v_booking);
    raise exception 'FAIL (duplicate): a second review for the same event was accepted.';
  exception
    when sqlstate '23505' then
      raise notice 'PASS 2/4 — duplicate review rejected.';
  end;

  -- ── Test 3 · hidden review absent from public list ──────────────
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text,
    true
  );
  perform public.admin_set_review_status(v_review_id, 'hidden');

  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_outsider, 'role', 'authenticated')::text,
    true
  );
  v_payload := public.get_event_reviews(v_event, 'newest', null);

  select exists (
    select 1
      from jsonb_array_elements(coalesce(v_payload::jsonb -> 'reviews', '[]'::jsonb)) item
     where item ->> 'id' = v_review_id::text
  )
  into v_found;

  if v_found then
    raise exception 'FAIL (hidden): hidden review appeared in the public list.';
  end if;
  raise notice 'PASS 3/4 — hidden review excluded from the public list.';

  -- ── Test 4 · non-admin gets 42501 on admin endpoints ────────────
  begin
    perform public.admin_get_review_stats();
    raise exception 'FAIL (admin): non-admin read review stats.';
  exception
    when sqlstate '42501' then null;
  end;

  begin
    perform public.admin_get_reviews(null, null, null, false);
    raise exception 'FAIL (admin): non-admin listed all reviews.';
  exception
    when sqlstate '42501' then null;
  end;

  begin
    perform public.admin_set_review_status(v_review_id, 'visible');
    raise exception 'FAIL (admin): non-admin changed a review status.';
  exception
    when sqlstate '42501' then null;
  end;

  raise notice 'PASS 4/4 — non-admin blocked from admin review endpoints.';
  raise notice 'All review rule tests passed (transaction will now roll back).';
end;
$$;

rollback;

-- ══════════════════════════════════════════════════════════════════
--  VIBETIX — reviews, helpful votes & reports
--  Run ONCE in Supabase → SQL Editor (idempotent, safe to re-run).
--
--  The app uses Supabase directly, so the review "endpoints" are
--  implemented as security-definer RPCs with server-side validation:
--    POST   /events/:id/reviews        → create_review(...)
--    GET    /events/:id/reviews        → get_event_reviews(...)
--    PATCH  /reviews/:id               → update_review(...)
--    DELETE /reviews/:id               → delete_review(...)
--    POST   /reviews/:id/helpful       → toggle_review_helpful(...)
--    POST   /reviews/:id/report        → report_review(...)
--    GET    /admin/reviews            → admin_get_reviews(...)
--    PATCH  /admin/reviews/:id/status → admin_set_review_status(...)
--    DELETE /admin/reviews/:id        → admin_delete_review(...)
--    POST   /admin/reports/:id/dismiss→ admin_dismiss_report(...)
--    GET    /admin/reviews/stats      → admin_get_review_stats()
-- ══════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── Schema prerequisites ──────────────────────────────────────────
-- The review policies/trigger use these helpers. They normally exist in
-- schema.sql, but older/locally-created projects may not have them yet.
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── Tables ────────────────────────────────────────────────────────
create table if not exists public.reviews (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.concerts (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  ticket_id   uuid not null references public.bookings (id) on delete cascade,
  rating      smallint not null check (rating between 1 and 5),
  comment     text not null default '' check (char_length(comment) <= 500),
  status      text not null default 'visible'
              check (status in ('visible', 'hidden')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (event_id, user_id)
);

create index if not exists reviews_event_idx
  on public.reviews (event_id, status, created_at desc);
create index if not exists reviews_user_idx
  on public.reviews (user_id, created_at desc);
create index if not exists reviews_rating_idx
  on public.reviews (event_id, rating);

create table if not exists public.review_helpful (
  review_id   uuid not null references public.reviews (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (review_id, user_id)
);

create index if not exists review_helpful_review_idx
  on public.review_helpful (review_id);

create table if not exists public.review_reports (
  id          uuid primary key default gen_random_uuid(),
  review_id   uuid not null references public.reviews (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  reason      text not null check (char_length(trim(reason)) between 1 and 300),
  status      text not null default 'open'
              check (status in ('open', 'dismissed')),
  created_at  timestamptz not null default now(),
  unique (review_id, user_id)
);

create index if not exists review_reports_status_idx
  on public.review_reports (status, created_at desc);
create index if not exists review_reports_review_idx
  on public.review_reports (review_id, status);

-- ── updated_at ────────────────────────────────────────────────────
drop trigger if exists reviews_touch on public.reviews;
create trigger reviews_touch
  before update on public.reviews
  for each row execute function public.touch_updated_at();

-- ── RLS: hidden reviews stay private to owner + admins ────────────
alter table public.reviews         enable row level security;
alter table public.review_helpful  enable row level security;
alter table public.review_reports  enable row level security;

drop policy if exists "reviews_select_visible_own_admin" on public.reviews;
create policy "reviews_select_visible_own_admin"
  on public.reviews for select to authenticated
  using (
    status = 'visible'
    or user_id = auth.uid()
    or public.is_admin()
  );

drop policy if exists "review_helpful_select_auth" on public.review_helpful;
create policy "review_helpful_select_auth"
  on public.review_helpful for select to authenticated
  using (
    exists (
      select 1 from public.reviews r
      where r.id = review_id
        and (r.status = 'visible' or r.user_id = auth.uid() or public.is_admin())
    )
  );

drop policy if exists "review_reports_select_own_admin" on public.review_reports;
create policy "review_reports_select_own_admin"
  on public.review_reports for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- Writes go through the security-definer RPCs only. Revoking direct
-- writes keeps status changes, ownership and rate limits enforceable.
revoke insert, update, delete on public.reviews        from anon, authenticated;
revoke insert, update, delete on public.review_helpful from anon, authenticated;
revoke insert, update, delete on public.review_reports from anon, authenticated;

-- ── Helpers ───────────────────────────────────────────────────────
create or replace function public.require_review_admin()
returns uuid
language plpgsql stable security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null or not public.is_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  return v_user;
end;
$$;

revoke execute on function public.require_review_admin() from public, anon;
grant execute on function public.require_review_admin() to authenticated;

-- ── Customer: create ──────────────────────────────────────────────
drop function if exists public.create_review(uuid, int, text, uuid);
create or replace function public.create_review(
  p_event_id uuid,
  p_rating int,
  p_comment text default '',
  p_ticket_id uuid default null
)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_user    uuid := auth.uid();
  v_booking public.bookings%rowtype;
  v_comment text := trim(coalesce(p_comment, ''));
  v_review  public.reviews%rowtype;
  v_recent  int;
begin
  if v_user is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5.' using errcode = '22023';
  end if;
  if char_length(v_comment) > 500 then
    raise exception 'Comment must be 500 characters or fewer.' using errcode = '22001';
  end if;
  if not exists (
    select 1 from public.concerts
    where id = p_event_id and status <> 'draft'
  ) then
    raise exception 'Event not found.' using errcode = 'P0002';
  end if;

  -- ATTENDED = the ticket was checked in at the gate.
  if p_ticket_id is not null then
    select * into v_booking
      from public.bookings
      where id = p_ticket_id
        and concert_id = p_event_id
        and customer_id = v_user
        and checked_in_at is not null;
  else
    select * into v_booking
      from public.bookings
      where concert_id = p_event_id
        and customer_id = v_user
        and checked_in_at is not null
      order by checked_in_at desc
      limit 1;
  end if;

  if not found then
    raise exception 'Only attendees with an attended ticket can review this event.'
      using errcode = '42501';
  end if;

  -- Anti-spam: at most 5 new reviews per 10 minutes.
  select count(*) into v_recent
    from public.reviews
    where user_id = v_user
      and created_at > now() - interval '10 minutes';
  if v_recent >= 5 then
    raise exception 'Too many reviews — try again in a few minutes.'
      using errcode = 'P0001';
  end if;

  begin
    insert into public.reviews (event_id, user_id, ticket_id, rating, comment)
    values (p_event_id, v_user, v_booking.id, p_rating, v_comment)
    returning * into v_review;
  exception when unique_violation then
    raise exception 'You already reviewed this event.' using errcode = '23505';
  end;

  return json_build_object(
    'id', v_review.id,
    'event_id', v_review.event_id,
    'user_id', v_review.user_id,
    'ticket_id', v_review.ticket_id,
    'ticket_tier', v_booking.tier_name,
    'rating', v_review.rating,
    'comment', v_review.comment,
    'status', v_review.status,
    'created_at', v_review.created_at,
    'updated_at', v_review.updated_at
  );
end;
$$;

revoke execute on function public.create_review(uuid, int, text, uuid) from public, anon;
grant execute on function public.create_review(uuid, int, text, uuid) to authenticated;

-- ── Customer: edit / delete ───────────────────────────────────────
drop function if exists public.update_review(uuid, int, text);
create or replace function public.update_review(
  p_review_id uuid,
  p_rating int,
  p_comment text default ''
)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_user    uuid := auth.uid();
  v_comment text := trim(coalesce(p_comment, ''));
  v_review  public.reviews%rowtype;
begin
  if v_user is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5.' using errcode = '22023';
  end if;
  if char_length(v_comment) > 500 then
    raise exception 'Comment must be 500 characters or fewer.' using errcode = '22001';
  end if;

  update public.reviews
     set rating = p_rating,
         comment = v_comment,
         updated_at = now()
   where id = p_review_id
     and user_id = v_user
  returning * into v_review;

  if not found then
    raise exception 'You can only edit your own review.' using errcode = '42501';
  end if;

  return json_build_object(
    'id', v_review.id,
    'rating', v_review.rating,
    'comment', v_review.comment,
    'status', v_review.status,
    'updated_at', v_review.updated_at
  );
end;
$$;

revoke execute on function public.update_review(uuid, int, text) from public, anon;
grant execute on function public.update_review(uuid, int, text) to authenticated;

drop function if exists public.delete_review(uuid);
create or replace function public.delete_review(p_review_id uuid)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_found uuid;
begin
  if v_user is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;

  delete from public.reviews
   where id = p_review_id
     and user_id = v_user
  returning id into v_found;

  if v_found is null then
    raise exception 'You can only delete your own review.' using errcode = '42501';
  end if;

  return json_build_object('deleted', true, 'id', v_found);
end;
$$;

revoke execute on function public.delete_review(uuid) from public, anon;
grant execute on function public.delete_review(uuid) to authenticated;

-- ── Public list + aggregate stats ─────────────────────────────────
drop function if exists public.get_event_reviews(uuid, text, int);
create or replace function public.get_event_reviews(
  p_event_id uuid,
  p_sort text default 'newest',
  p_rating int default null
)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_user   uuid := auth.uid();
  v_result json;
begin
  if v_user is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if p_rating is not null and (p_rating < 1 or p_rating > 5) then
    raise exception 'Invalid rating filter.' using errcode = '22023';
  end if;

  select json_build_object(
    'average', coalesce(round(avg(r.rating)::numeric, 1), 0),
    'total', count(*),
    'counts', json_build_object(
      '5', count(*) filter (where r.rating = 5),
      '4', count(*) filter (where r.rating = 4),
      '3', count(*) filter (where r.rating = 3),
      '2', count(*) filter (where r.rating = 2),
      '1', count(*) filter (where r.rating = 1)
    ),
    'reviews', coalesce((
      select json_agg(x order by
        case when p_sort = 'highest' then x.rating end desc,
        case when p_sort = 'lowest'  then x.rating end asc,
        case when p_sort = 'helpful' then x.helpful_count end desc,
        x.created_at desc
      )
      from (
        select
          r2.id,
          r2.event_id,
          r2.user_id,
          r2.ticket_id,
          r2.rating,
          r2.comment,
          r2.status,
          r2.created_at,
          r2.updated_at,
          p.full_name as user_name,
          b.tier_name as ticket_tier,
          (select count(*)::int
             from public.review_helpful h
            where h.review_id = r2.id) as helpful_count,
          exists (
            select 1 from public.review_helpful h
            where h.review_id = r2.id and h.user_id = v_user
          ) as user_helpful
        from public.reviews r2
        join public.profiles p on p.id = r2.user_id
        join public.bookings b on b.id = r2.ticket_id
        where r2.event_id = p_event_id
          and r2.status = 'visible'
          and (p_rating is null or r2.rating = p_rating)
      ) x
    ), '[]'::json)
  )
  into v_result
  from public.reviews r
  where r.event_id = p_event_id
    and r.status = 'visible';

  return v_result;
end;
$$;

revoke execute on function public.get_event_reviews(uuid, text, int) from public, anon;
grant execute on function public.get_event_reviews(uuid, text, int) to authenticated;

-- ── Helpful toggle ────────────────────────────────────────────────
drop function if exists public.toggle_review_helpful(uuid);
create or replace function public.toggle_review_helpful(p_review_id uuid)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_user     uuid := auth.uid();
  v_helpful  boolean;
  v_count    int;
begin
  if v_user is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.reviews where id = p_review_id and status = 'visible'
  ) then
    raise exception 'Review not available.' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.review_helpful
    where review_id = p_review_id and user_id = v_user
  ) then
    delete from public.review_helpful
     where review_id = p_review_id and user_id = v_user;
    v_helpful := false;
  else
    insert into public.review_helpful (review_id, user_id)
    values (p_review_id, v_user);
    v_helpful := true;
  end if;

  select count(*)::int into v_count
    from public.review_helpful
    where review_id = p_review_id;

  return json_build_object('helpful', v_helpful, 'count', v_count);
end;
$$;

revoke execute on function public.toggle_review_helpful(uuid) from public, anon;
grant execute on function public.toggle_review_helpful(uuid) to authenticated;

-- ── Report a review ───────────────────────────────────────────────
drop function if exists public.report_review(uuid, text);
create or replace function public.report_review(
  p_review_id uuid,
  p_reason text
)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_user   uuid := auth.uid();
  v_reason text := trim(coalesce(p_reason, ''));
  v_review public.reviews%rowtype;
  v_recent int;
begin
  if v_user is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if v_reason = '' then
    raise exception 'A report reason is required.' using errcode = '22023';
  end if;
  if char_length(v_reason) > 300 then
    raise exception 'Report reason must be 300 characters or fewer.' using errcode = '22001';
  end if;

  select * into v_review
    from public.reviews
    where id = p_review_id and status = 'visible';
  if not found then
    raise exception 'Review not available.' using errcode = 'P0002';
  end if;
  if v_review.user_id = v_user then
    raise exception 'You cannot report your own review.' using errcode = '42501';
  end if;

  -- Anti-spam: at most 5 reports per hour.
  select count(*) into v_recent
    from public.review_reports
    where user_id = v_user
      and created_at > now() - interval '1 hour';
  if v_recent >= 5 then
    raise exception 'Too many reports — try again later.' using errcode = 'P0001';
  end if;

  begin
    insert into public.review_reports (review_id, user_id, reason)
    values (p_review_id, v_user, v_reason);
  exception when unique_violation then
    raise exception 'You already reported this review.' using errcode = '23505';
  end;

  return json_build_object('reported', true);
end;
$$;

revoke execute on function public.report_review(uuid, text) from public, anon;
grant execute on function public.report_review(uuid, text) to authenticated;

-- ── My reviews (customer profile) ─────────────────────────────────
drop function if exists public.get_my_reviews();
create or replace function public.get_my_reviews()
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_user   uuid := auth.uid();
  v_result json;
begin
  if v_user is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;

  select coalesce(json_agg(x order by x.created_at desc), '[]'::json)
  into v_result
  from (
    select
      r.id,
      r.event_id,
      c.name as event_name,
      r.user_id,
      p.full_name as user_name,
      r.ticket_id,
      b.tier_name as ticket_tier,
      r.rating,
      r.comment,
      r.status,
      r.created_at,
      r.updated_at,
      (select count(*)::int
         from public.review_helpful h
        where h.review_id = r.id) as helpful_count,
      exists (
        select 1 from public.review_helpful h
        where h.review_id = r.id and h.user_id = v_user
      ) as user_helpful
    from public.reviews r
    join public.concerts c on c.id = r.event_id
    join public.profiles p on p.id = r.user_id
    join public.bookings b on b.id = r.ticket_id
    where r.user_id = v_user
  ) x;

  return v_result;
end;
$$;

revoke execute on function public.get_my_reviews() from public, anon;
grant execute on function public.get_my_reviews() to authenticated;

-- ── Admin: list / stats / status / delete / reports ───────────────
drop function if exists public.admin_get_reviews(text, uuid, int, boolean);
create or replace function public.admin_get_reviews(
  p_status text default null,
  p_event uuid default null,
  p_rating int default null,
  p_reported boolean default false
)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_result json;
begin
  perform public.require_review_admin();

  if p_status is not null and p_status not in ('visible', 'hidden') then
    raise exception 'Invalid status filter.' using errcode = '22023';
  end if;
  if p_rating is not null and (p_rating < 1 or p_rating > 5) then
    raise exception 'Invalid rating filter.' using errcode = '22023';
  end if;

  select coalesce(json_agg(x order by x.created_at desc), '[]'::json)
  into v_result
  from (
    select
      r.id,
      r.event_id,
      c.name as event_name,
      r.user_id,
      p.full_name as user_name,
      p.email as user_email,
      r.ticket_id,
      b.tier_name as ticket_tier,
      r.rating,
      r.comment,
      r.status,
      r.created_at,
      r.updated_at,
      (select count(*)::int
         from public.review_reports rr
        where rr.review_id = r.id and rr.status = 'open') as report_count,
      (select coalesce(json_agg(json_build_object(
          'id', rr.id,
          'reason', rr.reason,
          'created_at', rr.created_at,
          'user_id', rr.user_id
        ) order by rr.created_at), '[]'::json)
         from public.review_reports rr
        where rr.review_id = r.id and rr.status = 'open') as reports
    from public.reviews r
    join public.concerts c on c.id = r.event_id
    join public.profiles p on p.id = r.user_id
    join public.bookings b on b.id = r.ticket_id
    where (p_status is null or r.status = p_status)
      and (p_event is null or r.event_id = p_event)
      and (p_rating is null or r.rating = p_rating)
      and (
        not p_reported
        or exists (
          select 1 from public.review_reports rr
          where rr.review_id = r.id and rr.status = 'open'
        )
      )
  ) x;

  return v_result;
end;
$$;

revoke execute on function public.admin_get_reviews(text, uuid, int, boolean) from public, anon;
grant execute on function public.admin_get_reviews(text, uuid, int, boolean) to authenticated;

drop function if exists public.admin_get_review_stats();
create or replace function public.admin_get_review_stats()
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_result json;
begin
  perform public.require_review_admin();

  select json_build_object(
    'average_rating',
      (select coalesce(round(avg(rating)::numeric, 1), 0)
         from public.reviews where status = 'visible'),
    'total_reviews', (select count(*) from public.reviews),
    'visible_reviews', (select count(*) from public.reviews where status = 'visible'),
    'reported_reviews',
      (select count(distinct review_id)
         from public.review_reports where status = 'open'),
    'open_reports',
      (select count(*) from public.review_reports where status = 'open')
  )
  into v_result;

  return v_result;
end;
$$;

revoke execute on function public.admin_get_review_stats() from public, anon;
grant execute on function public.admin_get_review_stats() to authenticated;

drop function if exists public.admin_get_reported_reviews(int);
create or replace function public.admin_get_reported_reviews(p_limit int default 5)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_result json;
begin
  perform public.require_review_admin();

  select coalesce(json_agg(x order by x.last_report_at desc), '[]'::json)
  into v_result
  from (
    select
      r.id,
      r.event_id,
      c.name as event_name,
      r.user_id,
      p.full_name as user_name,
      p.email as user_email,
      r.ticket_id,
      b.tier_name as ticket_tier,
      r.rating,
      r.comment,
      r.status,
      r.created_at,
      r.updated_at,
      (select count(*)::int
         from public.review_reports rr
        where rr.review_id = r.id and rr.status = 'open') as report_count,
      (select coalesce(json_agg(json_build_object(
          'id', rr.id,
          'reason', rr.reason,
          'created_at', rr.created_at,
          'user_id', rr.user_id
        ) order by rr.created_at), '[]'::json)
         from public.review_reports rr
        where rr.review_id = r.id and rr.status = 'open') as reports,
      (select max(rr.created_at)
         from public.review_reports rr
        where rr.review_id = r.id and rr.status = 'open') as last_report_at
    from public.reviews r
    join public.concerts c on c.id = r.event_id
    join public.profiles p on p.id = r.user_id
    join public.bookings b on b.id = r.ticket_id
    where exists (
      select 1 from public.review_reports rr
      where rr.review_id = r.id and rr.status = 'open'
    )
    order by last_report_at desc
    limit greatest(1, least(coalesce(p_limit, 5), 20))
  ) x;

  return v_result;
end;
$$;

revoke execute on function public.admin_get_reported_reviews(int) from public, anon;
grant execute on function public.admin_get_reported_reviews(int) to authenticated;

drop function if exists public.admin_set_review_status(uuid, text);
create or replace function public.admin_set_review_status(
  p_review_id uuid,
  p_status text
)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_review public.reviews%rowtype;
begin
  perform public.require_review_admin();

  if p_status not in ('visible', 'hidden') then
    raise exception 'Status must be visible or hidden.' using errcode = '22023';
  end if;

  update public.reviews
     set status = p_status,
         updated_at = now()
   where id = p_review_id
  returning * into v_review;

  if not found then
    raise exception 'Review not found.' using errcode = 'P0002';
  end if;

  return json_build_object(
    'id', v_review.id,
    'status', v_review.status,
    'updated_at', v_review.updated_at
  );
end;
$$;

revoke execute on function public.admin_set_review_status(uuid, text) from public, anon;
grant execute on function public.admin_set_review_status(uuid, text) to authenticated;

drop function if exists public.admin_delete_review(uuid);
create or replace function public.admin_delete_review(p_review_id uuid)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_found uuid;
begin
  perform public.require_review_admin();

  delete from public.reviews
   where id = p_review_id
  returning id into v_found;

  if v_found is null then
    raise exception 'Review not found.' using errcode = 'P0002';
  end if;

  return json_build_object('deleted', true, 'id', v_found);
end;
$$;

revoke execute on function public.admin_delete_review(uuid) from public, anon;
grant execute on function public.admin_delete_review(uuid) to authenticated;

drop function if exists public.admin_dismiss_report(uuid);
create or replace function public.admin_dismiss_report(p_report_id uuid)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_found uuid;
begin
  perform public.require_review_admin();

  update public.review_reports
     set status = 'dismissed'
   where id = p_report_id
     and status = 'open'
  returning id into v_found;

  if v_found is null then
    raise exception 'Open report not found.' using errcode = 'P0002';
  end if;

  return json_build_object('dismissed', true, 'id', v_found);
end;
$$;

revoke execute on function public.admin_dismiss_report(uuid) from public, anon;
grant execute on function public.admin_dismiss_report(uuid) to authenticated;

-- ── Admin events list: average rating per event ───────────────────
drop function if exists public.get_event_ratings();
create or replace function public.get_event_ratings()
returns table (event_id uuid, average_rating numeric, total_reviews bigint)
language sql stable security definer set search_path = public
as $$
  select r.event_id,
         round(avg(r.rating)::numeric, 1) as average_rating,
         count(*) as total_reviews
  from public.reviews r
  where r.status = 'visible'
  group by r.event_id;
$$;

revoke execute on function public.get_event_ratings() from public, anon;
grant execute on function public.get_event_ratings() to authenticated;

-- ── Make PostgREST see everything immediately ────────────────────
notify pgrst, 'reload schema';

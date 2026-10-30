-- ═════════ VIBETIX — make created events visible to customers ═════════
-- Run this ONCE in Supabase → SQL Editor (as the project owner).
-- It diagnoses + repairs the RLS policies that decide who can READ a concert.

-- 1) Diagnostic: list concerts and their status (check the Results pane)
select id, name, status, created_by, event_date
from public.concerts
order by created_at desc;

-- 2) Diagnostic: confirm the signed-in customer can read published concerts
-- (run while logged in as the customer, or replace auth.uid() with the customer's id)
select id, name, status
from public.concerts
where status <> 'draft';

-- 3) Make sure the status column actually exists (older schemas may lack it).
alter table public.concerts
  add column if not exists status text not null default 'published';
alter table public.concerts
  add column if not exists created_by uuid references public.profiles (id);

-- Keep status values valid.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'concerts_status_check'
  ) then
    alter table public.concerts
      add constraint concerts_status_check
      check (status in ('draft', 'published', 'cancelled'));
  end if;
end $$;

-- 4) GUARANTEED-READ policy for troubleshooting:
--    Any signed-in user can read ALL concerts (including drafts).
--    This removes RLS as the cause of "Concert not found".
--    Revert to the status-based policy later if you want draft hiding.
alter table public.concerts enable row level security;

drop policy if exists concerts_read_all on public.concerts;
drop policy if exists concerts_read_published on public.concerts;
create policy "concerts_read_all"
  on public.concerts for select to authenticated using (true);

-- 5) Tiers readable by everyone authenticated
alter table public.ticket_tiers enable row level security;

drop policy if exists tiers_read_all on public.ticket_tiers;
create policy "tiers_read_all"
  on public.ticket_tiers for select to authenticated using (true);

-- 6) Normalize any null/odd status values
update public.concerts set status = 'published'
where status is null or status not in ('draft','published','cancelled');

-- 5) Make sure any event that was accidentally saved as 'draft' is published.
--    (Safe: only touches rows still in draft state.)
update public.concerts set status = 'published' where status = 'draft';

-- 6) Confirm the admin role is actually set (promote if needed).
--    Uncomment and edit the email if your admin account isn't promoted yet:
-- update public.profiles set role = 'admin' where email = 'admin@gmail.com';

-- 7) Re-verify
select id, name, status from public.concerts order by created_at desc;

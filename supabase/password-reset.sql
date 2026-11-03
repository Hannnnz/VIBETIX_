-- ══════════════════════════════════════════════════════════════════
-- VIBETIX password reset support
-- Run once in Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════════════

-- 1. Force-change flag on profiles
alter table public.profiles
  add column if not exists must_change_password boolean not null default false;

-- 2. Audit log (no passwords)
create table if not exists public.password_reset_audit (
  id         uuid primary key default gen_random_uuid(),
  admin_id   uuid references public.profiles (id) on delete set null,
  staff_id   uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.password_reset_audit enable row level security;

-- Admins can read the audit log; clients cannot write it (service role only).
create policy "password_reset_audit_select_admin"
  on public.password_reset_audit for select to authenticated
  using (public.is_admin());

-- (No insert/update/delete policies for authenticated users.)
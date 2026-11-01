-- Email delivery log for VIBETIX transactional emails (Resend).
-- Run once in the Supabase SQL Editor.

create table if not exists public.email_logs (
  id uuid primary key default gen_random_uuid(),
  recipient text not null,
  email_type text not null,        -- 'purchase' | 'attendance'
  ticket_code text not null,
  status text not null default 'pending', -- 'pending' | 'sent' | 'failed'
  provider_id text,
  error text,
  created_at timestamptz not null default now(),
  unique (ticket_code, email_type)
);

-- Optional: let users read their own delivery status (best effort).
alter table public.email_logs enable row level security;
drop policy if exists "email_logs_service_only" on public.email_logs;
create policy "email_logs_service_only" on public.email_logs
  for all using (false) with check (false);
-- Edge functions use the service_role key, which bypasses RLS.
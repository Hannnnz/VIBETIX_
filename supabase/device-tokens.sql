-- ══════════════════════════════════════════════════════════════════
--  VIBETIX — device push tokens (run ONCE in Supabase → SQL Editor)
--
--  The Android app registers its FCM token after login and saves it
--  here. The send-push Edge Function (service_role) reads these rows
--  when a notification is inserted.
--
--  RLS: a user can only see / add / update / delete their OWN tokens.
--  Idempotent — safe to run again.
-- ══════════════════════════════════════════════════════════════════

create table if not exists public.device_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  token       text not null,
  platform    text not null default 'android'
              check (platform in ('android', 'ios', 'web')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (token)
);

create index if not exists device_tokens_user_idx
  on public.device_tokens (user_id);

alter table public.device_tokens enable row level security;

revoke all on public.device_tokens from anon, authenticated;
grant select, insert, update, delete on public.device_tokens to authenticated;

drop policy if exists "device_tokens_select_own" on public.device_tokens;
create policy "device_tokens_select_own"
  on public.device_tokens for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "device_tokens_insert_own" on public.device_tokens;
create policy "device_tokens_insert_own"
  on public.device_tokens for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "device_tokens_update_own" on public.device_tokens;
create policy "device_tokens_update_own"
  on public.device_tokens for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "device_tokens_delete_own" on public.device_tokens;
create policy "device_tokens_delete_own"
  on public.device_tokens for delete to authenticated
  using (user_id = auth.uid());

drop trigger if exists device_tokens_touch on public.device_tokens;
create trigger device_tokens_touch
  before update on public.device_tokens
  for each row execute function public.touch_updated_at();

notify pgrst, 'reload schema';

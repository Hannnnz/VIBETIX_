-- ═════════ VIBETIX — create the 3 demo accounts (SQL Editor → Run) ═════════
create extension if not exists pgcrypto;

create or replace function add_vibetix_user(
  email text, password text, full_name text, role text
)
returns void
language plpgsql security definer set search_path = public, auth
as $$
declare
  u_id uuid;
begin
  -- Insert into Supabase's real auth table (password = bcrypt hash)
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new
  ) values (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    lower(trim(email)),
    crypt(password, gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('full_name', full_name, 'role', role),
    now(), now(),
    '', '', '', ''
  )
  on conflict (email) do update          -- re-running? just reset the password
    set encrypted_password = excluded.encrypted_password,
        raw_user_meta_data = excluded.raw_user_meta_data,
        email_confirmed_at = now()
  returning id into u_id;

  -- auth.identities row (keeps Supabase's auth linker happy)
  insert into auth.identities (
    id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
  ) values (
    u_id::text, u_id, 'email', 'email',
    jsonb_build_object('sub', u_id::text, 'email', lower(trim(email))),
    now(), now(), now()
  ) on conflict (provider_id, id) do nothing;

  -- Role rules:
  --   customer -> joined automatically (trigger does it)
  --   staff    -> joined = true so the dashboard opens right away
  --   admin    -> ONLY this function can grant admin (app signup can never)
  if role in ('admin', 'staff') then
    update public.profiles
      set role = case when role = 'admin' then 'admin'::text else 'staff'::text end,
          joined = true
      where id = u_id;
  end if;
end;
$$;

-- ═══ THE ACCOUNTS — ready to log in from the app immediately ═══
select add_vibetix_user('admin@gmail.com', 'admin123', 'Admin VIBETIX',  'admin');
select add_vibetix_user('staff@gmail.com', 'staff123', 'Staff VIBETIX',  'staff');
select add_vibetix_user('user@gmail.com',  'user123',  'Juan Customer',  'customer');

-- ═════════ VIBETIX — repair RLS policies ═════════

-- 1 · See the current state (check Results pane)
select relname, relrowsecurity as rls_enabled
from pg_class
where relname in ('profiles','concerts','bookings','seats','company_settings');

select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- 2 · Admin helper
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- ═══ PROFILES — the one blocking your login ═══
alter table public.profiles enable row level security;

drop policy if exists profiles_select_authenticated on public.profiles;
create policy "profiles_select_authenticated"
  on public.profiles for select to authenticated using (true);

drop policy if exists profiles_update_own on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update to authenticated
  using (auth.uid() = id or public.is_admin());

-- ═══ COMPANY SETTINGS (join code) ═══
alter table public.company_settings enable row level security;

drop policy if exists company_read_all on public.company_settings;
create policy "company_read_all"
  on public.company_settings for select to authenticated using (true);

drop policy if exists company_update_admin on public.company_settings;
create policy "company_update_admin"
  on public.company_settings for update to authenticated using (public.is_admin());

-- ═══ REMOVED ACCOUNTS (admin blocklist) ═══
alter table public.removed_accounts enable row level security;

drop policy if exists removed_select_admin on public.removed_accounts;
create policy "removed_select_admin"
  on public.removed_accounts for select to authenticated using (public.is_admin());

drop policy if exists removed_manage_admin on public.removed_accounts;
create policy "removed_manage_admin"
  on public.removed_accounts for all to authenticated using (public.is_admin());

-- ═══ CONCERTS + TIERS ═══
alter table public.concerts enable row level security;
alter table public.ticket_tiers enable row level security;

drop policy if exists concerts_read_all on public.concerts;
create policy "concerts_read_all"
  on public.concerts for select to authenticated
  using (status <> 'draft' or public.is_admin() or created_by = auth.uid());

drop policy if exists concerts_manage_admin on public.concerts;
create policy "concerts_manage_admin"
  on public.concerts for all to authenticated using (public.is_admin());

drop policy if exists tiers_read_all on public.ticket_tiers;
create policy "tiers_read_all"
  on public.ticket_tiers for select to authenticated using (true);

drop policy if exists tiers_write_admin on public.ticket_tiers;
create policy "tiers_write_admin"
  on public.ticket_tiers for all to authenticated using (public.is_admin());

-- ═══ BOOKINGS ═══
alter table public.bookings enable row level security;

drop policy if exists bookings_select_own_or_admin on public.bookings;
create policy "bookings_select_own_or_admin"
  on public.bookings for select to authenticated using (
    customer_id = auth.uid()
    or exists (select 1 from public.profiles p
               where p.id = auth.uid() and p.role in ('staff','admin'))
  );

drop policy if exists bookings_insert_own on public.bookings;
create policy "bookings_insert_own"
  on public.bookings for insert to authenticated with check (
    customer_id = auth.uid() and status = 'pending'
  );

drop policy if exists bookings_update_admin_or_system on public.bookings;
create policy "bookings_update_admin_or_system"
  on public.bookings for update to authenticated using (
    public.is_admin() or (select auth.role() = 'service_role')
  );

drop policy if exists bookings_delete_admin on public.bookings;
create policy "bookings_delete_admin"
  on public.bookings for delete to authenticated using (public.is_admin());

-- ═══ SEATS ═══
alter table public.seats enable row level security;

drop policy if exists seats_read_all on public.seats;
create policy "seats_read_all"
  on public.seats for select to authenticated using (true);

-- ═══ PAYMENT METHODS (masked refs only) ═══
alter table public.payment_methods enable row level security;

drop policy if exists methods_select_own on public.payment_methods;
create policy "methods_select_own"
  on public.payment_methods for select to authenticated
  using (customer_id = auth.uid());

drop policy if exists methods_manage_own on public.payment_methods;
create policy "methods_manage_own"
  on public.payment_methods for all to authenticated
  using (customer_id = auth.uid());

-- ═══ PAYMENTS ═══
alter table public.payments enable row level security;

drop policy if exists payments_select_related on public.payments;
create policy "payments_select_related"
  on public.payments for select to authenticated using (
    public.is_admin() or exists (
      select 1 from public.bookings b where b.id = payments.booking_id
      and b.customer_id = auth.uid()
    )
  );

-- ═══ CHECK-INS ═══
alter table public.check_ins enable row level security;

drop policy if exists checkins_select_staff_or_admin on public.check_ins;
create policy "checkins_select_staff_or_admin"
  on public.check_ins for select to authenticated using (
    public.is_admin() or scanned_by = auth.uid()
  );

drop policy if exists checkins_insert_staff on public.check_ins;
create policy "checkins_insert_staff"
  on public.check_ins for insert to authenticated with check (
    exists (select 1 from public.profiles p where p.id = auth.uid()
            and p.role in ('staff', 'admin'))
  );

-- ═══ RECOMMENDATION DATA (loves / views) ═══
alter table public.concert_loves enable row level security;
alter table public.concert_views enable row level security;

drop policy if exists loves_select_own on public.concert_loves;
create policy "loves_select_own"
  on public.concert_loves for select to authenticated using (user_id = auth.uid());

drop policy if exists loves_manage_own on public.concert_loves;
create policy "loves_manage_own"
  on public.concert_loves for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists views_select_own on public.concert_views;
create policy "views_select_own"
  on public.concert_views for select to authenticated using (user_id = auth.uid());

drop policy if exists views_insert_own on public.concert_views;
create policy "views_insert_own"
  on public.concert_views for insert to authenticated with check (user_id = auth.uid());

-- 3 · PROVE THE LOGIN LOOKUP WORKS NOW
select id, email, role, joined from public.profiles where email = 'user@gmail.com';
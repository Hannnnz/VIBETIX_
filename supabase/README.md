# VIBETIX Backend (Supabase)

The app is now backed by a real database. Project: `https://vtocnpgguwggpgvvylzn.supabase.co`

## One-time setup checklist (in Supabase dashboard)

1. **Run the patch script** (Security rules + backend functions):
   - SQL Editor → paste **`supabase/patch.sql`** → Run.
   - This is idempotent — safe even if you already ran other SQL.
2. **Turn OFF email confirmation** (fastest demo path):
   - Authentication → Providers → Email → toggle **"Confirm email"** off → Save.
   - (Leave it on if you want verification emails — the register page handles it.)
3. **Create your accounts from the app's Register screen**, e.g.
   - `admin@gmail.com` — register, then promote to admin:
     ```sql
     update public.profiles set role = 'admin' where email = 'admin@gmail.com';
     ```
   - `staff@gmail.com` and `user@gmail.com` — register normally (customer / staff).
4. **Deploy the staff-creation edge function** (for the admin "Add staff" button):
   ```bash
   npm i -g supabase
   supabase login
   supabase functions deploy create-staff --project-ref vtocnpgguwggpgvvylzn
   supabase secrets set SERVICE_ROLE_KEY=<service_role key>
   ```
   Until deployed, "Add staff" shows a toast explaining this. Removed-staff
   blocklists and join codes already work without it.

## What lives where

| Concern | File | Notes |
|---|---|---|
| Full schema + RLS | `supabase/schema.sql` | 12 tables, security policies |
| Patch: RPCs + policy ensure | `supabase/patch.sql` | `place_booking`, `check_in_ticket` |
| Edge function (server-side admin ops) | `supabase/functions/create-staff/` | uses service_role, never the app |
| Secrets | `supabase/.env` | **gitignored — never commit or bundle** |

## Security model already enforced by PostgreSQL

- Users can only read their **own** bookings & payment methods (RLS)
- Only admins write concerts/company code (RLS)
- **Double seat selling is impossible** — `unique(concert_id, seat_code)` in `seats`
- Prices are computed **server-side** in `place_booking` (client cannot tamper)
- Staff check-in is one-per-ticket, DB-enforced (`check_ins.booking_id` unique)
- Signup metadata can never grant `admin` (trigger clamps roles)

# VIBETIX notifications — setup & runbook

Notifications are **created only on the server** (Postgres triggers + an hourly
`pg_cron` job). The app can only read, mark read, and delete its own rows.
Push delivery is an Edge Function using the FCM HTTP v1 API.

## 1. Run these SQL files (Supabase → SQL Editor, in this order)

1. `supabase/notifications.sql`
   - creates `public.notifications`, both dedupe/feed indexes, RLS
   - adds `concerts.timezone` (default `Asia/Manila`)
   - creates `booking_confirmed` + `new_booking` triggers
   - creates the single-fire `checked_in` trigger
   - creates `create_event_reminders()` and schedules it hourly
   - adds `notifications` to the realtime publication
2. `supabase/device-tokens.sql`
   - creates `public.device_tokens` with owner-only RLS
3. `supabase/notifications-tests.sql` (optional but recommended)
   - asserts booking fan-out, single check-in, reminder window, and RLS
   - ends with `rollback`, so it leaves no data behind

If `notifications.sql` errors at `create extension pg_cron`, enable **pg_cron**
in Dashboard → Database → Extensions and run the cron block at the bottom again.

## 2. Firebase (manual — only you can do this)

1. Create a Firebase project (or use an existing one).
2. Add an **Android app** with package name `com.vibetix.app`.
3. Download `google-services.json` and put it at
   `android/app/google-services.json`.
   The Gradle file only applies the Google Services plugin when that file
   exists, so builds keep working before this step.
4. Project settings → **Service accounts** → *Generate new private key*.
   Keep that JSON file secret.
5. In Firebase → Project settings → Cloud Messaging, confirm the FCM API is
   enabled for the project.

## 3. Supabase secrets + Edge Function (manual)

```bash
# from the project root, with the Supabase CLI logged in
supabase secrets set FIREBASE_SERVICE_ACCOUNT="$(cat path/to/service-account.json)"
supabase secrets set WEBHOOK_SECRET="<a long random string>"

supabase functions deploy send-push --project-ref vtocnpgguwggpgvvylzn --no-verify-jwt
```

`--no-verify-jwt` is required because the database webhook is server-to-server
and has no user JWT. `WEBHOOK_SECRET` protects the function instead.

## 4. Database webhook (manual)

Dashboard → Database → Webhooks → **Create a new hook**:

| Field | Value |
|---|---|
| Name | `notifications-send-push` |
| Table | `public.notifications` |
| Events | `INSERT` |
| Type | `Supabase Edge Function` |
| Function | `send-push` |
| HTTP header | `x-webhook-secret: <same secret as step 3>` |

Without the webhook, in-app notifications still work; only phone push is missing.

## 5. Build & run on Android

Tested toolchain for this project: Node 24, Capacitor 8, Android SDK 36.
Java 17+ and the Android SDK are required (Android Studio installs both).

```bash
npm install
npm run build                 # Angular → www
npx cap sync android          # copy www + plugins into android/
npx cap open android          # opens Android Studio
```

In Android Studio:

1. Let Gradle sync.
2. Pick a **real device** (USB debugging) or an **emulator with Google Play
   services** (the plain AOSP image has no FCM).
3. Run ▶.

Then in the app:

1. Sign in. The app asks for notification permission (Android 13+).
2. Buy a ticket → the purchase creates a row in `notifications`; the webhook
   sends the push; the bell badge updates live.
3. Scan the ticket as staff → the customer gets “You’re checked in”.
4. A ticket for an event < 24h away gets one reminder per hour window; the
   device also has a local backup scheduled 24h before the show.

If you change web code later: `npm run build && npx cap sync android`.

## 6. What to expect in the database

```sql
-- newest first, one user
select type, title, body, data, read_at, created_at
from public.notifications
where user_id = auth.uid()
order by created_at desc;

-- reminder job history
select * from cron.job where jobname = 'vibetix-event-reminders';
select * from cron.job_run_details order by start_time desc limit 5;

-- registered devices
select user_id, platform, updated_at from public.device_tokens;
```

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| Bell shows 0 but rows exist | Run `notifications.sql` (RLS + realtime publication); check the user is signed in with that `user_id`. |
| In-app works, phone doesn't | Check `google-services.json`, the webhook, `send-push` logs, and the FCM service account secret. |
| `send-push` returns 401 | `x-webhook-secret` header doesn't match `WEBHOOK_SECRET`. |
| No reminder | `pg_cron` not enabled, or the event is not inside the next 24h. Run `select public.create_event_reminders();` manually. |
| Duplicate reminder | Both push and local fired: the app cancels the local one when the reminder push arrives; make sure the Android build is up to date (`npx cap sync android`). |
| Web build has no phone notifications | Expected — native push/local calls are skipped in the browser. The in-app inbox still works. |

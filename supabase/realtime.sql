-- ═════════ VIBETIX — enable realtime push for the concerts table ═════════
-- Run once in the Supabase SQL Editor. After this, every insert/update/
-- delete on `concerts` is broadcast to all connected app clients, so
-- customer screens (Explore, calendar) update within milliseconds of an
-- admin creating an event.

alter publication supabase_realtime add table public.concerts;
alter publication supabase_realtime add table public.bookings;
alter publication supabase_realtime add table public.seats;

-- Verify it took effect:
select * from pg_publication_tables where pubname = 'supabase_realtime';

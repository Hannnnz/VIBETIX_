import { Injectable, NgZone } from '@angular/core';
import { Subject } from 'rxjs';

import { SupabaseService } from './supabase.service';

export interface Concert {
  id: string;
  name: string;
  artist: string;
  genre: string;
  venue: string;
  /** ISO date: YYYY-MM-DD */
  date: string;
  time: string;
  price: number;
  description: string;
  /** Optional real cover image; falls back to the emoji + gradient. */
  imageUrl?: string;
  /** House rules shown to attendees and managed by admins. */
  rules?: string;
  emoji: string;
  /** Index of the gradient used for the cover (1..6). */
  color: number;
}

export interface TicketTier {
  id: string;
  concertId: string;
  name: string;
  multiplier: number;
}

interface ConcertRow {
  id: string;
  name: string;
  artist: string;
  genre: string;
  venue: string;
  event_date: string;
  event_time: string;
  base_price: number;
  description: string;
  image_url: string | null;
  rules: string | null;
  emoji: string;
  color: number;
  status?: string;
}

const FALLBACK_TIERS: { name: string; multiplier: number }[] = [
  { name: 'Gen Ad', multiplier: 1.0 },
  { name: 'Upper Box', multiplier: 1.25 },
  { name: 'Lower Box', multiplier: 1.5 },
  { name: 'VIP', multiplier: 2.0 },
  { name: 'SVIP', multiplier: 3.0 },
];

/**
 * The concert catalog now lives in the Supabase `concerts` table.
 * Pages read the synchronous cache (same API as before); `hydrate()`
 * pulls the live data from PostgreSQL — called on page entry.
 */
@Injectable({ providedIn: 'root' })
export class ConcertService {
  concerts: Concert[] = [];
  tiers: TicketTier[] = [];
  /** Human-readable reason of the last failed save (shown by the form). */
  lastSaveError = '';

  /**
   * Emits whenever the catalog changed — realtime push from the DB,
   * or a local admin edit. Pages subscribe to repaint instantly.
   */
  readonly changes$ = new Subject<void>();

  private realtimeTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private sb: SupabaseService,
    private zone: NgZone
  ) {
    // 🔴 Realtime: any admin creates/updates/deletes an event → every
    // open screen (customer Explore, calendar, admin pages) refreshes
    // itself within milliseconds. Requires:
    //   alter publication supabase_realtime add table concerts;
    this.client
      .channel('vibetix-concerts')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'concerts' },
        () => {
          // debounce: burst edits collapse into one refetch
          if (this.realtimeTimer) {
            clearTimeout(this.realtimeTimer);
          }
          this.realtimeTimer = setTimeout(() => void this.hydrate(), 250);
        }
      )
      .subscribe();

    setInterval(() => void this.hydrate(), 5000);
  }

  private get client() {
    return this.sb.client;
  }

  private map(row: ConcertRow): Concert {
    return {
      id: row.id,
      name: row.name,
      artist: row.artist,
      genre: row.genre,
      venue: row.venue,
      date: row.event_date,
      time: row.event_time,
      price: Number(row.base_price),
      description: row.description,
      imageUrl: row.image_url ?? undefined,
      rules: row.rules ?? undefined,
      emoji: row.emoji,
      color: row.color,
    };
  }

  /** Pulls concerts + tiers from the real database. */
  async hydrate(): Promise<void> {
    try {
      const { data, error } = await this.client
        .from('concerts')
        .select('*, tiers:ticket_tiers(id, concert_id, name, multiplier)')
        .order('event_date', { ascending: true });
      if (error || !data) {
        console.error('concerts hydrate failed:', error?.message ?? error);
        return;
      }
      this.zone.run(() => {
        const rows = data as (ConcertRow & {
          tiers: { id: string; concert_id: string; name: string; multiplier: number }[];
        })[];
        this.concerts = rows.filter((r) => r.status !== 'draft').map((r) => this.map(r));
        this.tiers = rows.flatMap((r) =>
          (r.tiers ?? []).map((t) => ({
            id: t.id,
            concertId: t.concert_id,
            name: t.name,
            multiplier: Number(t.multiplier),
          }))
        );
        this.changes$.next();
      });
    } catch {
      /* offline — keep the current cache */
    }
  }

  getAll(): Concert[] {
    return this.concerts;
  }

  getById(id: string): Concert | undefined {
    return this.concerts.find((c) => c.id === id);
  }

  /**
   * Ensures a single concert is present in the local cache, hydrating the
   * whole catalog first and falling back to a direct DB fetch by id.
   * Used by detail/checkout pages so a created event is never reported as
   * "not found" just because the cache was empty or stale.
   */
  async ensureLoaded(id: string): Promise<Concert | undefined> {
    if (!id) {
      return undefined;
    }
    let found = this.getById(id);
    if (found) {
      return found;
    }
    await this.hydrate().catch(() => undefined);
    found = this.getById(id);
    if (found) {
      return found;
    }
    try {
      const { data, error } = await this.client
        .from('concerts')
        .select('*, tiers:ticket_tiers(id, concert_id, name, multiplier)')
        .eq('id', id)
        .single();
      if (error || !data) {
        return this.getById(id);
      }
      const row = data as ConcertRow & {
        tiers: { id: string; concert_id: string; name: string; multiplier: number }[];
        status?: string;
      };
      if (row.status === 'draft') {
        return this.getById(id);
      }
      this.zone.run(() => {
        const concert = this.map(row);
        const idx = this.concerts.findIndex((c) => c.id === concert.id);
        if (idx >= 0) {
          this.concerts[idx] = concert;
        } else {
          this.concerts.push(concert);
        }
        this.tiers = this.tiers.filter((t) => t.concertId !== concert.id);
        this.tiers.push(
          ...(row.tiers ?? []).map((t) => ({
            id: t.id,
            concertId: t.concert_id,
            name: t.name,
            multiplier: Number(t.multiplier),
          }))
        );
        this.changes$.next();
      });
    } catch (e) {
      console.error('concert direct fetch failed:', e);
    }
    return this.getById(id);
  }

  /** Tiers for a concert — DB-seeded when present, sensible fallback otherwise. */
  tiersFor(concertId: string): { id?: string; name: string; multiplier: number }[] {
    const db = this.tiers.filter((t) => t.concertId === concertId);
    if (db.length > 0) {
      return db.map((t) => ({ id: t.id, name: t.name, multiplier: t.multiplier }));
    }
    return FALLBACK_TIERS;
  }

  /** Server-computed price for a tier (base × multiplier). */
  tierPrice(concertId: string, tierName: string, fallbackMultiplier = 1): number {
    const concert = this.getById(concertId);
    if (!concert) {
      return 0;
    }
    const tier = this.tiersFor(concertId).find(
      (t) => t.name.toLowerCase() === tierName.toLowerCase()
    );
    const multiplier = tier?.multiplier ?? fallbackMultiplier;
    return Math.round(concert.price * multiplier * 100) / 100;
  }

  async add(input: Omit<Concert, 'id' | 'color'>): Promise<Concert | null> {
    const color = Math.floor(Math.random() * 6) + 1;
    const me = await this.client.auth.getUser();
    const row = {
      name: input.name,
      artist: input.artist,
      genre: input.genre,
      venue: input.venue,
      event_date: input.date,
      event_time: input.time,
      base_price: input.price,
      description: input.description,
      image_url: input.imageUrl ?? null,
      rules: input.rules ?? null,
      emoji: input.emoji,
      color,
      status: 'published' as const,
      created_by: me.data?.user?.id ?? null,
    };
    const { data, error } = await this.client
      .from('concerts')
      .insert(row)
      .select()
      .single();
    if (error || !data) {
      this.zone.run(() => (this.lastSaveError = error?.message ?? 'Unknown error'));
      console.error('concert add failed', error);
      return null;
    }
    // Tier trigger seeds the 5 classes — pull them.
    const { data: fresh } = await this.client
      .from('concerts')
      .select('*, tiers:ticket_tiers(id, concert_id, name, multiplier)')
      .eq('id', (data as ConcertRow).id)
      .single();
    if (fresh) {
      const mapped = fresh as ConcertRow & {
        tiers: { id: string; concert_id: string; name: string; multiplier: number }[];
      };
      this.zone.run(() => {
        this.concerts = [this.map(mapped), ...this.concerts];
        this.tiers = [
          ...this.tiers.filter((t) => t.concertId !== mapped.id),
          ...(mapped.tiers ?? []).map((t) => ({
            id: t.id,
            concertId: t.concert_id,
            name: t.name,
            multiplier: Number(t.multiplier),
          })),
        ];
        this.changes$.next();
      });
      return this.getById(mapped.id) ?? null;
    }
    return null;
  }

  async update(id: string, changes: Partial<Concert>): Promise<void> {
    const payload: Record<string, unknown> = {};
    if (changes.name !== undefined) payload['name'] = changes.name;
    if (changes.artist !== undefined) payload['artist'] = changes.artist;
    if (changes.genre !== undefined) payload['genre'] = changes.genre;
    if (changes.venue !== undefined) payload['venue'] = changes.venue;
    if (changes.date !== undefined) payload['event_date'] = changes.date;
    if (changes.time !== undefined) payload['event_time'] = changes.time;
    if (changes.price !== undefined) payload['base_price'] = changes.price;
    if (changes.description !== undefined) payload['description'] = changes.description;
    if (changes.imageUrl !== undefined) payload['image_url'] = changes.imageUrl ?? null;
    if (changes.rules !== undefined) payload['rules'] = changes.rules ?? null;
    if (changes.emoji !== undefined) payload['emoji'] = changes.emoji;
    if (Object.keys(payload).length === 0) {
      return;
    }
    const { error } = await this.client
      .from('concerts')
      .update(payload)
      .eq('id', id);
    if (error) {
      this.zone.run(() => (this.lastSaveError = error.message));
      console.error('concert update failed', error);
      return;
    }
    this.lastSaveError = '';
    this.zone.run(() => {
      this.concerts = this.concerts.map((c) =>
        c.id === id ? { ...c, ...changes, id: c.id, color: c.color } : c
      );
      this.changes$.next();
    });
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.client.from('concerts').delete().eq('id', id);
    if (error) {
      this.zone.run(() => (this.lastSaveError = error.message));
      console.error('concert remove failed', error);
      return;
    }
    this.lastSaveError = '';
    this.zone.run(() => {
      this.concerts = this.concerts.filter((c) => c.id !== id);
      this.tiers = this.tiers.filter((t) => t.concertId !== id);
      this.changes$.next();
    });
  }
}

import { Injectable, NgZone } from '@angular/core';

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

  constructor(
    private sb: SupabaseService,
    private zone: NgZone
  ) {}

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
      status: 'published',
    };
    const { data, error } = await this.client
      .from('concerts')
      .insert(row)
      .select()
      .single();
    if (error || !data) {
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
      console.error('concert update failed', error);
      return;
    }
    this.zone.run(() => {
      this.concerts = this.concerts.map((c) =>
        c.id === id ? { ...c, ...changes, id: c.id, color: c.color } : c
      );
    });
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.client.from('concerts').delete().eq('id', id);
    if (error) {
      console.error('concert remove failed', error);
      return;
    }
    this.zone.run(() => {
      this.concerts = this.concerts.filter((c) => c.id !== id);
      this.tiers = this.tiers.filter((t) => t.concertId !== id);
    });
  }
}

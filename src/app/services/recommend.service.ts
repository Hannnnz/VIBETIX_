import { Injectable } from '@angular/core';

import { AuthService } from './auth.service';
import { Concert } from './concert.service';

/**
 * VIBETIX recommendation engine (pure frontend, in-memory).
 *
 * Learns per-user taste from three signals:
 *   ♥ love   (toggle on a concert)   → strong affinity for its band + genre
 *   👁 view  (opens a concert page)  → mild curiosity signal
 *   🎟 bought (a completed order)     → strongest possible signal
 *
 * Explore then RANKS concerts so gigs from the user's favourite bands
 * and genres consistently appear first, loved ones always on top.
 * Everything resets on app restart like the rest of the demo.
 */

interface AffinityState {
  /** Concert ids the user hearted. */
  loved: Set<string>;
  /** How many times each concert's detail was opened. */
  views: Record<string, number>;
  /** Band affinity — accumulates from every signal. */
  artist: Record<string, number>;
  /** Genre affinity — accumulates from every signal. */
  genre: Record<string, number>;
  /** Concert ids the user actually ordered tickets for. */
  purchased: Set<string>;
}

const WEIGHT = {
  /** The loved event itself always floatup near the top. */
  lovedDirect: 40,
  /** Each past purchase of this event. */
  purchasedDirect: 25,
  /** Each previous click-through to this event. */
  concertViews: 6,
  /** Band affinity multiplier. */
  artist: 3,
  /** Genre affinity multiplier. */
  genre: 2,
};

/** Points added per signal. */
const SIGNAL = {
  love: 3,
  view: 1,
  purchase: 4,
};

function blankState(): AffinityState {
  return {
    loved: new Set<string>(),
    views: {},
    artist: {},
    genre: {},
    purchased: new Set<string>(),
  };
}

@Injectable({ providedIn: 'root' })
export class RecommendService {
  /** Affinity per user email (guest included). */
  private store: Record<string, AffinityState> = {};

  constructor(private auth: AuthService) {}

  private state(email: string): AffinityState {
    const key = email || 'guest';
    if (!this.store[key]) {
      this.store[key] = blankState();
    }
    return this.store[key];
  }

  private email(): string {
    try {
      return this.auth.getSession()?.email ?? 'guest';
    } catch {
      return 'guest';
    }
  }

  // ── Signals ────────────────────────────────────────────────────────────

  /** ♥ toggled from the Explore card. */
  toggleLove(concert: Concert): boolean {
    const state = this.state(this.email());
    const id = concert.id;
    const delta = 1;
    if (state.loved.has(id)) {
      state.loved.delete(id);
      state.artist[concert.artist] = Math.max(
        0,
        (state.artist[concert.artist] ?? 0) - SIGNAL.love
      );
      state.genre[concert.genre] = Math.max(
        0,
        (state.genre[concert.genre] ?? 0) - SIGNAL.love
      );
      return false;
    }
    state.loved.add(id);
    state.artist[concert.artist] = (state.artist[concert.artist] ?? 0) + delta * SIGNAL.love;
    state.genre[concert.genre] = (state.genre[concert.genre] ?? 0) + delta * SIGNAL.love;
    return true; // now loved
  }

  isLoved(concertId: string): boolean {
    return this.state(this.email()).loved.has(concertId);
  }

  lovedCount(): number {
    return this.state(this.email()).loved.size;
  }

  /** Opened a concert's page — curiosity signal for band + genre. */
  recordView(concert: Concert): void {
    const state = this.state(this.email());
    state.views[concert.id] = (state.views[concert.id] ?? 0) + 1;
    state.artist[concert.artist] = (state.artist[concert.artist] ?? 0) + SIGNAL.view;
    state.genre[concert.genre] = (state.genre[concert.genre] ?? 0) + SIGNAL.view;
  }

  /** Order settled for an event — the strongest taste signal. */
  recordPurchase(concert: Concert): void {
    const state = this.state(this.email());
    state.purchased.add(concert.id);
    state.artist[concert.artist] = (state.artist[concert.artist] ?? 0) + SIGNAL.purchase;
    state.genre[concert.genre] = (state.genre[concert.genre] ?? 0) + SIGNAL.purchase;
  }

  // ── Ranking ────────────────────────────────────────────────────────────

  /**
   * Personal score for one concert (higher = more "for you").
   * Exposed so pages can show “Why am I seeing this?” later.
   */
  score(concert: Concert): number {
    const state = this.state(this.email());
    let score = 0;
    if (state.loved.has(concert.id)) {
      score += WEIGHT.lovedDirect;
    }
    if (state.purchased.has(concert.id)) {
      score += WEIGHT.purchasedDirect;
    }
    score += (state.views[concert.id] ?? 0) * WEIGHT.concertViews;
    score += (state.artist[concert.artist] ?? 0) * WEIGHT.artist;
    score += (state.genre[concert.genre] ?? 0) * WEIGHT.genre;
    return Math.round(score);
  }

  /**
   * Ranks a list for Explore: favourite bands / genres consistently first,
   * loved ♥ and purchased events pinned to the very top.
   * Ties fall back to soonest date so the feed stays stable.
   */
  rank(list: Concert[]): Concert[] {
    return [...list].sort((a, b) => {
      const diff = this.score(b) - this.score(a);
      if (diff !== 0) {
        return diff;
      }
      return a.date.localeCompare(b.date); // stable fallback
    });
  }
}

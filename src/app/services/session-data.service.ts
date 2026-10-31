import { Injectable } from '@angular/core';

import { Session } from './auth.service';
import { BookingService } from './booking.service';
import { ConcertService } from './concert.service';
import { PaymentService } from './payment.service';
import { RecommendService } from './recommend.service';

/**
 * Warms every data cache a signed-in user needs.
 *
 * The Supabase client is created at app boot (see `app.module.ts`), but the
 * individual screens still fetch on entry. When a login happens on a cold
 * client — especially on a phone — those fetches could race the freshly
 * persisted session and come back empty, which is why pages used to need a
 * manual pull-to-refresh before showing anything.
 *
 * Calling `warm()` right after login (and whenever the session is restored)
 * means the screens open with data already in their synchronous caches.
 */
@Injectable({ providedIn: 'root' })
export class SessionDataService {
  private inflight: { email: string; promise: Promise<void> } | null = null;

  constructor(
    private concerts: ConcertService,
    private bookings: BookingService,
    private payments: PaymentService,
    private recommend: RecommendService
  ) {}

  /**
   * Preloads concerts, bookings, saved payment methods and taste signals.
   * Always resolves — a slow/offline network must never block the UI.
   */
  warm(session: Session | null, timeoutMs = 15000): Promise<void> {
    if (!session) {
      return Promise.resolve();
    }
    // Login emits an auth change (AppComponent warms) *and* the login page
    // awaits warm() — share the same request instead of fetching twice.
    if (this.inflight?.email === session.email) {
      return this.inflight.promise;
    }

    const work = Promise.all([
      this.concerts.hydrate().catch(() => undefined),
      this.bookings.hydrate().catch(() => undefined),
      this.payments.hydrate(session.email).catch(() => undefined),
      this.recommend.hydrate().catch(() => undefined),
    ])
      .then(() => undefined)
      .finally(() => {
        if (this.inflight?.email === session.email) {
          this.inflight = null;
        }
      });

    const promise = Promise.race([
      work,
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);

    this.inflight = { email: session.email, promise };
    return promise;
  }
}

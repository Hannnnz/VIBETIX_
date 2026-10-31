import { Injectable, NgZone } from '@angular/core';
import { Subject } from 'rxjs';

import { AuthService, Session } from './auth.service';
import { SupabaseService } from './supabase.service';

export type BookingStatus = 'active' | 'checked-in';

export interface Booking {
  id: string;
  /** Human-readable ticket code shown in tickets and during check-in. */
  ticketCode: string;
  concertId: string;
  customerId: string;
  customerEmail: string;
  customerName: string;
  /** Ticket class bought, e.g. VIP, SVIP, Gen Ad. */
  tier: string;
  /** Actual seat codes picked on the seat map, e.g. ['A4', 'A5']. */
  seats: string[];
  /** Payment channel the booking was settled with. */
  paidVia: string;
  quantity: number;
  total: number;
  status: BookingStatus;
  createdAt: string;
}

interface BookingRow {
  id: string;
  ticket_code: string;
  concert_id: string;
  customer_id: string;
  tier_name: string;
  unit_price: number;
  quantity: number;
  total_amount: number;
  status: string;
  paid_via: string;
  created_at: string;
  seats?: { seat_code: string }[];
  customer?: { email: string; full_name: string } | null;
}

/**
 * Bookings now live in the Supabase `bookings` table.
 * Buying goes through the `place_booking` PostgreSQL function:
 *  - price is computed SERVER-side (base × tier multiplier)
 *  - the unique(seat) constraint makes double-selling impossible
 *  - payment reference is masked only
 */
@Injectable({ providedIn: 'root' })
export class BookingService {
  bookings: Booking[] = [];

  /** Human-readable reason of the last failed booking (shown at checkout). */
  lastError = '';

  /** Last hydrate diagnostics (helps surface empty-list causes). */
  lastHydrateError = '';
  lastHydrateCount = 0;

  /** Currently signed-in user id/email, used to scope + label bookings. */
  currentUserId = '';
  currentUserEmail = '';

  /** The ticket the user opened in the detail view (avoids fragile code lookups). */
  selectedBooking: Booking | null = null;

  private realtimeTimer?: ReturnType<typeof setTimeout>;

  /** Emits after the local booking cache changes (refetch / new booking). */
  readonly changes$ = new Subject<void>();

  constructor(
    private sb: SupabaseService,
    private auth: AuthService,
    private zone: NgZone
  ) {
    // 🔴 Realtime: any booking change (new ticket, check-in) refreshes the cache.
    try {
      this.client
        .channel('vibetix-bookings')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'bookings' },
          () => {
            if (this.realtimeTimer) {
              clearTimeout(this.realtimeTimer);
            }
            this.realtimeTimer = setTimeout(() => void this.hydrate(), 250);
          }
        )
        .subscribe();
    } catch {
      /* realtime optional */
    }
  }

  private get client() {
    return this.sb.client;
  }

  private map(row: BookingRow, fallbackEmail = '', fallbackName = ''): Booking {
    const uid = this.currentUserId;
    const email =
      row.customer?.email ??
      (row.customer_id === uid ? (this.currentUserEmail || fallbackEmail) : fallbackEmail);
    const name =
      row.customer?.full_name ??
      (row.customer_id === uid ? fallbackName : fallbackName);
    return {
      id: row.id,
      ticketCode: row.ticket_code,
      concertId: row.concert_id,
      customerId: row.customer_id,
      customerEmail: email,
      customerName: name,
      tier: row.tier_name,
      seats: (row.seats ?? []).map((s) => s.seat_code).sort(),
      paidVia: row.paid_via,
      quantity: row.quantity,
      total: Number(row.total_amount ?? row.unit_price * row.quantity),
      status: row.status === 'paid' ? 'active' : 'checked-in',
      createdAt: row.created_at,
    };
  }

  /** Loads my bookings (customer), or ALL bookings (staff/admin). */
  async hydrate(): Promise<void> {
    this.lastHydrateError = '';
    this.lastHydrateCount = 0;
    try {
      // Prefer the already-restored auth cache (most reliable after splash).
      const cachedSession = this.auth.getSession();
      const cachedUid = this.auth.getUserId();
      let uid = cachedUid ?? '';
      let userEmail = cachedSession?.email ?? '';

      // Fall back to the Supabase client session if the cache is empty.
      if (!uid) {
        const { data: sessionData } = await this.sb.client.auth.getSession();
        uid = sessionData.session?.user?.id ?? '';
        userEmail = sessionData.session?.user?.email ?? userEmail;
      }
      if (!uid) {
        const me = await this.sb.client.auth.getUser();
        uid = me.data?.user?.id ?? '';
        userEmail = me.data?.user?.email ?? userEmail;
      }
      this.currentUserId = uid;
      this.currentUserEmail = userEmail;

      if (!uid) {
        this.lastHydrateError = 'Not signed in.';
        // No signed-in user — nothing to load.
        return;
      }

      // Resolve role (elevated users see every booking).
      let isElevated = false;
      if (cachedSession?.role === 'admin' || cachedSession?.role === 'staff') {
        isElevated = true;
      } else {
        try {
          const { data: profile } = await this.client
            .from('profiles')
            .select('role')
            .eq('id', uid)
            .single();
          isElevated =
            profile?.role === 'admin' || profile?.role === 'staff';
        } catch {
          /* treat as customer */
        }
      }

      // Fetch bookings. Prefer the security-definer RPCs (they bypass any
      // broken/missing RLS policies); fall back to a direct query.
      let bookingRows: any[] | null = null;
      let fetchError: { message?: string } | null = null;
      try {
        const rpcName = isElevated ? 'get_all_bookings' : 'get_my_bookings';
        const { data, error } = await this.client.rpc(rpcName);
        if (!error && Array.isArray(data)) {
          bookingRows = data;
        } else {
          fetchError = error ?? { message: 'RPC unavailable.' };
        }
      } catch (e) {
        fetchError = { message: (e as Error)?.message ?? 'RPC failed.' };
      }

      if (!bookingRows) {
        // Direct fallback (works when RLS is healthy).
        let q = this.client
          .from('bookings')
          .select('*')
          .order('created_at', { ascending: false });
        if (!isElevated) {
          q = q.eq('customer_id', uid);
        }
        const { data, error } = await q;
        if (error || !data) {
          this.lastHydrateError =
            fetchError?.message || error?.message || 'No data returned.';
          console.error('bookings hydrate failed:', error?.message ?? fetchError?.message);
          return;
        }
        bookingRows = data as any[];
      }

      const ids = (bookingRows as { id: string }[]).map((r) => r.id);

      // Fetch seats for these bookings (avoid fragile FK embeds).
      const seatsByBooking = new Map<string, { seat_code: string }[]>();
      if (ids.length > 0) {
        try {
          const { data: seatRows } = await this.client
            .from('seats')
            .select('booking_id, seat_code')
            .in('booking_id', ids);
          (seatRows ?? []).forEach((s: { booking_id: string; seat_code: string }) => {
            if (!seatsByBooking.has(s.booking_id)) {
              seatsByBooking.set(s.booking_id, []);
            }
            seatsByBooking.get(s.booking_id)!.push({ seat_code: s.seat_code });
          });
        } catch {
          /* seats optional */
        }
      }

      // For elevated users, fetch customer profiles to label each booking.
      const profileById = new Map<string, { email: string; full_name: string }>();
      if (isElevated) {
        const customerIds = [
          ...new Set((bookingRows as { customer_id: string }[]).map((r) => r.customer_id)),
        ];
        if (customerIds.length > 0) {
          try {
            const { data: profiles } = await this.client
              .from('profiles')
              .select('id, email, full_name')
              .in('id', customerIds);
            (profiles ?? []).forEach((p: { id: string; email: string; full_name: string }) => {
              profileById.set(p.id, { email: p.email, full_name: p.full_name });
            });
          } catch {
            /* optional */
          }
        }
      }

      const rows: BookingRow[] = (bookingRows as any[]).map((r) => {
        const prof = isElevated
          ? profileById.get(r.customer_id)
          : { email: userEmail, full_name: '' };
        return {
          id: r.id,
          ticket_code: r.ticket_code,
          concert_id: r.concert_id,
          customer_id: r.customer_id,
          tier_name: r.tier_name,
          unit_price: r.unit_price,
          quantity: r.quantity,
          total_amount: r.total_amount,
          status: r.status,
          paid_via: r.paid_via,
          created_at: r.created_at,
          seats: seatsByBooking.get(r.id) ?? [],
          customer: prof ? { email: prof.email, full_name: prof.full_name } : null,
        };
      });

      this.lastHydrateCount = rows.length;
      // Never wipe a previously populated cache with an empty result —
      // keeps tickets visible if a transient query/RPC returns nothing.
      if (rows.length === 0 && this.bookings.length > 0) {
        this.lastHydrateError = 'Empty result; kept previous cache.';
        return;
      }
      this.cacheRows(rows, userEmail, '');
    } catch (e) {
      this.lastHydrateError = (e as Error)?.message ?? 'Unknown error.';
      /* keep the current cache */
    }
  }

  private cacheRows(rows: BookingRow[], email: string, name: string): void {
    this.zone.run(() => {
      this.bookings = rows.map((r) => this.map(r, email, name));
      this.changes$.next();
    });
  }

  /**
   * Setstle a purchase through the database function.
   * Returns null when seats were taken / validation failed.
   */
  async create(
    concertId: string,
    tierId: string | null,
    tierName: string,
    seats: string[],
    paidVia: string
  ): Promise<Booking | null> {
    this.lastError = '';
    const params = {
      p_concert_id: concertId,
      p_tier_id: tierId,
      p_tier_name: tierName,
      p_seat_codes: seats.map((s) => s.trim().toUpperCase()),
      p_paid_via: paidVia,
    };
    const { data, error } = await this.client.rpc('place_booking', params);
    if (error) {
      this.lastError = this.explainError(error);
      console.error('place_booking failed:', error.message);
      return null;
    }
    const payload = data as {
      id: string;
      ticket_code: string;
      tier: string;
      unit_price: number;
      quantity: number;
      total: number;
      paid_via: string;
      created_at: string;
      seats: string[];
    };

    const me = await this.sb.client.auth.getUser();
    const uid = me.data?.user?.id ?? '';
    const email = me.data?.user?.email ?? '';
    this.currentUserId = uid || this.currentUserId;
    this.currentUserEmail = email || this.currentUserEmail;
    const booking: Booking = {
      id: payload.id,
      ticketCode: payload.ticket_code,
      concertId,
      customerId: uid,
      customerEmail: email,
      customerName: '',
      tier: payload.tier,
      seats: payload.seats,
      paidVia: payload.paid_via,
      quantity: payload.quantity,
      total: Number(payload.total),
      status: 'active',
      createdAt: payload.created_at,
    };
    this.zone.run(() => {
      this.bookings = [booking, ...this.bookings];
      this.changes$.next();
    });
    return booking;
  }

  /** Seat codes that are already sold for a concert (always fresh). */
  async takenSeats(concertId: string): Promise<Set<string>> {
    try {
      const { data, error } = await this.client
        .from('seats')
        .select('seat_code')
        .eq('concert_id', concertId);
      if (error || !data) {
        return new Set();
      }
      return new Set(
        (data as { seat_code: string }[]).map((row) => row.seat_code.toUpperCase())
      );
    } catch {
      return new Set();
    }
  }

  /**
   * Turns raw PostgREST/Postgres errors into something a customer can act on.
   * In particular, a missing `place_booking` RPC used to surface only as the
   * misleading "Seat conflict or payment issue".
   */
  private explainError(error: {
    message?: string;
    details?: string;
    hint?: string;
    code?: string;
  }): string {
    const text = [error?.message, error?.details, error?.hint]
      .filter(Boolean)
      .join(' ');

    if (/could not find the function|schema cache|PGRST202/i.test(text)) {
      return 'Checkout backend is not installed yet — run supabase/fix-checkout.sql in the Supabase SQL Editor, then try again.';
    }
    if (/seat already taken|duplicate key|unique constraint/i.test(text)) {
      return 'Those seats were just taken — pick different seats and try again.';
    }
    if (/sign in first|not authenticated|jwt|session.*expired|row-level security/i.test(text)) {
      return 'Your session expired — please sign in again.';
    }
    if (/ticket tier not found/i.test(text)) {
      return 'That ticket class is no longer available for this event.';
    }
    if (/concert not found/i.test(text)) {
      return 'This event is no longer available.';
    }
    if (/pick between 1 and 6 seats/i.test(text)) {
      return 'Pick between 1 and 6 seats.';
    }
    return error?.message || 'Payment could not be completed — please try again.';
  }

  getAll(): Booking[] {
    return [...this.bookings].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getBookingsFor(email: string): Booking[] {
    return this.getAll().filter((b) => b.customerEmail === email);
  }

  findByTicketCode(code: string): Booking | undefined {
    const normalized = code.trim().toUpperCase();
    return this.bookings.find((b) => b.ticketCode === normalized);
  }

  /**
   * Gate check-in — goes through the `check_in_ticket` Postgres function.
   * Error semantics: NOT_FOUND / NOT_PAID / ALREADY_USED (as {error}).
   */
  async gateCheckIn(ticketCode: string): Promise<
    { ok: true; message: string } | { ok: false; reason: string }
  > {
    const { data, error } = await this.client.rpc('check_in_ticket', {
      p_ticket_code: ticketCode.trim(),
    });
    if (error) {
      const msg = error.message;
      if (msg.includes('NOT_FOUND')) return { ok: false, reason: 'invalid' };
      if (msg.includes('ALREADY_USED')) return { ok: false, reason: 'already-used' };
      if (msg.includes('NOT_PAID')) return { ok: false, reason: 'not-paid' };
      return { ok: false, reason: msg };
    }
    void this.hydrate(); // refresh local list/stat
    const payload = data as { ticket_code: string; seats: string[]; tier: string };
    return {
      ok: true,
      message: `${payload.ticket_code} checked in · seat(s) ${payload.seats.join(', ')}`,
    };
  }

  /** Simple dashboard numbers for Staff/Admin screens. */
  stats(): { bookings: number; tickets: number; checkedIn: number; revenue: number } {
    return {
      bookings: this.bookings.length,
      tickets: this.bookings.reduce((sum, b) => sum + b.quantity, 0),
      checkedIn: this.bookings.filter((b) => b.status === 'checked-in').length,
      revenue: this.bookings.reduce((sum, b) => sum + b.total, 0),
    };
  }

  /** Seats sold per ticket class, for the admin dashboard bars. */
  seatsPerTier(tiers: string[]): { tier: string; count: number }[] {
    return tiers.map((tier) => ({
      tier,
      count: this.bookings
        .filter((b) => b.tier === tier)
        .reduce((sum, b) => sum + b.quantity, 0),
    }));
  }
}

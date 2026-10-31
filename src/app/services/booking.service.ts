import { Injectable, NgZone } from '@angular/core';
import { Subject } from 'rxjs';

import { Session } from './auth.service';
import { SupabaseService } from './supabase.service';

export type BookingStatus = 'active' | 'checked-in';

export interface Booking {
  id: string;
  /** Human-readable ticket code shown in tickets and during check-in. */
  ticketCode: string;
  concertId: string;
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

  /** Emits after the local booking cache changes (refetch / new booking). */
  readonly changes$ = new Subject<void>();

  constructor(
    private sb: SupabaseService,
    private zone: NgZone
  ) {}

  private get client() {
    return this.sb.client;
  }

  private map(row: BookingRow, fallbackEmail = '', fallbackName = ''): Booking {
    return {
      id: row.id,
      ticketCode: row.ticket_code,
      concertId: row.concert_id,
      customerEmail: row.customer?.email ?? fallbackEmail,
      customerName: row.customer?.full_name ?? fallbackName,
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
    try {
      const me = this.sb.client.auth.getUser();
      const { data: profile } = await this.client
        .from('profiles')
        .select('role')
        .eq('id', (await me).data?.user?.id ?? '')
        .single();
      const isElevated =
        profile?.role === 'admin' || profile?.role === 'staff';

      const query = this.client
        .from('bookings')
        .select(
          `*, seats(seat_code),
           customer:profiles!bookings_customer_id_fkey(email, full_name)`
        )
        .order('created_at', { ascending: false });

      const { data, error } = isElevated
        ? await query
        : await query.eq('customer_id', (await me).data?.user?.id ?? '');
      if (error) {
        // Fallback without the embed (works even if FK naming differs)
        const fallback = await this.client
          .from('bookings')
          .select('*')
          .order('created_at', { ascending: false });
        if (fallback.data) {
          this.cacheRows(fallback.data as BookingRow[], '', '');
        }
        return;
      }
      this.cacheRows((data ?? []) as BookingRow[], '', '');
    } catch {
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
    const booking: Booking = {
      id: payload.id,
      ticketCode: payload.ticket_code,
      concertId,
      customerEmail: me.data?.user?.email ?? '',
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

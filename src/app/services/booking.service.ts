import { Injectable, NgZone } from '@angular/core';

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
    const params = {
      p_concert_id: concertId,
      p_tier_id: tierId,
      p_tier_name: tierName,
      p_seat_codes: seats.map((s) => s.toUpperCase()),
      p_paid_via: paidVia,
    };
    const { data, error } = await this.client.rpc('place_booking', params);
    if (error) {
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
    });
    return booking;
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

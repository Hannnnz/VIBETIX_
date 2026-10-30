import { Injectable } from '@angular/core';

import { Concert } from './concert.service';
import { Session } from './auth.service';

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
  quantity: number;
  total: number;
  status: BookingStatus;
  createdAt: string;
}

/** A few sample purchases so Staff/Admin views are not empty on first run. */
const SEED: Booking[] = [
  {
    id: 'b1',
    ticketCode: 'VTX-K7R2M4',
    concertId: 'c1',
    customerEmail: 'user@gmail.com',
    customerName: 'Juan Customer',
    tier: 'VIP',
    seats: ['A4', 'A5'],
    quantity: 2,
    total: 7200,
    status: 'checked-in',
    createdAt: '2026-10-20T09:00:00.000Z',
  },
  {
    id: 'b2',
    ticketCode: 'VTX-Q3XW8D',
    concertId: 'c2',
    customerEmail: 'user@gmail.com',
    customerName: 'Juan Customer',
    tier: 'Lower Box',
    seats: ['B7'],
    quantity: 1,
    total: 4800,
    status: 'active',
    createdAt: '2026-10-25T14:30:00.000Z',
  },
  {
    id: 'b3',
    ticketCode: 'VTX-T9PL5F',
    concertId: 'c5',
    customerEmail: 'user@gmail.com',
    customerName: 'Juan Customer',
    tier: 'SVIP',
    seats: ['A1', 'A2', 'A3'],
    quantity: 3,
    total: 40500,
    status: 'active',
    createdAt: '2026-10-28T11:15:00.000Z',
  },
];

/**
 * Pure in-memory bookings for the frontend demo.
 * New purchases and check-ins work while the app is open, then reset.
 */
@Injectable({ providedIn: 'root' })
export class BookingService {
  bookings: Booking[] = [...SEED];

  private newTicketCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let suffix = '';
    for (let i = 0; i < 6; i++) {
      suffix += chars[Math.floor(Math.random() * chars.length)];
    }
    return `VTX-${suffix}`;
  }

  create(
    concert: Concert,
    tier: string,
    unitPrice: number,
    seats: string[],
    session: Session
  ): Booking {
    const booking: Booking = {
      id: 'b' + Date.now(),
      ticketCode: this.newTicketCode(),
      concertId: concert.id,
      customerEmail: session.email,
      customerName: session.name,
      tier,
      seats: [...seats],
      quantity: seats.length,
      total: unitPrice * seats.length,
      status: 'active',
      createdAt: new Date().toISOString(),
    };
    this.bookings = [booking, ...this.bookings];
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

  /** Marks a ticket as used / scanned at the venue gate. */
  checkIn(id: string): Booking | undefined {
    const booking = this.bookings.find((b) => b.id === id);
    if (booking && booking.status === 'active') {
      booking.status = 'checked-in';
    }
    return booking;
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

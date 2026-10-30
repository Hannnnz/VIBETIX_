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
    quantity: 2,
    total: 3600,
    status: 'checked-in',
    createdAt: '2026-10-20T09:00:00.000Z',
  },
  {
    id: 'b2',
    ticketCode: 'VTX-Q3XW8D',
    concertId: 'c2',
    customerEmail: 'user@gmail.com',
    customerName: 'Juan Customer',
    quantity: 1,
    total: 3200,
    status: 'active',
    createdAt: '2026-10-25T14:30:00.000Z',
  },
  {
    id: 'b3',
    ticketCode: 'VTX-T9PL5F',
    concertId: 'c5',
    customerEmail: 'user@gmail.com',
    customerName: 'Juan Customer',
    quantity: 3,
    total: 13500,
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

  create(concert: Concert, quantity: number, session: Session): Booking {
    const booking: Booking = {
      id: 'b' + Date.now(),
      ticketCode: this.newTicketCode(),
      concertId: concert.id,
      customerEmail: session.email,
      customerName: session.name,
      quantity,
      total: concert.price * quantity,
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
}

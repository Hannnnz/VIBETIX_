import { Component } from '@angular/core';

import { Booking, BookingService } from '../../services/booking.service';
import { Concert, ConcertService } from '../../services/concert.service';

@Component({
  selector: 'app-admin-bookings',
  templateUrl: './admin-bookings.page.html',
  styleUrls: ['./admin-bookings.page.scss'],
  standalone: false,
})
export class AdminBookingsPage {
  search = '';

  constructor(
    private bookingService: BookingService,
    private concertService: ConcertService
  ) {}

  ionViewWillEnter(): void {
    void this.bookingService.hydrate(); // live bookings incl. every customer
  }

  filtered(): Booking[] {
    const term = this.search.trim().toLowerCase();
    const all = this.bookingService.getAll();
    if (!term) {
      return all;
    }
    return all.filter((b) =>
      [b.ticketCode, b.customerName, b.customerEmail, b.tier, this.concertOf(b)?.name]
        .join(' ')
        .toLowerCase()
        .includes(term)
    );
  }

  concertOf(booking: Booking): Concert | undefined {
    return this.concertService.getById(booking.concertId);
  }

  dateLabel(date: string): string {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
}

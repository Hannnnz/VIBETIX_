import { Component } from '@angular/core';
import { Router } from '@angular/router';

import { Booking, BookingService } from '../services/booking.service';
import { Session, AuthService } from '../services/auth.service';
import { Concert, ConcertService } from '../services/concert.service';

@Component({
  selector: 'app-my-tickets',
  templateUrl: './my-tickets.page.html',
  styleUrls: ['./my-tickets.page.scss'],
  standalone: false,
})
export class MyTicketsPage {
  session: Session | null = null;
  bookings: Booking[] = [];

  constructor(
    private bookingService: BookingService,
    private concertService: ConcertService,
    public auth: AuthService,
    private router: Router
  ) {}

  ionViewWillEnter(): void {
    this.session = this.auth.getSession();
    this.bookings = this.session
      ? this.bookingService.getBookingsFor(this.session.email)
      : [];
  }

  /** Concert info for a booking (used for emoji / gradient / venue display). */
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

  goExplore(): void {
    this.router.navigateByUrl('/tabs/concerts');
  }
}

import { Component, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { Booking, BookingService } from '../services/booking.service';
import { Session, AuthService } from '../services/auth.service';
import { Concert, ConcertService } from '../services/concert.service';
import { eventDateTime, countdownString } from '../utils/countdown';

@Component({
  selector: 'app-my-tickets',
  templateUrl: './my-tickets.page.html',
  styleUrls: ['./my-tickets.page.scss'],
  standalone: false,
})
export class MyTicketsPage {
  session: Session | null = null;
  bookings: Booking[] = [];
  now = Date.now();
  private ticker?: ReturnType<typeof setInterval>;

  constructor(
    private bookingService: BookingService,
    private concertService: ConcertService,
    private auth: AuthService,
    private router: Router,
    private zone: NgZone
  ) {}
  ionViewWillEnter(): void {
    this.session = this.auth.getSession();
    const email = this.session?.email ?? '';
    // LIVE bookings from Supabase, then render
    void this.bookingService.hydrate().then(() => {
      this.zone.run(() => {
        this.bookings = email ? this.bookingService.getBookingsFor(email) : [];
      });
    });
    this.now = Date.now();
    // Live DD:HH:MM:SS ticking for upcoming shows
    this.zone.runOutsideAngular(() => {
      this.ticker = setInterval(() => {
        this.zone.run(() => (this.now = Date.now()));
      }, 1000);
    });
  }

  ionViewWillLeave(): void {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = undefined;
    }
  }

  /** Concert info for a booking (used for emoji / gradient / venue display). */
  concertOf(booking: Booking): Concert | undefined {
    return this.concertService.getById(booking.concertId);
  }

  /** Show date/time of the booking's concert. */
  showOf(booking: Booking): Date | null {
    const concert = this.concertOf(booking);
    return concert ? eventDateTime(concert) : null;
  }

  /** LIVE countdown: number of days: hours: minutes: seconds until the show */
  countdown(booking: Booking): string {
    const show = this.showOf(booking);
    if (!show) {
      return '00:00:00:00';
    }
    return countdownString(show, this.now);
  }

  isUpcoming(booking: Booking): boolean {
    const show = this.showOf(booking);
    return !!show && show.getTime() > this.now;
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

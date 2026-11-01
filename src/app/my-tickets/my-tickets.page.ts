import { ChangeDetectorRef, Component, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { Booking, BookingService } from '../services/booking.service';
import { Session, AuthService } from '../services/auth.service';
import { Concert, ConcertService } from '../services/concert.service';
import { eventDateTime, countdownString } from '../utils/countdown';
import { runRefresh } from '../utils/refresher';

@Component({
  selector: 'app-my-tickets',
  templateUrl: './my-tickets.page.html',
  styleUrls: ['./my-tickets.page.scss'],
  standalone: false,
})
export class MyTicketsPage {
  session: Session | null = null;
  bookings: Booking[] = [];
  search = '';
  now = Date.now();
  private ticker?: ReturnType<typeof setInterval>;
  private bookingChangesSub?: Subscription;
  private concertChangesSub?: Subscription;

  constructor(
    private bookingService: BookingService,
    private concertService: ConcertService,
    private auth: AuthService,
    private router: Router,
    private zone: NgZone,
    private cdr: ChangeDetectorRef
  ) {}
  async ionViewWillEnter(): Promise<void> {
    // Paint whatever the login/splash warm-up already cached, then refresh.
    this.session = this.auth.getSession();
    this.refreshBookingsList(this.session?.email ?? '');

    await this.auth.ensureSession().catch(() => undefined);
    this.zone.run(() => {
      this.session = this.auth.getSession();
      this.cdr.detectChanges();
    });
    const email = this.session?.email ?? '';

    // Subscribe to live data changes so the list updates without a manual refresh.
    this.bookingChangesSub?.unsubscribe();
    this.concertChangesSub?.unsubscribe();
    this.bookingChangesSub = this.bookingService.changes$.subscribe(() => {
      this.zone.run(() => {
        this.refreshBookingsList(email);
        this.cdr.detectChanges();
      });
    });
    this.concertChangesSub = this.concertService.changes$.subscribe(() => {
      this.zone.run(() => {
        this.now = Date.now();
        this.cdr.detectChanges();
      });
    });

    // LIVE bookings from Supabase, then render
    try {
      await this.bookingService.hydrate();
    } catch {
      /* keep current cache */
    }
    try {
      await this.concertService.hydrate();
    } catch {
      /* keep current cache */
    }
    this.zone.run(() => {
      this.refreshBookingsList(email);
      this.now = Date.now();
      this.cdr.detectChanges();
    });
    this.now = Date.now();
    // Live DD:HH:MM:SS ticking for upcoming shows
    this.zone.runOutsideAngular(() => {
      this.ticker = setInterval(() => {
        this.zone.run(() => {
          this.now = Date.now();
          this.cdr.detectChanges();
        });
      }, 1000);
    });
  }

  private refreshBookingsList(email: string): void {
    const all = this.bookingService.getAll();
    if (email) {
      this.bookings = all.filter(
        (b) => !b.customerEmail || b.customerEmail === email
      );
    } else {
      this.bookings = [...all];
    }
    if (this.bookings.length === 0 && all.length > 0) {
      this.bookings = [...all];
    }
  }

  ionViewWillLeave(): void {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = undefined;
    }
    this.bookingChangesSub?.unsubscribe();
    this.concertChangesSub?.unsubscribe();
  }

  /** Pull-down-to-refresh refetches tickets straight from Supabase. */
  async doRefresh(event: Event): Promise<void> {
    await runRefresh(event, async () => {
      await this.auth.ensureSession().catch(() => undefined);
      const email = this.auth.getSession()?.email ?? this.session?.email ?? '';
      this.zone.run(() => {
        this.session = this.auth.getSession();
        this.cdr.detectChanges();
      });
      await Promise.all([
        this.bookingService.hydrate(),
        this.concertService.hydrate(),
      ]).catch(() => undefined);
      this.zone.run(() => {
        this.refreshBookingsList(email);
        this.now = Date.now();
        this.cdr.detectChanges();
      });
    });
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

  /** Filters the owned tickets by concert name, code, tier, seat, etc. */
  filtered(): Booking[] {
    const term = this.search.trim().toLowerCase();
    if (!term) {
      return this.bookings;
    }
    return this.bookings.filter((b) => {
      const concert = this.concertOf(b);
      const haystack = [
        b.ticketCode,
        b.tier,
        b.paidVia,
        concert?.name,
        concert?.venue,
        concert?.artist,
        ...b.seats,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }

  openTicket(b: Booking): void {
    this.bookingService.selectedBooking = b;
    try {
      localStorage.setItem('vibetix:selectedTicket', b.ticketCode);
    } catch {
      /* ignore */
    }
    this.router.navigate(['/ticket', b.ticketCode], { state: { booking: b } });
  }

  goExplore(): void {
    this.router.navigateByUrl('/tabs/concerts');
  }
}

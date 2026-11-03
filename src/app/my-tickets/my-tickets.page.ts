import { ChangeDetectorRef, Component, NgZone } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastController } from '@ionic/angular/lazy';
import { Subscription } from 'rxjs';
import { Booking, BookingService } from '../services/booking.service';
import { Session, AuthService } from '../services/auth.service';
import { Concert, ConcertService } from '../services/concert.service';
import { Review, ReviewService } from '../services/review.service';
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

  myReviews: Review[] = [];
  reviewsError = '';
  reviewSheetOpen = false;
  reviewBooking: Booking | null = null;
  reviewForBooking: Review | null = null;

  private ticker?: ReturnType<typeof setInterval>;
  private bookingChangesSub?: Subscription;
  private concertChangesSub?: Subscription;
  private reviewChangesSub?: Subscription;

  constructor(
    private bookingService: BookingService,
    private concertService: ConcertService,
    private auth: AuthService,
    private reviewService: ReviewService,
    private router: Router,
    private route: ActivatedRoute,
    private zone: NgZone,
    private cdr: ChangeDetectorRef,
    private toastCtrl: ToastController
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

    // Keep the ★ rating on attended tickets in sync with edits/reports.
    this.reviewChangesSub?.unsubscribe();
    this.reviewChangesSub = this.reviewService.changes$.subscribe(() => {
      this.zone.run(() => void this.loadMyReviews());
    });
    void this.loadMyReviews();

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
    this.maybeOpenReviewFromQuery();
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

  /** Opens the review sheet when arriving from a "Leave a review" notification. */
  private maybeOpenReviewFromQuery(): void {
    const ticketId = this.route.snapshot.queryParamMap.get('review');
    if (!ticketId) {
      return;
    }
    const booking = this.bookingService.getAll().find((b) => b.id === ticketId);
    if (booking && this.canReview(booking)) {
      this.openReview(booking);
    }
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
    this.reviewChangesSub?.unsubscribe();
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
        this.loadMyReviews(),
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

  // ── Reviews ──────────────────────────────────────────────────────

  /** ATTENDED = the ticket was scanned at the gate and belongs to me. */
  canReview(booking: Booking): boolean {
    return (
      booking.status === 'checked-in' &&
      !!this.auth.getUserId() &&
      booking.customerId === this.auth.getUserId()
    );
  }

  reviewOf(booking: Booking): Review | undefined {
    return this.myReviews.find((review) => review.eventId === booking.concertId);
  }

  openReview(booking: Booking): void {
    if (!this.canReview(booking)) {
      return;
    }
    this.reviewBooking = booking;
    this.reviewForBooking = this.reviewOf(booking) ?? null;
    this.reviewSheetOpen = true;
    this.cdr.detectChanges();
  }

  closeReview(): void {
    this.reviewSheetOpen = false;
    this.reviewBooking = null;
    this.reviewForBooking = null;
    this.cdr.detectChanges();
  }

  onReviewSaved(review: Review): void {
    const wasEdit = !!this.reviewForBooking;
    this.upsertReview(review);
    this.closeReview();
    void this.toast(wasEdit ? 'Review updated.' : 'Thanks — your review is live.');
    void this.loadMyReviews();
  }

  onReviewDeleted(reviewId: string): void {
    this.myReviews = this.myReviews.filter((review) => review.id !== reviewId);
    this.closeReview();
    void this.toast('Review deleted.');
    void this.loadMyReviews();
  }

  private upsertReview(review: Review): void {
    const existing = this.myReviews.find((item) => item.id === review.id);
    if (!existing) {
      this.myReviews = [review, ...this.myReviews];
      return;
    }
    this.myReviews = this.myReviews.map((item) =>
      item.id === review.id
        ? {
            ...item,
            ...review,
            eventName: review.eventName || item.eventName,
            ticketTier: review.ticketTier || item.ticketTier,
            userName: review.userName || item.userName,
          }
        : item
    );
  }

  async loadMyReviews(): Promise<void> {
    try {
      const reviews = await this.reviewService.myReviews();
      this.zone.run(() => {
        this.myReviews = reviews;
        this.reviewsError = '';
        this.cdr.detectChanges();
      });
    } catch (error) {
      this.zone.run(() => {
        this.reviewsError =
          (error as Error)?.message ?? 'Could not load your reviews.';
        this.cdr.detectChanges();
      });
    }
  }

  private async toast(message: string): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration: 1800,
      color: 'dark',
    });
    await toast.present();
  }

  goExplore(): void {
    this.router.navigateByUrl('/tabs/concerts');
  }
}

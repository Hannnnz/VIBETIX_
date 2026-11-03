import { ChangeDetectorRef, Component } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';

import { Booking, BookingService } from '../../services/booking.service';
import { Concert, ConcertService } from '../../services/concert.service';
import { AuthService } from '../../services/auth.service';
import { runRefresh } from '../../utils/refresher';

@Component({
  selector: 'app-admin-bookings',
  templateUrl: './admin-bookings.page.html',
  styleUrls: ['./admin-bookings.page.scss'],
  standalone: false,
})
export class AdminBookingsPage {
  search = '';
  private bookingSub?: Subscription;

  constructor(
    private bookingService: BookingService,
    private concertService: ConcertService,
    private auth: AuthService,
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef
  ) {}

  async ionViewWillEnter(): Promise<void> {
    // Arriving from a "New booking" notification: focus that booking.
    const q = this.route.snapshot.queryParamMap.get('q');
    if (q) {
      this.search = q;
    }
    this.bookingSub?.unsubscribe();
    this.bookingSub = this.bookingService.changes$.subscribe(() => {
      this.cdr.detectChanges();
    });
    await this.auth.ensureSession().catch(() => undefined);
    await this.bookingService.hydrate().catch(() => undefined);
    this.cdr.detectChanges();
  }

  ionViewWillLeave(): void {
    this.bookingSub?.unsubscribe();
  }

  /** Pull-down-to-refresh refetches every customer's bookings. */
  async doRefresh(event: Event): Promise<void> {
    await runRefresh(event, async () => {
      await this.bookingService.hydrate();
      this.cdr.detectChanges();
    });
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

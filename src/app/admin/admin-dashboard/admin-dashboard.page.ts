import { ChangeDetectorRef, Component, NgZone } from '@angular/core';

import { Booking, BookingService } from '../../services/booking.service';
import { Concert, ConcertService } from '../../services/concert.service';
import { AuthService, Session } from '../../services/auth.service';
import { runRefresh } from '../../utils/refresher';

@Component({
  selector: 'app-admin-dashboard',
  templateUrl: './admin-dashboard.page.html',
  styleUrls: ['./admin-dashboard.page.scss'],
  standalone: false,
})
export class AdminDashboardPage {
  session: Session | null = null;
  readonly tierOrder = ['SVIP', 'VIP', 'Lower Box', 'Upper Box', 'Gen Ad'];

  private bookingSub?: any;
  private concertSub?: any;

  constructor(
    private concertService: ConcertService,
    private bookingService: BookingService,
    private auth: AuthService,
    private zone: NgZone,
    private cdr: ChangeDetectorRef
  ) {}

  async ionViewWillEnter(): Promise<void> {
    await this.auth.ensureSession().catch(() => undefined);
    this.session = this.auth.getSession();
    this.bookingSub?.unsubscribe?.();
    this.concertSub?.unsubscribe?.();
    this.bookingSub = this.bookingService.changes$.subscribe(() => {
      this.zone.run(() => {
        this.session = this.auth.getSession();
        this.cdr.detectChanges();
      });
    });
    this.concertSub = this.concertService.changes$.subscribe(() => {
      this.zone.run(() => {
        this.session = this.auth.getSession();
        this.cdr.detectChanges();
      });
    });
    await Promise.all([
      this.bookingService.hydrate(),
      this.concertService.hydrate(),
    ]).catch(() => undefined);
    this.cdr.detectChanges();
  }

  /** Pull-down-to-refresh refetches events + bookings. */
  async doRefresh(event: Event): Promise<void> {
    await runRefresh(event, async () => {
      await Promise.all([
        this.bookingService.hydrate(),
        this.concertService.hydrate(),
      ]);
      this.session = this.auth.getSession();
      this.cdr.detectChanges();
    });
  }

  stats() {
    return this.bookingService.stats();
  }

  concertCount(): number {
    return this.concertService.getAll().length;
  }

  nextShow(): Concert | undefined {
    const today = new Date().toISOString().slice(0, 10);
    return this.concertService
      .getAll()
      .sort((a, b) => a.date.localeCompare(b.date))
      .find((c) => c.date >= today);
  }

  tierBars() {
    const data = this.bookingService.seatsPerTier(this.tierOrder);
    const max = Math.max(1, ...data.map((d) => d.count));
    return data.map((d) => ({ ...d, pct: Math.round((d.count / max) * 100) }));
  }

  recent(): Booking[] {
    return this.bookingService.getAll().slice(0, 5);
  }

  ionViewWillLeave(): void {
    this.bookingSub?.unsubscribe?.();
    this.concertSub?.unsubscribe?.();
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

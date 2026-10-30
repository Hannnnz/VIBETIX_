import { Component } from '@angular/core';

import { Booking, BookingService } from '../../services/booking.service';
import { Concert, ConcertService } from '../../services/concert.service';
import { AuthService, Session } from '../../services/auth.service';

@Component({
  selector: 'app-admin-dashboard',
  templateUrl: './admin-dashboard.page.html',
  styleUrls: ['./admin-dashboard.page.scss'],
  standalone: false,
})
export class AdminDashboardPage {
  session: Session | null = null;
  readonly tierOrder = ['SVIP', 'VIP', 'Lower Box', 'Upper Box', 'Gen Ad'];

  constructor(
    private concertService: ConcertService,
    private bookingService: BookingService,
    private auth: AuthService
  ) {}

  ionViewWillEnter(): void {
    this.session = this.auth.getSession();
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

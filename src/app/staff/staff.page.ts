import { Component, NgZone, OnInit } from '@angular/core';
import { ToastController } from '@ionic/angular/lazy';
import { Booking, BookingService } from '../services/booking.service';
import { Concert, ConcertService } from '../services/concert.service';
import { AuthService, Session } from '../services/auth.service';
import { runRefresh } from '../utils/refresher';

@Component({
  selector: 'app-staff',
  templateUrl: './staff.page.html',
  styleUrls: ['./staff.page.scss'],
  standalone: false,
})
export class StaffPage implements OnInit {
  session: Session | null = null;
  bookings: Booking[] = [];
  search = '';
  private bookingSub?: any;

  constructor(
    private bookingService: BookingService,
    private concertService: ConcertService,
    private auth: AuthService,
    private toastCtrl: ToastController,
    private zone: NgZone
  ) {}

  ngOnInit(): void {
    void this.ionViewWillEnter();
  }

  async ionViewWillEnter(): Promise<void> {
    await this.auth.ensureSession().catch(() => undefined);
    this.zone.run(() => {
      this.session = this.auth.getSession();
    });
    this.bookingSub?.unsubscribe?.();
    this.bookingSub = this.bookingService.changes$.subscribe(() => {
      this.zone.run(() => {
        this.bookings = this.bookingService.getAll();
      });
    });
    // LIVE bookings + concerts straight from Supabase (staff sees the whole door list)
    try {
      await Promise.all([
        this.bookingService.hydrate(),
        this.concertService.hydrate(),
      ]);
    } catch {
      /* keep current cache */
    }
    this.zone.run(() => {
      this.bookings = this.bookingService.getAll();
    });
  }

  ionViewWillLeave(): void {
    this.bookingSub?.unsubscribe?.();
  }

  /** Pull-down-to-refresh refetches the whole door list. */
  async doRefresh(event: Event): Promise<void> {
    await runRefresh(event, async () => {
      await Promise.all([
        this.bookingService.hydrate(),
        this.concertService.hydrate(),
      ]);
      this.zone.run(() => {
        this.session = this.auth.getSession();
        this.bookings = this.bookingService.getAll();
      });
    });
  }

  stats() {
    return this.bookingService.stats();
  }

  recent(): Booking[] {
    return this.bookings.filter((b) => b.status === 'checked-in').slice(0, 5);
  }

  filtered(): Booking[] {
    const term = this.search.trim().toLowerCase();
    if (!term) {
      return this.bookings;
    }
    return this.bookings.filter((b) =>
      [b.ticketCode, b.customerName, b.customerEmail, this.concertOf(b)?.name, this.concertOf(b)?.venue, b.tier]
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

  async checkIn(booking: Booking): Promise<void> {
    if (booking.status === 'checked-in') {
      return;
    }
    // REAL gate check — the check_in_ticket Postgres function (no double entry)
    const outcome = await this.bookingService.gateCheckIn(booking.ticketCode);
    if (outcome.ok) {
      this.bookings = this.bookingService.getAll();
    }
    const toast = await this.toastCtrl.create({
      message: outcome.ok
        ? outcome.message
        : outcome.reason === 'already-used'
          ? `${booking.ticketCode} was already checked in.`
          : outcome.reason === 'invalid'
            ? 'Ticket not found on the server.'
            : outcome.reason,
      duration: 2000,
      position: 'top',
      color: 'dark',
      icon: 'checkmark-circle-outline',
    });
    await toast.present();
  }
}

import { ChangeDetectorRef, Component, NgZone, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { Booking, BookingService } from '../services/booking.service';
import { Concert, ConcertService } from '../services/concert.service';
import { AuthService } from '../services/auth.service';
import { eventDateTime, countdownString } from '../utils/countdown';
import QRCode from 'qrcode';

@Component({
  selector: 'app-ticket-detail',
  templateUrl: './ticket-detail.page.html',
  styleUrls: ['./ticket-detail.page.scss'],
  standalone: false,
})
export class TicketDetailPage implements OnInit {
  code = '';
  qrDataUrl = '';
  booking: Booking | undefined;
  concert: Concert | undefined;
  now = Date.now();
  private ticker?: ReturnType<typeof setInterval>;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private bookingService: BookingService,
    private concertService: ConcertService,
    private auth: AuthService,
    private zone: NgZone,
    private cdr: ChangeDetectorRef
  ) {}

  async ionViewWillEnter(): Promise<void> {
    await this.load();
  }

  async ngOnInit(): Promise<void> {
    await this.ionViewWillEnter();
  }

  private async load(): Promise<void> {
    await this.auth.ensureSession().catch(() => undefined);
    const stateBooking = (history.state as { booking?: Booking } | null)?.booking;
    const selected = this.bookingService.selectedBooking;
    let storedCode = '';
    try {
      storedCode = localStorage.getItem('vibetix:selectedTicket') || '';
    } catch {
      storedCode = '';
    }
    this.zone.run(() => {
      if (selected) {
        this.booking = selected;
        if (!this.code) {
          this.code = (selected.ticketCode || '').trim().toUpperCase();
        }
      } else if (stateBooking) {
        this.booking = stateBooking;
        if (!this.code) {
          this.code = (stateBooking.ticketCode || '').trim().toUpperCase();
        }
      } else if (storedCode) {
        this.code = storedCode.trim().toUpperCase();
      }
      this.cdr.detectChanges();
    });
    this.code = (
      this.code ||
      this.route.snapshot.paramMap.get('code') ||
      this.route.snapshot.queryParamMap.get('code') ||
      ''
    )
      .trim()
      .toUpperCase();
    void this.generateQr();
    try {
      await Promise.all([
        this.bookingService.hydrate(),
        this.concertService.hydrate(),
      ]);
    } catch {
      /* keep cache */
    }
    if (!this.booking) {
      this.booking = this.findBooking(this.code);
    }
    if (!this.booking) {
      // Retry once in case the cache was still loading.
      await new Promise((r) => setTimeout(r, 400));
      try {
        await this.bookingService.hydrate();
      } catch {
        /* keep cache */
      }
      this.booking = this.findBooking(this.code);
    }
    if (!this.booking && this.bookingService.getAll().length > 0) {
      this.booking = this.bookingService.selectedBooking ?? this.bookingService.getAll()[0];
      if (this.booking) {
        this.code = (this.booking.ticketCode || '').trim().toUpperCase();
        void this.generateQr();
      }
    }
    if (this.booking) {
      this.concert = this.concertService.getById(this.booking.concertId);
      if (!this.concert) {
        await this.concertService.hydrate().catch(() => undefined);
        this.concert = this.concertService.getById(this.booking.concertId);
      }
    }
    this.zone.run(() => {
      this.now = Date.now();
      this.cdr.detectChanges();
    });
    this.zone.runOutsideAngular(() => {
      this.ticker = setInterval(() => {
        this.zone.run(() => {
          this.now = Date.now();
          this.cdr.detectChanges();
        });
      }, 1000);
    });
  }

  ionViewWillLeave(): void {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = undefined;
    }
  }

  ngOnDestroy(): void {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = undefined;
    }
  }

  countdown(): string {
    if (!this.concert) {
      return '00:00:00:00';
    }
    return countdownString(eventDateTime(this.concert), this.now);
  }

  private async generateQr(): Promise<void> {
    if (!this.code) {
      return;
    }
    try {
      this.qrDataUrl = await QRCode.toDataURL(this.code, {
        width: 260,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' },
      });
      this.zone.run(() => (this.qrDataUrl = this.qrDataUrl));
    } catch {
      // fall back to remote generator
      this.qrDataUrl = '';
    }
  }

  private findBooking(code: string): Booking | undefined {
    const norm = (v: string) => (v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const target = norm(code);
    const all = this.bookingService.getAll();
    let found = all.find((b) => norm(b.ticketCode) === target);
    if (!found) {
      found = all.find((b) => norm(b.ticketCode).includes(target) || target.includes(norm(b.ticketCode)));
    }
    if (!found && all.length === 1) {
      found = all[0];
    }
    return found;
  }

  qrImage(): string {
    if (this.qrDataUrl) {
      return this.qrDataUrl;
    }
    return (
      'https://api.qrserver.com/v1/create-qr-code/?size=260x260&bgcolor=FFFFFF&data=' +
      encodeURIComponent(this.code)
    );
  }

  selectAvailable(b: Booking): void {
    this.bookingService.selectedBooking = b;
    this.booking = b;
    this.code = (b.ticketCode || '').trim().toUpperCase();
    void this.generateQr();
  }

  goBack(): void {
    this.router.navigateByUrl('/tabs/my-tickets');
  }
}
import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { ToastController } from '@ionic/angular/lazy';

import { Booking, BookingService } from '../services/booking.service';
import { Concert, ConcertService } from '../services/concert.service';
import { AuthService, Session } from '../services/auth.service';

@Component({
  selector: 'app-staff',
  templateUrl: './staff.page.html',
  styleUrls: ['./staff.page.scss'],
  standalone: false,
})
export class StaffPage {
  session: Session | null = null;
  bookings: Booking[] = [];
  search = '';

  constructor(
    private bookingService: BookingService,
    private concertService: ConcertService,
    private auth: AuthService,
    private router: Router,
    private toastCtrl: ToastController
  ) {}

  ionViewWillEnter(): void {
    this.session = this.auth.getSession();
    this.bookings = this.bookingService.getAll();
  }

  stats() {
    return this.bookingService.stats();
  }

  filtered(): Booking[] {
    const term = this.search.trim().toLowerCase();
    if (!term) {
      return this.bookings;
    }
    return this.bookings.filter((b) =>
      [b.ticketCode, b.customerName, b.customerEmail, this.concertOf(b)?.name, this.concertOf(b)?.venue]
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
    this.bookingService.checkIn(booking.id);
    this.bookings = this.bookingService.getAll();
    const toast = await this.toastCtrl.create({
      message: `${booking.ticketCode} checked in · ${booking.quantity} ticket(s)`,
      duration: 2000,
      position: 'top',
      color: 'success',
      icon: 'checkmark-circle-outline',
    });
    await toast.present();
  }

  async logout(): Promise<void> {
    this.auth.logout();
    this.router.navigate(['/login'], { replaceUrl: true });
  }
}

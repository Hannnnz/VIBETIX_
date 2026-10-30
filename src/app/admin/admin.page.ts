import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular/lazy';

import { Booking, BookingService } from '../services/booking.service';
import { Concert, ConcertService } from '../services/concert.service';
import { AuthService, Session } from '../services/auth.service';

@Component({
  selector: 'app-admin',
  templateUrl: './admin.page.html',
  styleUrls: ['./admin.page.scss'],
  standalone: false,
})
export class AdminPage {
  session: Session | null = null;
  tab: 'concerts' | 'bookings' = 'concerts';

  constructor(
    private concertService: ConcertService,
    private bookingService: BookingService,
    private auth: AuthService,
    private router: Router,
    private toastCtrl: ToastController,
    private alertCtrl: AlertController
  ) {}

  ionViewWillEnter(): void {
    this.session = this.auth.getSession();
  }

  stats() {
    return this.bookingService.stats();
  }

  concerts(): Concert[] {
    return this.concertService.getAll();
  }

  bookings(): Booking[] {
    return this.bookingService.getAll();
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

  edit(concert: Concert): void {
    this.router.navigate(['/admin/concert-form'], { queryParams: { id: concert.id } });
  }

  add(): void {
    this.router.navigate(['/admin/concert-form']);
  }

  async remove(concert: Concert): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Delete concert',
      message: `Delete "${concert.name}"? Past bookings for it stay in records.`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: async () => {
            this.concertService.remove(concert.id);
            const toast = await this.toastCtrl.create({
              message: 'Concert deleted.',
              duration: 1600,
              color: 'medium',
            });
            await toast.present();
          },
        },
      ],
    });
    await alert.present();
  }

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/login'], { replaceUrl: true });
  }
}

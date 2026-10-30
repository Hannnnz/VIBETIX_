import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular/lazy';

import { Concert, ConcertService } from '../../services/concert.service';
import { completeRefresher } from '../../utils/refresher';

@Component({
  selector: 'app-admin-events',
  templateUrl: './admin-events.page.html',
  styleUrls: ['./admin-events.page.scss'],
  standalone: false,
})
export class AdminEventsPage {
  constructor(
    private concertService: ConcertService,
    private router: Router,
    private toastCtrl: ToastController,
    private alertCtrl: AlertController
  ) {}

  concerts(): Concert[] {
    return this.concertService.getAll();
  }

  dateLabel(date: string): string {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  ionViewWillEnter(): void {
    void this.concertService.hydrate();
  }

  /** Pull-down-to-refresh refetches the event catalog. */
  async doRefresh(event: Event): Promise<void> {
    await this.concertService.hydrate().catch(() => undefined);
    completeRefresher(event);
  }

  edit(concert: Concert): void {
    this.router.navigate(['/admin/event-form'], { queryParams: { id: concert.id } });
  }

  add(): void {
    this.router.navigate(['/admin/event-form']);
  }

  async remove(concert: Concert): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Delete event',
      message: `Delete "${concert.name}"? Existing bookings are kept.`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: async () => {
            await this.concertService.remove(concert.id);
            const toast = await this.toastCtrl.create({
              message: 'Event deleted.',
              duration: 1600,
              color: 'dark',
            });
            await toast.present();
          },
        },
      ],
    });
    await alert.present();
  }
}

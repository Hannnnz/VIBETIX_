import { ChangeDetectorRef, Component } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular/lazy';
import { Subscription } from 'rxjs';

import { Concert, ConcertService } from '../../services/concert.service';
import { EventRating, ReviewService } from '../../services/review.service';
import { runRefresh } from '../../utils/refresher';

@Component({
  selector: 'app-admin-events',
  templateUrl: './admin-events.page.html',
  styleUrls: ['./admin-events.page.scss'],
  standalone: false,
})
export class AdminEventsPage {
  private concertSub?: Subscription;
  private reviewSub?: Subscription;
  private ratings = new Map<string, EventRating>();

  constructor(
    private concertService: ConcertService,
    private reviewService: ReviewService,
    private router: Router,
    private toastCtrl: ToastController,
    private alertCtrl: AlertController,
    private cdr: ChangeDetectorRef
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
    this.concertSub?.unsubscribe();
    this.reviewSub?.unsubscribe();
    this.concertSub = this.concertService.changes$.subscribe(() => {
      this.cdr.detectChanges();
    });
    this.reviewSub = this.reviewService.changes$.subscribe(() => {
      void this.loadRatings();
    });
    void this.concertService.hydrate().then(() => this.cdr.detectChanges());
    void this.loadRatings();
  }

  ionViewWillLeave(): void {
    this.concertSub?.unsubscribe();
    this.reviewSub?.unsubscribe();
  }

  /** Pull-down-to-refresh refetches the event catalog. */
  async doRefresh(event: Event): Promise<void> {
    await runRefresh(event, async () => {
      await Promise.all([
        this.concertService.hydrate(),
        this.loadRatings(),
      ]);
      this.cdr.detectChanges();
    });
  }

  private async loadRatings(): Promise<void> {
    try {
      this.ratings = await this.reviewService.eventRatings();
      this.cdr.detectChanges();
    } catch {
      /* ratings unavailable — keep the last known values */
    }
  }

  ratingOf(concert: Concert): EventRating | undefined {
    return this.ratings.get(concert.id);
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

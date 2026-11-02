import { ChangeDetectorRef, Component, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular/lazy';
import { Subscription } from 'rxjs';

import { AuthService } from '../services/auth.service';
import { Review, ReviewService } from '../services/review.service';
import { runRefresh } from '../utils/refresher';

@Component({
  selector: 'app-my-reviews',
  templateUrl: './my-reviews.page.html',
  styleUrls: ['./my-reviews.page.scss'],
  standalone: false,
})
export class MyReviewsPage {
  readonly stars = [1, 2, 3, 4, 5];

  reviews: Review[] = [];
  loading = false;
  error = '';
  editing: Review | null = null;

  private reviewSub?: Subscription;

  constructor(
    private reviewService: ReviewService,
    private auth: AuthService,
    private router: Router,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
    private zone: NgZone,
    private cdr: ChangeDetectorRef
  ) {}

  async ionViewWillEnter(): Promise<void> {
    await this.auth.ensureSession().catch(() => undefined);
    this.reviewSub?.unsubscribe();
    this.reviewSub = this.reviewService.changes$.subscribe(() => {
      this.zone.run(() => void this.load());
    });
    await this.load();
  }

  ionViewWillLeave(): void {
    this.reviewSub?.unsubscribe();
  }

  async doRefresh(event: Event): Promise<void> {
    await runRefresh(event, () => this.load());
  }

  async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    this.cdr.detectChanges();
    try {
      const reviews = await this.reviewService.myReviews();
      this.zone.run(() => {
        this.reviews = reviews;
        this.cdr.detectChanges();
      });
    } catch (error) {
      this.zone.run(() => {
        this.error =
          (error as Error)?.message ?? 'Could not load your reviews right now.';
        this.cdr.detectChanges();
      });
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  edit(review: Review): void {
    this.editing = review;
    this.cdr.detectChanges();
  }

  closeEditor(): void {
    this.editing = null;
    this.cdr.detectChanges();
  }

  onSaved(review: Review): void {
    this.reviews = this.reviews.map((item) =>
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
    this.editing = null;
    void this.toast('Review updated.');
    void this.load();
  }

  onDeleted(reviewId: string): void {
    this.reviews = this.reviews.filter((review) => review.id !== reviewId);
    this.editing = null;
    void this.toast('Review deleted.');
    void this.load();
  }

  async confirmDelete(review: Review): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Delete review',
      message: 'Delete your review? This cannot be undone.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: async () => {
            try {
              await this.reviewService.remove(review.id);
              this.zone.run(() => {
                this.reviews = this.reviews.filter(
                  (item) => item.id !== review.id
                );
                this.cdr.detectChanges();
              });
              void this.toast('Review deleted.');
              void this.load();
            } catch (error) {
              void this.toast(
                (error as Error)?.message ?? 'Could not delete your review.'
              );
            }
          },
        },
      ],
    });
    await alert.present();
  }

  openEvent(review: Review): void {
    if (review.eventId) {
      void this.router.navigate(['/concert', review.eventId]);
    }
  }

  goTickets(): void {
    void this.router.navigateByUrl('/tabs/my-tickets');
  }

  private async toast(message: string): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration: 1800,
      color: 'dark',
    });
    await toast.present();
  }
}

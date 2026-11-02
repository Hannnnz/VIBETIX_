import { ChangeDetectorRef, Component, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular/lazy';
import { Subscription } from 'rxjs';

import { AuthService } from '../../services/auth.service';
import {
  AdminReviewFilters,
  Review,
  ReviewReport,
  ReviewService,
  ReviewStats,
} from '../../services/review.service';
import { runRefresh } from '../../utils/refresher';

type FilterKey = 'all' | 'reported' | 'hidden' | '5' | '4' | '3' | '2' | '1';

@Component({
  selector: 'app-admin-reviews',
  templateUrl: './admin-reviews.page.html',
  styleUrls: ['./admin-reviews.page.scss'],
  standalone: false,
})
export class AdminReviewsPage {
  readonly stars = [1, 2, 3, 4, 5];
  readonly filters: { key: FilterKey; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'reported', label: 'Reported' },
    { key: 'hidden', label: 'Hidden' },
    { key: '5', label: '5★' },
    { key: '4', label: '4★' },
    { key: '3', label: '3★' },
    { key: '2', label: '2★' },
    { key: '1', label: '1★' },
  ];

  filter: FilterKey = 'all';
  reviews: Review[] = [];
  stats: ReviewStats | null = null;
  loading = false;
  error = '';
  busyId = '';

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

  setFilter(key: FilterKey): void {
    if (this.filter === key) {
      return;
    }
    this.filter = key;
    void this.load();
  }

  private filtersFor(key: FilterKey): AdminReviewFilters {
    if (key === 'reported') {
      return { reported: true };
    }
    if (key === 'hidden') {
      return { status: 'hidden' };
    }
    if (key !== 'all') {
      return { rating: Number(key) };
    }
    return {};
  }

  async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    this.cdr.detectChanges();
    try {
      const reviews = await this.reviewService.adminList(this.filtersFor(this.filter));
      const stats = await this.reviewService
        .adminStats()
        .catch(() => this.stats);
      this.zone.run(() => {
        this.reviews = reviews;
        this.stats = stats;
        this.cdr.detectChanges();
      });
    } catch (error) {
      this.zone.run(() => {
        this.error =
          (error as Error)?.message ?? 'Could not load reviews right now.';
        this.cdr.detectChanges();
      });
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  emptyMessage(): string {
    switch (this.filter) {
      case 'reported':
        return 'No open reports — the queue is clear.';
      case 'hidden':
        return 'No hidden reviews.';
      case 'all':
        return 'No reviews yet. Attended customers will show up here.';
      default:
        return `No ${this.filter}-star reviews.`;
    }
  }

  async toggleStatus(review: Review): Promise<void> {
    if (this.busyId) {
      return;
    }
    const next = review.status === 'visible' ? 'hidden' : 'visible';
    this.busyId = review.id;
    this.cdr.detectChanges();
    try {
      await this.reviewService.adminSetStatus(review.id, next);
      this.zone.run(() => {
        review.status = next;
        this.cdr.detectChanges();
      });
      void this.toast(next === 'hidden' ? 'Review hidden.' : 'Review restored.');
      await this.load();
    } catch (error) {
      void this.toast(
        (error as Error)?.message ?? 'Could not update that review.'
      );
    } finally {
      this.busyId = '';
      this.cdr.detectChanges();
    }
  }

  async confirmDelete(review: Review): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Delete review',
      message: 'Permanently delete this review and its reports?',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: async () => {
            this.busyId = review.id;
            try {
              await this.reviewService.adminDelete(review.id);
              this.zone.run(() => {
                this.reviews = this.reviews.filter(
                  (item) => item.id !== review.id
                );
                this.cdr.detectChanges();
              });
              void this.toast('Review deleted.');
              await this.load();
            } catch (error) {
              void this.toast(
                (error as Error)?.message ?? 'Could not delete that review.'
              );
            } finally {
              this.busyId = '';
              this.cdr.detectChanges();
            }
          },
        },
      ],
    });
    await alert.present();
  }

  async dismissReport(report: ReviewReport): Promise<void> {
    try {
      await this.reviewService.adminDismissReport(report.id);
      void this.toast('Report dismissed.');
      await this.load();
    } catch (error) {
      void this.toast(
        (error as Error)?.message ?? 'Could not dismiss that report.'
      );
    }
  }

  openEvent(review: Review): void {
    if (review.eventId) {
      void this.router.navigate(['/concert', review.eventId]);
    }
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

import { ChangeDetectorRef, Component, NgZone } from '@angular/core';
import { Subscription } from 'rxjs';

import { AuthService } from '../services/auth.service';
import { ReviewService } from '../services/review.service';

@Component({
  selector: 'app-admin-tabs',
  templateUrl: './admin-tabs.page.html',
  styleUrls: ['./admin-tabs.page.scss'],
  standalone: false,
})
export class AdminTabsPage {
  reportedReviews = 0;

  private reviewSub?: Subscription;

  constructor(
    private reviewService: ReviewService,
    private auth: AuthService,
    private zone: NgZone,
    private cdr: ChangeDetectorRef
  ) {}

  async ionViewWillEnter(): Promise<void> {
    await this.auth.ensureSession().catch(() => undefined);
    this.reviewSub?.unsubscribe();
    this.reviewSub = this.reviewService.changes$.subscribe(() => {
      this.zone.run(() => void this.loadBadge());
    });
    await this.loadBadge();
  }

  ionViewWillLeave(): void {
    this.reviewSub?.unsubscribe();
  }

  private async loadBadge(): Promise<void> {
    try {
      const stats = await this.reviewService.adminStats();
      this.zone.run(() => {
        this.reportedReviews = stats.reportedReviews;
        this.cdr.detectChanges();
      });
    } catch {
      /* queue unavailable — keep the last known badge */
    }
  }
}

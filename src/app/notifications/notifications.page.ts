import { CommonModule } from '@angular/common';
import { Component, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController } from '@ionic/angular/lazy';
import { Subscription } from 'rxjs';

import { AuthService } from '../services/auth.service';
import {
  AppNotification,
  NotificationService,
  NotificationType,
} from '../services/notification.service';
import { runRefresh } from '../utils/refresher';

@Component({
  selector: 'app-notifications',
  templateUrl: './notifications.page.html',
  styleUrls: ['./notifications.page.scss'],
  standalone: false,
})
export class NotificationsPage implements OnDestroy {
  items: AppNotification[] = [];
  loading = true;
  error = '';
  unread = 0;

  private subs = new Subscription();
  private subscribed = false;
  private readonly icons: Record<NotificationType, string> = {
    booking_confirmed: 'ticket-outline',
    checked_in: 'checkmark-circle-outline',
    event_reminder: 'alarm-outline',
    new_booking: 'receipt-outline',
  };

  constructor(
    public auth: AuthService,
    private notifications: NotificationService,
    private alertCtrl: AlertController,
    private router: Router
  ) {}

  get backHref(): string {
    return this.auth.roleHome;
  }

  ionViewWillEnter(): void {
    if (!this.subscribed) {
      this.subscribed = true;
      this.subs.add(
        this.notifications.items$.subscribe((items) => {
          this.items = items;
        })
      );
      this.subs.add(
        this.notifications.unread$.subscribe((count) => {
          this.unread = count;
        })
      );
      this.subs.add(
        this.notifications.loading$.subscribe((loading) => {
          this.loading = loading;
        })
      );
      this.subs.add(
        this.notifications.error$.subscribe((error) => {
          this.error = error;
        })
      );
    }
    void this.notifications.refresh();
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  async doRefresh(event: Event): Promise<void> {
    await runRefresh(event, () => this.notifications.refresh());
  }

  doRefreshRefreshOnly(): void {
    void this.notifications.refresh();
  }

  trackById(_index: number, item: AppNotification): string {
    return item.id;
  }

  iconFor(type: NotificationType): string {
    return this.icons[type] ?? 'notifications-outline';
  }

  relative(iso: string): string {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) {
      return '';
    }
    const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
    if (seconds < 60) {
      return 'Just now';
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      return `${minutes}m ago`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return `${hours}h ago`;
    }
    const days = Math.floor(hours / 24);
    if (days < 7) {
      return `${days}d ago`;
    }
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  open(notification: AppNotification): void {
    void this.notifications.open(notification);
  }

  leaveReview(notification: AppNotification, event: Event): void {
    event.stopPropagation();
    void this.notifications.openReview(notification);
  }

  async remove(notification: AppNotification, event?: Event): Promise<void> {
    event?.stopPropagation();
    await this.notifications.remove(notification.id);
  }

  async markAll(): Promise<void> {
    await this.notifications.markAllRead();
  }

  async clearAll(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Clear notifications?',
      message: 'This removes every notification from your inbox.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Clear',
          role: 'destructive',
          handler: () => void this.notifications.clearAll(),
        },
      ],
    });
    await alert.present();
  }

  openTickets(): void {
    void this.router.navigateByUrl('/tabs/my-tickets');
  }
}

import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { IonicModule } from '@ionic/angular/lazy';
import { Subscription } from 'rxjs';

import { NotificationService } from '../../services/notification.service';

/**
 * Bell button with an unread badge. Dropped into the customer and admin
 * headers; opens the notifications page.
 */
@Component({
  selector: 'app-notification-bell',
  standalone: true,
  imports: [CommonModule, IonicModule],
  template: `
    <ion-button
      class="bell"
      fill="clear"
      (click)="open()"
      [attr.aria-label]="
        unread > 0
          ? 'Notifications, ' + unread + ' unread'
          : 'Notifications'
      "
    >
      <ion-icon slot="icon-only" name="notifications-outline"></ion-icon>
      <ion-badge class="bell-badge" *ngIf="unread > 0">
        {{ unread > 9 ? '9+' : unread }}
      </ion-badge>
    </ion-button>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      .bell {
        position: relative;
        width: 48px;
        height: 48px;
        min-width: 48px;
        min-height: 48px;
        margin: 0;
        --padding-start: 10px;
        --padding-end: 10px;
        --color: #f5f5f5;
      }

      .bell ion-icon {
        font-size: 24px;
      }

      .bell-badge {
        position: absolute;
        top: 4px;
        right: 2px;
        min-width: 18px;
        height: 18px;
        padding: 0 4px;
        border-radius: 9px;
        background: #e50914;
        color: #fff;
        font-size: 10px;
        font-weight: 800;
        line-height: 18px;
        text-align: center;
        box-shadow: 0 0 0 2px #0a0a0a;
      }
    `,
  ],
})
export class NotificationBellComponent implements OnInit, OnDestroy {
  unread = 0;
  private sub?: Subscription;

  constructor(
    private notifications: NotificationService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.sub = this.notifications.unread$.subscribe((count) => {
      this.unread = count;
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  open(): void {
    void this.router.navigateByUrl('/notifications');
  }
}

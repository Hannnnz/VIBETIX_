import { Injectable, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { ToastController } from '@ionic/angular/lazy';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { BehaviorSubject, Subscription } from 'rxjs';

import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';

export type NotificationType =
  | 'booking_confirmed'
  | 'checked_in'
  | 'event_reminder'
  | 'new_booking';

export interface NotificationData {
  screen?: 'ticket' | 'booking';
  type?: NotificationType;
  action?: string;
  event_id?: string;
  /** bookings.id — also the check-in / reminder key. */
  ticket_id?: string;
  booking_id?: string;
  ticket_code?: string;
  [key: string]: unknown;
}

export interface AppNotification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: NotificationData;
  read_at: string | null;
  created_at: string;
}

interface NotificationRow {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: NotificationData | null;
  read_at: string | null;
  created_at: string;
}

/**
 * Server-backed notification inbox.
 *
 * Rows are created ONLY by Postgres triggers / the reminder cron job.
 * This service reads them with RLS (own rows only), marks them read,
 * deletes them, and keeps the bell / page live through Supabase Realtime.
 *
 * On the web nothing here requires native APIs, so the browser version
 * keeps working. Native push is handled separately by PushService.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly items = new BehaviorSubject<AppNotification[]>([]);
  private readonly unreadSubject = new BehaviorSubject<number>(0);
  private readonly loadingSubject = new BehaviorSubject<boolean>(false);
  private readonly errorSubject = new BehaviorSubject<string>('');

  readonly items$ = this.items.asObservable();
  readonly unread$ = this.unreadSubject.asObservable();
  readonly loading$ = this.loadingSubject.asObservable();
  readonly error$ = this.errorSubject.asObservable();

  private userId = '';
  private channel: RealtimeChannel | null = null;
  private authSub?: Subscription;
  private reloadTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private sb: SupabaseService,
    private auth: AuthService,
    private router: Router,
    private toastCtrl: ToastController,
    private zone: NgZone
  ) {
    this.authSub = this.auth.changes$.subscribe((session) => {
      const uid = session ? this.auth.getUserId() : null;
      if (uid) {
        this.start(uid);
      } else {
        this.stop();
      }
    });

    // Session restored before this service was constructed.
    const uid = this.auth.getUserId();
    if (uid) {
      this.start(uid);
    }
  }

  private get client() {
    return this.sb.client;
  }

  // ──────────────────────────────────────────────────────────────────
  // Lifecycle
  // ──────────────────────────────────────────────────────────────────

  private start(uid: string): void {
    if (this.userId === uid && this.channel) {
      return;
    }
    this.stop();
    this.userId = uid;
    void this.refresh();
    this.subscribeRealtime(uid);
  }

  private stop(): void {
    this.userId = '';
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = undefined;
    }
    if (this.channel) {
      void this.channel.unsubscribe();
      this.channel = null;
    }
    this.zone.run(() => {
      this.items.next([]);
      this.unreadSubject.next(0);
      this.loadingSubject.next(false);
      this.errorSubject.next('');
    });
  }

  private subscribeRealtime(uid: string): void {
    try {
      this.channel = this.client
        .channel('vibetix-notifications-' + uid)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${uid}`,
          },
          (payload) => {
            const event = payload as unknown as {
              eventType?: string;
              new?: NotificationRow;
              old?: { id?: string };
            };
            if (event.eventType === 'INSERT' && event.new) {
              const row = this.map(event.new);
              const existing = this.items.value.find((n) => n.id === row.id);
              if (existing) {
                return;
              }
              this.zone.run(() => {
                this.items.next([row, ...this.items.value].slice(0, 100));
                this.recount();
              });
              void this.showToast(row);
              return;
            }
            if (event.eventType === 'UPDATE' && event.new) {
              const row = this.map(event.new);
              this.zone.run(() => {
                this.items.next(
                  this.items.value.map((n) => (n.id === row.id ? row : n))
                );
                this.recount();
              });
              return;
            }
            if (event.eventType === 'DELETE' && event.old?.id) {
              const removedId = event.old.id;
              this.zone.run(() => {
                this.items.next(
                  this.items.value.filter((n) => n.id !== removedId)
                );
                this.recount();
              });
              return;
            }
            // Fallback: coalesce unknown events into one refresh.
            if (this.reloadTimer) {
              clearTimeout(this.reloadTimer);
            }
            this.reloadTimer = setTimeout(() => void this.refresh(), 250);
          }
        )
        .subscribe();
    } catch {
      /* Realtime is optional — the inbox still works via refresh(). */
    }
  }

  private map(row: NotificationRow): AppNotification {
    return {
      id: row.id,
      user_id: row.user_id,
      type: row.type,
      title: row.title,
      body: row.body,
      data: row.data ?? {},
      read_at: row.read_at,
      created_at: row.created_at,
    };
  }

  private recount(): void {
    this.unreadSubject.next(this.items.value.filter((n) => !n.read_at).length);
  }

  // ──────────────────────────────────────────────────────────────────
  // Reads / mutations
  // ──────────────────────────────────────────────────────────────────

  /** Synchronous snapshot for pages that don't want an observable. */
  snapshot(): AppNotification[] {
    return this.items.value;
  }

  async refresh(): Promise<void> {
    if (!this.userId) {
      // Auth profile not ready yet — never leave the spinner stuck.
      this.zone.run(() => this.loadingSubject.next(false));
      return;
    }
    this.loadingSubject.next(true);
    this.errorSubject.next('');
    try {
      const query = this.client
        .from('notifications')
        .select('id, user_id, type, title, body, data, read_at, created_at')
        .eq('user_id', this.userId)
        .order('created_at', { ascending: false })
        .limit(100);
      const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Timed out loading notifications.')), 10000);
      });
      const { data, error } = await Promise.race([
        query as unknown as Promise<{ data: unknown; error: unknown }>,
        timeout,
      ]);
      if (error) {
        throw error;
      }
      const rows = (data ?? []) as NotificationRow[];
      this.zone.run(() => {
        this.items.next(rows.map((r) => this.map(r)));
        this.recount();
      });
    } catch (error) {
      this.zone.run(() => {
        this.errorSubject.next(
          (error as { message?: string })?.message ??
            'Could not load notifications.'
        );
      });
    } finally {
      this.zone.run(() => {
        this.loadingSubject.next(false);
      });
    }
  }

  async markRead(id: string): Promise<void> {
    const previous = this.items.value;
    if (!previous.some((n) => n.id === id && !n.read_at)) {
      return;
    }
    const readAt = new Date().toISOString();
    this.zone.run(() => {
      this.items.next(
        previous.map((n) => (n.id === id ? { ...n, read_at: readAt } : n))
      );
      this.recount();
    });
    const { error } = await this.client
      .from('notifications')
      .update({ read_at: readAt })
      .eq('id', id)
      .eq('user_id', this.userId)
      .is('read_at', null);
    if (error) {
      this.zone.run(() => {
        this.items.next(previous);
        this.recount();
        this.errorSubject.next('Could not mark that notification as read.');
      });
    }
  }

  async markAllRead(): Promise<void> {
    if (!this.userId) {
      return;
    }
    const readAt = new Date().toISOString();
    const previous = this.items.value;
    this.zone.run(() => {
      this.items.next(
        previous.map((n) => (n.read_at ? n : { ...n, read_at: readAt }))
      );
      this.recount();
    });
    const { error } = await this.client
      .from('notifications')
      .update({ read_at: readAt })
      .eq('user_id', this.userId)
      .is('read_at', null);
    if (error) {
      this.zone.run(() => {
        this.items.next(previous);
        this.recount();
        this.errorSubject.next('Could not mark all as read.');
      });
    }
  }

  async remove(id: string): Promise<void> {
    const previous = this.items.value;
    this.zone.run(() => {
      this.items.next(previous.filter((n) => n.id !== id));
      this.recount();
    });
    const { error } = await this.client
      .from('notifications')
      .delete()
      .eq('id', id)
      .eq('user_id', this.userId);
    if (error) {
      this.zone.run(() => {
        this.items.next(previous);
        this.recount();
        this.errorSubject.next('Could not delete that notification.');
      });
    }
  }

  async clearAll(): Promise<void> {
    if (!this.userId) {
      return;
    }
    const previous = this.items.value;
    this.zone.run(() => {
      this.items.next([]);
      this.recount();
    });
    const { error } = await this.client
      .from('notifications')
      .delete()
      .eq('user_id', this.userId);
    if (error) {
      this.zone.run(() => {
        this.items.next(previous);
        this.recount();
        this.errorSubject.next('Could not clear notifications.');
      });
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Navigation
  // ──────────────────────────────────────────────────────────────────

  /** Marks read, then opens the screen the notification points at. */
  async open(notification: AppNotification): Promise<void> {
    await this.markRead(notification.id);
    const data = notification.data;

    if (notification.type === 'new_booking') {
      await this.router.navigate(['/admin/bookings'], {
        queryParams: data.ticket_code ? { q: data.ticket_code } : {},
      });
      return;
    }

    const code = data.ticket_code;
    if (code) {
      await this.router.navigate(['/ticket', code]);
      return;
    }

    // Older rows may only carry the booking id — resolve the code.
    const bookingId = data.ticket_id ?? data.booking_id;
    if (bookingId) {
      try {
        const { data: row } = await this.client
          .from('bookings')
          .select('ticket_code')
          .eq('id', bookingId)
          .single();
        const resolved = (row as { ticket_code?: string } | null)?.ticket_code;
        if (resolved) {
          await this.router.navigate(['/ticket', resolved]);
          return;
        }
      } catch {
        /* fall through */
      }
    }
    await this.router.navigateByUrl('/tabs/my-tickets');
  }

  /** "Leave a review" action for checked-in notifications. */
  async openReview(notification: AppNotification): Promise<void> {
    await this.markRead(notification.id);
    const ticketId = notification.data.ticket_id ?? notification.data.booking_id;
    await this.router.navigate(['/tabs/my-tickets'], {
      queryParams: ticketId ? { review: ticketId } : {},
    });
  }

  private async showToast(notification: AppNotification): Promise<void> {
    if (
      typeof document !== 'undefined' &&
      document.visibilityState !== 'visible'
    ) {
      return;
    }
    try {
      const toast = await this.toastCtrl.create({
        header: notification.title,
        message: notification.body,
        duration: 4500,
        position: 'top',
        color: 'dark',
        cssClass: 'vibetix-notification-toast',
        buttons: [
          { text: 'View', handler: () => void this.open(notification) },
          { text: 'Dismiss', role: 'cancel' },
        ],
      });
      await toast.present();
    } catch {
      /* toast is best-effort */
    }
  }
}

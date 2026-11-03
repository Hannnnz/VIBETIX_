import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

import { SupabaseService } from './supabase.service';

export interface LocalReminderInput {
  bookingId: string;
  eventId: string;
  eventName: string;
  venue: string;
  ticketCode: string;
  /** Event start (device-local time). */
  startsAt: Date;
}

export interface ForegroundNotification {
  title: string;
  body: string;
  data: Record<string, string>;
  /** Stable ticket/notification key so duplicates collapse. */
  dedupeKey?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Android local notifications — the offline backup for the 24h reminder.
 *
 * The same stable integer id is derived from the ticket id, so:
 *   • re-scheduling a ticket replaces the previous reminder,
 *   • a server push for the same ticket can cancel / replace it,
 *   • the customer never gets the reminder twice.
 *
 * Everything here is a no-op in the browser.
 */
@Injectable({ providedIn: 'root' })
export class LocalReminderService {
  private readonly native = Capacitor.isNativePlatform();
  private channelReady = false;
  private readonly cancelled = new Set<string>();

  constructor(private sb: SupabaseService) {}

  /** Deterministic 31-bit id — stable across app restarts. */
  idFor(key: string): number {
    let hash = 5381;
    for (let i = 0; i < key.length; i++) {
      hash = ((hash * 33) ^ key.charCodeAt(i)) >>> 0;
    }
    return (hash % 2147483646) + 1;
  }

  async ensureChannel(): Promise<void> {
    if (!this.native || this.channelReady) {
      return;
    }
    try {
      await LocalNotifications.createChannel({
        id: 'default',
        name: 'VIBETIX',
        description: 'Bookings, check-ins and event reminders',
        importance: 5,
        visibility: 1,
        lights: true,
        lightColor: '#E50914',
        vibration: true,
        sound: 'default',
      });
      this.channelReady = true;
    } catch {
      /* channel is best-effort */
    }
  }

  private async ensurePermission(): Promise<boolean> {
    if (!this.native) {
      return false;
    }
    try {
      let status = await LocalNotifications.checkPermissions();
      if (status.display !== 'granted') {
        status = await LocalNotifications.requestPermissions();
      }
      return status.display === 'granted';
    } catch {
      return false;
    }
  }

  /**
   * Schedules "Tomorrow: <event>" 24h before the show.
   * Skips when the server already stored an event_reminder for this ticket
   * (so the server push and the local notification never both fire).
   */
  async scheduleForBooking(input: LocalReminderInput): Promise<void> {
    if (!this.native) {
      return;
    }
    const at = new Date(input.startsAt.getTime() - DAY_MS);
    if (!Number.isFinite(at.getTime()) || at.getTime() <= Date.now() + 60_000) {
      return;
    }

    // Already covered by the server-side reminder job?
    try {
      const { data } = await this.sb.client
        .from('notifications')
        .select('id')
        .eq('type', 'event_reminder')
        .eq('ticket_id', input.bookingId)
        .limit(1);
      if (data && data.length > 0) {
        return;
      }
    } catch {
      /* offline: still schedule the local backup */
    }

    if (!(await this.ensurePermission())) {
      return;
    }
    await this.ensureChannel();

    const time = at.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });

    try {
      await LocalNotifications.schedule({
        notifications: [
          {
            id: this.idFor(input.bookingId),
            title: `Tomorrow: ${input.eventName} at ${time}`,
            body: input.venue,
            channelId: 'default',
            schedule: { at, allowWhileIdle: true },
            extra: {
              screen: 'ticket',
              type: 'event_reminder',
              local: '1',
              event_id: input.eventId,
              ticket_id: input.bookingId,
              booking_id: input.bookingId,
              ticket_code: input.ticketCode,
            },
          },
        ],
      });
    } catch {
      /* local notification permission/limits — server push still covers it */
    }
  }

  /** Removes a pending reminder when a ticket is cancelled/refunded. */
  async cancelForBooking(bookingId: string): Promise<void> {
    if (!this.native || this.cancelled.has(bookingId)) {
      return;
    }
    this.cancelled.add(bookingId);
    await this.cancelById(this.idFor(bookingId));
  }

  async cancelById(id: number): Promise<void> {
    if (!this.native) {
      return;
    }
    try {
      await LocalNotifications.cancel({ notifications: [{ id }] });
    } catch {
      /* already gone */
    }
  }

  /** Shows a notification immediately while the app is open. */
  async showNow(notification: ForegroundNotification): Promise<void> {
    if (!this.native) {
      return;
    }
    if (!(await this.ensurePermission())) {
      return;
    }
    await this.ensureChannel();
    const key =
      notification.dedupeKey ??
      `${notification.data['ticket_id'] ?? ''}:${notification.title}`;
    const id = this.idFor(key || notification.title);
    try {
      await LocalNotifications.schedule({
        notifications: [
          {
            id,
            title: notification.title,
            body: notification.body,
            channelId: 'default',
            extra: notification.data,
          },
        ],
      });
    } catch {
      /* visible push may already be shown by the OS */
    }
  }
}

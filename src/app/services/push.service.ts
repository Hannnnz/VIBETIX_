import { Injectable, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import {
  ActionPerformed,
  PushNotificationSchema,
  PushNotifications,
  Token,
} from '@capacitor/push-notifications';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Subscription } from 'rxjs';

import { AuthService } from './auth.service';
import { LocalReminderService } from './local-reminder.service';
import { SupabaseService } from './supabase.service';

const TOKEN_KEY = 'vibetix:push-token';

/**
 * Android push notifications (FCM via @capacitor/push-notifications).
 *
 * – registers after login and stores the token in public.device_tokens
 * – requests POST_NOTIFICATIONS on Android 13+ (through the plugin)
 * – creates the "default" channel (high importance)
 * – deletes the token on logout
 * – routes taps to the right screen (cold start, background, foreground)
 * – reposts foreground pushes as local notifications so the phone shows
 *   them even while the app is open
 *
 * On the web every native call is skipped, so the browser build works.
 */
@Injectable({ providedIn: 'root' })
export class PushService {
  private readonly native = Capacitor.isNativePlatform();
  private started = false;
  private listenersBound = false;
  private initialized = false;
  private token = '';
  private authSub?: Subscription;

  constructor(
    private sb: SupabaseService,
    private auth: AuthService,
    private localReminders: LocalReminderService,
    private router: Router,
    private zone: NgZone
  ) {}

  /** Called once from AppComponent (root). */
  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    if (!this.native) {
      return;
    }
    void this.bindListeners();
    this.authSub = this.auth.changes$.subscribe((session) => {
      if (session) {
        void this.initAfterLogin();
      } else {
        void this.removeToken();
      }
    });
    if (this.auth.getUserId()) {
      void this.initAfterLogin();
    }
  }

  private async bindListeners(): Promise<void> {
    if (this.listenersBound) {
      return;
    }
    this.listenersBound = true;
    try {
      await PushNotifications.addListener('registration', (token: Token) => {
        void this.saveToken(token.value);
      });
      await PushNotifications.addListener('registrationError', () => {
        /* no Firebase / no Play services — quiet failure, app keeps working */
      });
      await PushNotifications.addListener(
        'pushNotificationReceived',
        (notification: PushNotificationSchema) => {
          void this.onForegroundPush(notification);
        }
      );
      await PushNotifications.addListener(
        'pushNotificationActionPerformed',
        (action: ActionPerformed) => {
          void this.navigate(action.notification.data);
        }
      );
      await LocalNotifications.addListener(
        'localNotificationActionPerformed',
        (action) => {
          const extra = (action.notification.extra ?? {}) as Record<string, unknown>;
          void this.navigate(extra);
        }
      );
    } catch {
      /* plugin unavailable */
    }
  }

  private async initAfterLogin(): Promise<void> {
    if (!this.native || this.initialized) {
      return;
    }
    this.initialized = true;
    await this.bindListeners();
    await this.localReminders.ensureChannel();
    try {
      let permission = await PushNotifications.checkPermissions();
      if (permission.receive !== 'granted') {
        permission = await PushNotifications.requestPermissions();
      }
      if (permission.receive !== 'granted') {
        return;
      }
      await PushNotifications.register();
    } catch {
      this.initialized = false;
    }
  }

  private async saveToken(token: string): Promise<void> {
    if (!token) {
      return;
    }
    this.token = token;
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* private mode */
    }
    const uid = this.auth.getUserId();
    if (!uid) {
      return;
    }
    try {
      await this.sb.client.from('device_tokens').upsert(
        {
          user_id: uid,
          token,
          platform: 'android',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'token' }
      );
    } catch {
      /* run device-tokens.sql / check RLS; push simply stays unregistered */
    }
  }

  private async removeToken(): Promise<void> {
    this.initialized = false;
    let token = this.token;
    if (!token) {
      try {
        token = localStorage.getItem(TOKEN_KEY) ?? '';
      } catch {
        token = '';
      }
    }
    this.token = '';
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    if (!token) {
      return;
    }
    try {
      await this.sb.client.from('device_tokens').delete().eq('token', token);
    } catch {
      /* best effort — the send-push function also drops invalid tokens */
    }
  }

  /**
   * Foreground FCM messages are already drawn by @capacitor/push-notifications
   * (presentationOptions = alert/badge/sound), so we must NOT post a local
   * copy here or the phone would show it twice. The only work left is to
   * cancel the pre-scheduled local reminder for the same ticket.
   */
  private async onForegroundPush(
    notification: PushNotificationSchema
  ): Promise<void> {
    const data = this.stringData(notification.data);
    const ticketId = data['ticket_id'] ?? '';
    if (data['type'] === 'event_reminder' && ticketId) {
      await this.localReminders.cancelById(
        this.localReminders.idFor(ticketId)
      );
    }
  }

  /** Opens the screen encoded in the push/local notification data. */
  private async navigate(raw: unknown): Promise<void> {
    await this.auth.ensureSession().catch(() => undefined);
    const data = this.stringData(raw);
    const type = data['type'] ?? '';
    const screen = data['screen'] ?? '';
    const code = data['ticket_code'] ?? '';

    let path = '/notifications';
    if (type === 'new_booking' || screen === 'booking') {
      path = code
        ? `/admin/bookings?q=${encodeURIComponent(code)}`
        : '/admin/bookings';
    } else if (code) {
      path = `/ticket/${encodeURIComponent(code)}`;
    }

    this.zone.run(() => {
      void this.router.navigateByUrl(path).catch(() => undefined);
    });
  }

  private stringData(raw: unknown): Record<string, string> {
    const out: Record<string, string> = {};
    if (raw && typeof raw === 'object') {
      Object.entries(raw as Record<string, unknown>).forEach(([key, value]) => {
        if (value !== null && value !== undefined) {
          out[key] = String(value);
        }
      });
    }
    return out;
  }
}

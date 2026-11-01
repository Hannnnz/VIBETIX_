import { Injectable, NgZone } from '@angular/core';

export interface AppNotification {
  id: string;
  type: 'purchase' | 'attendance' | 'info';
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
}

/**
 * Lightweight in-app notification center.
 *
 * Real transactional e-mail delivery needs a provider (Resend/SendGrid/etc.)
 * and a backend secret key. Until that is configured, notifications are
 * recorded here (per signed-in user, in localStorage) and surfaced in the UI
 * so the customer still gets a confirmation/attendance message.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private store: Record<string, AppNotification[]> = {};

  constructor(private zone: NgZone) {}

  private key(email: string): string {
    return (email || 'guest').toLowerCase();
  }

  private load(email: string): AppNotification[] {
    const k = this.key(email);
    if (this.store[k]) {
      return this.store[k];
    }
    try {
      const raw = localStorage.getItem('vibetix:notifications:' + k);
      this.store[k] = raw ? (JSON.parse(raw) as AppNotification[]) : [];
    } catch {
      this.store[k] = [];
    }
    return this.store[k];
  }

  private save(email: string): void {
    const k = this.key(email);
    try {
      localStorage.setItem('vibetix:notifications:' + k, JSON.stringify(this.store[k] ?? []));
    } catch {
      /* ignore */
    }
  }

  list(email: string): AppNotification[] {
    return [...this.load(email)].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  unreadCount(email: string): number {
    return this.load(email).filter((n) => !n.read).length;
  }

  markAllRead(email: string): void {
    const list = this.load(email);
    list.forEach((n) => (n.read = true));
    this.save(email);
  }

  push(email: string, n: Omit<AppNotification, 'id' | 'createdAt' | 'read'>): AppNotification {
    const created: AppNotification = {
      id: 'ntf_' + Math.random().toString(36).slice(2, 10),
      type: n.type,
      title: n.title,
      message: n.message,
      createdAt: new Date().toISOString(),
      read: false,
    };
    const list = this.load(email);
    list.unshift(created);
    // keep the list bounded
    if (list.length > 50) {
      list.length = 50;
    }
    this.save(email);
    this.zone.run(() => {
      /* trigger change detection for subscribers via a no-op touch */
    });
    return created;
  }

  notifyPurchase(email: string, ticketCode: string, concertName: string, total: number): AppNotification {
    return this.push(email, {
      type: 'purchase',
      title: 'Ticket confirmed 🎟️',
      message: `Your ticket for ${concertName} is confirmed. Code: ${ticketCode}. Total: ₱${total.toFixed(2)}. Show the QR code at the gate.`,
    });
  }

  notifyAttendance(email: string, ticketCode: string, concertName: string): AppNotification {
    return this.push(email, {
      type: 'attendance',
      title: 'Thanks for attending! 🎉',
      message: `You're checked in for ${concertName}. Ticket ${ticketCode} marked as attended. Enjoy the show!`,
    });
  }
}
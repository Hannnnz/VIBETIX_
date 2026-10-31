import { Injectable, NgZone } from '@angular/core';

import { SupabaseService } from './supabase.service';

/** Kind of payment instrument saved on the profile. */
export type MethodKind = 'gcash' | 'card' | 'play';

export interface SavedMethod {
  id: string;
  kind: MethodKind;
  label: string;
  /** Masked reference only — never full card numbers / CVVs. */
  detail: string;
  meta?: string;
}

/** The only receiver the app will ever settle to. */
export const MERCHANT = {
  name: 'VIBETIX Official',
  scope: 'Merchant payouts account (verified)',
  tag: 'VTX-MERCH-PH',
};

/** Luhn checksum for real debit/credit card numbers. */
export function passesLuhn(digits: string): boolean {
  const clean = digits.replace(/\D/g, '');
  if (clean.length < 13 || clean.length > 19) {
    return false;
  }
  let sum = 0;
  let double = false;
  for (let i = clean.length - 1; i >= 0; i--) {
    let d = Number(clean[i]);
    if (double) {
      d *= 2;
      if (d > 9) {
        d -= 9;
      }
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export function onlyDigits(value: string): string {
  return (value || '').replace(/\D/g, '');
}

export function maskCardTail(digits: string): string {
  const tail = digits.slice(-4);
  return `•••• •••• •••• ${tail}`;
}

export function maskPhone(digits: string): string {
  if (digits.length < 4) {
    return '••••';
  }
  return `+63 ••• ••• ${digits.slice(-4)}`;
}

interface MethodRow {
  id: string;
  kind: MethodKind;
  label: string;
  detail: string;
  meta: string | null;
}

/**
 * Saved payment methods live in the Supabase `payment_methods` table.
 * SECURITY: only MASKED references are ever stored (last 4 digits).
 * Full card numbers and CVVs never leave the client form.
 */
@Injectable({ providedIn: 'root' })
export class PaymentService {
  /** cache per email for the sync getters pages already use */
  private store: Record<string, SavedMethod[]> = {};

  /** Last failure message (empty when the previous call succeeded). */
  lastError = '';

  constructor(
    private sb: SupabaseService,
    private zone: NgZone
  ) {}

  private get client() {
    return this.sb.client;
  }

  private ensure(email: string): SavedMethod[] {
    const key = email || 'guest';
    if (!this.store[key]) {
      this.store[key] = [];
    }
    return this.store[key];
  }

  /** Pulls the signed-in user's saved methods from the database. */
  async hydrate(email: string): Promise<void> {
    const list = this.ensure(email);
    this.lastError = '';
    try {
      const me = await this.sb.client.auth.getUser();
      const uid = me.data?.user?.id;
      let q = this.client
        .from('payment_methods')
        .select('id, kind, label, detail, meta')
        .order('created_at', { ascending: true });
      if (uid) {
        q = q.eq('customer_id', uid);
      }
      const { data, error } = await q;
      if (error || !data) {
        this.lastError = error?.message ?? 'Could not load saved payment methods.';
        return;
      }
      this.zone.run(() => {
        list.length = 0;
        (data as MethodRow[]).forEach((row) => {
          list.push({
            id: row.id,
            kind: row.kind,
            label: row.label,
            detail: row.detail,
            meta: row.meta ?? undefined,
          });
        });
      });
    } catch {
      /* keep current cache */
    }
  }

  getMethods(email: string): SavedMethod[] {
    return [...this.ensure(email)];
  }

  /** Adds a method to the real table; the masked detail was computed by the caller. */
  async add(
    email: string,
    method: Omit<SavedMethod, 'id'>
  ): Promise<SavedMethod | null> {
    this.lastError = '';
    const me = await this.sb.client.auth.getUser();
    const userId = me.data?.user?.id;
    if (!userId) {
      this.lastError = 'You are signed out — sign in again to save a method.';
      return null;
    }
    const { data, error } = await this.client
      .from('payment_methods')
      .insert({
        customer_id: userId,
        kind: method.kind,
        label: method.label,
        detail: method.detail,
        meta: method.meta ?? null,
      })
      .select()
      .single();
    if (error || !data) {
      this.lastError = error?.message ?? 'Could not save this payment method.';
      console.error('method add failed', error);
      return null;
    }
    const row = data as MethodRow;
    const saved: SavedMethod = {
      id: row.id,
      kind: row.kind,
      label: row.label,
      detail: row.detail,
      meta: row.meta ?? undefined,
    };
    this.zone.run(() => {
      this.ensure(email).push(saved);
    });
    return saved;
  }

  async remove(email: string, id: string): Promise<void> {
    this.lastError = '';
    const { error } = await this.client
      .from('payment_methods')
      .delete()
      .eq('id', id);
    if (error) {
      this.lastError = error.message;
      console.error('method remove failed', error);
      return;
    }
    this.zone.run(() => {
      const list = this.ensure(email);
      const idx = list.findIndex((m) => m.id === id);
      if (idx >= 0) {
        list.splice(idx, 1);
      }
    });
  }
}

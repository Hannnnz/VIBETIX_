import { Injectable } from '@angular/core';

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

/** Demo in-memory wallet (per email). Resets with the app like everything else. */
const SEED: Record<string, SavedMethod[]> = {
  'user@gmail.com': [
    {
      id: 'm1',
      kind: 'gcash',
      label: 'GCash',
      detail: '+63 ••• ••• 4021',
      meta: 'Juan Customer',
    },
    {
      id: 'm2',
      kind: 'card',
      label: 'Visa Debit',
      detail: '•••• •••• •••• 5299',
      meta: 'Expires 09/28',
    },
  ],
};

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

@Injectable({ providedIn: 'root' })
export class PaymentService {
  private store: Record<string, SavedMethod[]> = { ...SEED };

  getMethods(email: string): SavedMethod[] {
    return [...(this.store[email] ?? [])];
  }

  add(email: string, method: Omit<SavedMethod, 'id'>): SavedMethod {
    const saved: SavedMethod = {
      ...method,
      id: 'm' + Date.now(),
    };
    const list = this.store[email] ?? (this.store[email] = []);
    list.push(saved);
    return saved;
  }

  remove(email: string, id: string): void {
    this.store[email] = (this.store[email] ?? []).filter((m) => m.id !== id);
  }
}

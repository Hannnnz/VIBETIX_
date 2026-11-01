import { ChangeDetectorRef, Component, NgZone } from '@angular/core';
import { AlertController } from '@ionic/angular/lazy';
import { ToastController } from '@ionic/angular/lazy';
import {
  PaymentService,
  SavedMethod,
  MethodKind,
  onlyDigits,
  passesLuhn,
  maskCardTail,
  maskPhone,
} from '../services/payment.service';
import { AuthService } from '../services/auth.service';
import { runRefresh } from '../utils/refresher';

@Component({
  selector: 'app-payment-methods',
  templateUrl: './payment-methods.page.html',
  styleUrls: ['./payment-methods.page.scss'],
  standalone: false,
})
export class PaymentMethodsPage {
  methods: SavedMethod[] = [];
  adding = false;

  /** Add form */
  kind: 'gcash' | 'card' = 'gcash';
  gcashNumber = '';
  cardNumber = '';
  cardName = '';

  readonly kindLabels: Record<string, string> = {
    gcash: 'GCash',
    card: 'Debit / credit card',
    play: 'Google Play (auto-linked)',
  };

  readonly kindIcons: Record<string, string> = {
    gcash: 'phone-portrait-outline',
    card: 'card-outline',
    play: 'logo-google-play',
  };

  constructor(
    private paymentService: PaymentService,
    private auth: AuthService,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
    private zone: NgZone,
    private cdr: ChangeDetectorRef
  ) {}

  ionViewWillEnter(): void {
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    await this.auth.ensureSession().catch(() => undefined);
    const email = this.auth.getSession()?.email ?? '';
    await this.paymentService.hydrate(email);
    this.zone.run(() => {
      this.methods = this.paymentService.getMethods(email);
      this.cdr.detectChanges();
    });
  }

  /** Pull-down-to-refresh refetches saved methods from the DB. */
  async doRefresh(event: Event): Promise<void> {
    await runRefresh(event, async () => {
      await this.refresh();
      this.cdr.detectChanges();
    });
  }

  toggleAdd(): void {
    this.adding = !this.adding;
    this.kind = 'gcash';
  }

  async save(): Promise<void> {
    const email = this.auth.getSession()?.email;
    if (!email) {
      this.toast('You are signed out — sign in again to save a method.', 3500);
      return;
    }

    let saved: SavedMethod | null = null;

    if (this.kind === 'gcash') {
      const digits = onlyDigits(this.gcashNumber);
      if (digits.length < 10) {
        this.toast('Enter a valid mobile number (10 digits).', 3500);
        return;
      }
      saved = await this.paymentService.add(email, {
        kind: 'gcash',
        label: 'GCash',
        detail: maskPhone(digits),
        meta: 'Linked wallet',
      });
    } else {
      const digits = onlyDigits(this.cardNumber);
      if (!passesLuhn(digits)) {
        this.toast('Card number failed validation.', 3500);
        return;
      }
      if (!this.cardName.trim()) {
        this.toast('Cardholder name is required.', 3500);
        return;
      }
      saved = await this.paymentService.add(email, {
        kind: 'card',
        label: `${this.brand(digits)} Debit`,
        detail: maskCardTail(digits),
        meta: `${this.cardName.trim().toUpperCase()}`,
      });
    }

    // Never claim success when the database rejected the row.
    if (!saved) {
      this.toast(this.explainSaveFailure(), 5000);
      return;
    }

    this.adding = false;
    this.gcashNumber = '';
    this.cardNumber = '';
    this.cardName = '';
    this.cdr.detectChanges();
    await this.refresh();
    this.toast('Payment method saved successfully.', 2500, 'success');
  }

  /** Turns a raw Postgres/PostgREST error into something actionable. */
  private explainSaveFailure(): string {
    const raw = this.paymentService.lastError;
    if (/row-level security|permission denied|42501/i.test(raw)) {
      return 'Saving is blocked by the database policy — run supabase/fix-checkout.sql in the Supabase SQL Editor, then try again.';
    }
    if (/sign in|signed out|jwt|401/i.test(raw)) {
      return 'Your session expired — sign in again, then retry.';
    }
    return raw || 'Could not save this method. Check your connection and try again.';
  }

  private brand(digits: string): string {
    if (/^4/.test(digits)) {
      return 'Visa';
    }
    if (/^5[1-5]/.test(digits)) {
      return 'Mastercard';
    }
    return 'Card';
  }

  async remove(method: SavedMethod): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Remove method',
      message: `Remove ${method.label} ${method.detail}?`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Remove',
          role: 'destructive',
          handler: () => {
            void (async () => {
              const email = this.auth.getSession()?.email ?? '';
              await this.paymentService.remove(email, method.id);
              await this.refresh();
              this.toast('Payment method removed.', 2000, 'medium');
            })();
          },
        },
      ],
    });
    await alert.present();
  }

  private async toast(message: string, duration = 2000, color = 'dark'): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration,
      position: 'top',
      color,
    });
    await toast.present();
  }
}

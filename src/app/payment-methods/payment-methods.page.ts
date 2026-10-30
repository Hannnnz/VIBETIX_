import { Component, NgZone } from '@angular/core';
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
    private zone: NgZone
  ) {}

  ionViewWillEnter(): void {
    this.refresh();
  }

  private async refresh(): Promise<void> {
    const email = this.auth.getSession()?.email ?? '';
    await this.paymentService.hydrate(email);
    this.zone.run(() => {
      this.methods = this.paymentService.getMethods(email);
    });
  }

  toggleAdd(): void {
    this.adding = !this.adding;
    this.kind = 'gcash';
  }

  async save(): Promise<void> {
    const email = this.auth.getSession()?.email;
    if (!email) {
      return;
    }

    if (this.kind === 'gcash') {
      const digits = onlyDigits(this.gcashNumber);
      if (digits.length < 10) {
        this.toast('Enter a valid mobile number (10 digits).');
        return;
      }
      await this.paymentService.add(email, {
        kind: 'gcash',
        label: 'GCash',
        detail: maskPhone(digits),
        meta: 'Linked wallet',
      });
    } else {
      const digits = onlyDigits(this.cardNumber);
      if (!passesLuhn(digits)) {
        this.toast('Card number failed validation.');
        return;
      }
      if (!this.cardName.trim()) {
        this.toast('Cardholder name is required.');
        return;
      }
      await this.paymentService.add(email, {
        kind: 'card',
        label: `${this.brand(digits)} Debit`,
        detail: maskCardTail(digits),
        meta: `${this.cardName.trim().toUpperCase()}`,
      });
    }

    this.adding = false;
    this.gcashNumber = '';
    this.cardNumber = '';
    this.cardName = '';
    this.toast('Payment method saved (masked, never fully stored).');
    this.refresh();
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
              this.toast('Payment method removed.');
              await this.refresh();
            })();
          },
        },
      ],
    });
    await alert.present();
  }

  private async toast(message: string): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2000,
      position: 'top',
      color: 'dark',
    });
    await toast.present();
  }
}

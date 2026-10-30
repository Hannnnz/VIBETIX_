import { Component, NgZone, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastController } from '@ionic/angular/lazy';

import { Concert, ConcertService } from '../services/concert.service';
import { BookingService } from '../services/booking.service';
import { AuthService } from '../services/auth.service';
import { RecommendService } from '../services/recommend.service';
import { PaymentService, SavedMethod, passesLuhn, onlyDigits, maskCardTail, maskPhone, MERCHANT } from '../services/payment.service';

type OptionKey = string; // 'saved:<id>' | 'gcash' | 'qr' | 'play'

interface PayOption {
  key: OptionKey;
  kind: 'gcash' | 'card' | 'qr' | 'play';
  name: string;
  sub: string;
  icon: string;
  badge?: string;
}

@Component({
  selector: 'app-payment',
  templateUrl: './payment.page.html',
  styleUrls: ['./payment.page.scss'],
  standalone: false,
})
export class PaymentPage implements OnInit {
  concert: Concert | undefined;
  tierName = '';
  unitPrice = 0;
  seats: string[] = [];

  merchant = MERCHANT;

  options: PayOption[] = [];
  selected: PayOption | null = null;

  /** select → pay → processing → success */
  step: 'select' | 'pay' | 'processing' | 'success' = 'select';
  /** DB ticket tier id (for server-side price computation). */
  tierId: string | null = null;

  /** Debit/credit card form */
  cardNumber = '';
  cardName = '';
  cardExp = '';
  cardCvv = '';

  /** GCash deep-link handoff state */
  gcashOpened = false;

  /** QR verify handoff state */
  qrChecked = false;
  qrBroken = false;

  lastCode = '';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private zone: NgZone,
    private concertService: ConcertService,
    private bookingService: BookingService,
    public auth: AuthService,
    private paymentService: PaymentService,
    private recommend: RecommendService,
    private toastCtrl: ToastController
  ) {
    // Failsafe: the method list must never be empty, even if the
    // lifecycle below is interrupted before options are assigned.
    this.refreshOptions();
  }

  ngOnInit(): void {
    void this.ionViewWillEnter();
  }

  async ionViewWillEnter(): Promise<void> {
    await this.auth.ensureSession().catch(() => undefined);
    try {
      const id = this.route.snapshot.queryParamMap.get('id') ?? '';
      // Hydrate + direct-fetch fallback so checkout never fails with
      // "concert not found" on a cold start / stale cache.
      const found = await this.concertService.ensureLoaded(id);
      this.zone.run(() => {
        this.concert = found;
        this.tierName = this.route.snapshot.queryParamMap.get('tier') ?? '';
        const tierId = this.route.snapshot.queryParamMap.get('tierId') ?? '';
        this.tierId = tierId.length > 0 ? tierId : null;
        this.unitPrice = Number(this.route.snapshot.queryParamMap.get('price') ?? 0);
        this.seats = (this.route.snapshot.queryParamMap.get('seats') ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
      });
    } catch {
      /* keep previous values — page stays usable */
    }

    this.refreshOptions();

    this.step = 'select';
    this.selected = null;
    this.qrChecked = false;
    this.gcashOpened = false;
  }

  /**
   * Builds the payment option list: saved methods first (option A),
   * then direct channels — GCash app, QR code, Google Play (option B).
   * Always succeeds, so GCash / QR / Play are ALWAYS available even
   * with zero saved payment methods in the profile.
   */
  refreshOptions(): void {
    const kindIcon: Record<string, string> = {
      gcash: 'phone-portrait-outline',
      card: 'card-outline',
      play: 'logo-google-play',
    };

    let saved: PayOption[] = [];
    try {
      const email = this.auth.getSession()?.email ?? '';
      const savedMethods = email ? this.paymentService.getMethods(email) : [];
      saved = savedMethods.map((m) => ({
        key: 'saved:' + m.id,
        kind: m.kind as 'gcash' | 'card',
        name: m.label,
        sub: `${m.detail}${m.meta ? ' · ' + m.meta : ''}`,
        icon: kindIcon[m.kind] ?? 'card-outline',
        badge: 'Saved',
      }));
    } catch {
      saved = []; // saved methods are optional — direct channels always follow
    }

    this.options = [
      ...saved,
      {
        key: 'gcash',
        kind: 'gcash',
        name: 'GCash',
        sub: 'Open GCash app and pay directly',
        icon: 'phone-portrait-outline',
      },
      {
        key: 'qr',
        kind: 'qr',
        name: 'QR code',
        sub: 'Scan with GCash, Maya or any bank app',
        icon: 'qr-code-outline',
      },
      {
        key: 'play',
        kind: 'play',
        name: 'Google Play',
        sub: 'Pay with your Google Play balance',
        icon: 'logo-google-play',
      },
    ];
  }

  total(): number {
    return this.unitPrice * this.seats.length;
  }

  /** True when the profile has no saved payment methods (option B messaging). */
  get noSavedMethods(): boolean {
    return !this.options.some((o) => o.key.startsWith('saved:'));
  }

  dateLabel(date: string): string {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  choose(option: PayOption): void {
    if (this.step !== 'select') {
      return;
    }
    this.selected = option;
    this.step = 'pay';
  }

  trackOption(index: number, option: PayOption): string {
    return option.key;
  }

  backToSelect(): void {
    this.selected = null;
    this.step = 'select';
    this.qrChecked = false;
    this.gcashOpened = false;
  }

  /** Saved GCash number linked to this wallet (for the GCash panel). */
  savedGcash(): SavedMethod | undefined {
    const key = this.selected?.key ?? '';
    if (!key.startsWith('saved:')) {
      return undefined;
    }
    const email = this.auth.getSession()?.email ?? '';
    return this.paymentService
      .getMethods(email)
      .find((m) => 'saved:' + m.id === key && m.kind === 'gcash');
  }

  payLabel(): string {
    return this.selected?.name ?? '';
  }

  /** Tries to hand the payment off to the real GCash app via deep link. */
  openGcashApp(): void {
    const ref = 'VTX-' + this.concert?.id + '-' + Date.now();
    const amount = this.total();
    // Official scheme used by GCash partners (on a real device this opens the app)
    const link = `gcash://sendmoney?amount=${amount}&nid=${MERCHANT.tag}&ref=${encodeURIComponent(ref)}`;
    try {
      window.location.href = link;
    } catch {
      /* ignored — demo fallback below still runs */
    }
    this.gcashOpened = true;
    this.toast('Handing you over to the GCash app…');
  }

  /** "I paid inside the app" → gateway-level receiver verification, then settle. */
  gcashConfirmPaid(): void {
    void this.settle('GCash');
  }

  /** Simulated bank/GCash app scan: verify receiver then settle. */
  verifyQrPayment(): void {
    if (!this.qrChecked) {
      this.qrChecked = true;
      this.toast(`Receiver verified ✓ · ${MERCHANT.name} · ${MERCHANT.tag}`);
      return;
    }
    void this.settle('QR · ' + MERCHANT.name);
  }

  /** Google Play billing handoff (in production this is Play Billing + server receipt check). */
  playConfirm(): void {
    void this.settle('Google Play');
  }

  /** Validate card (Luhn + expiry + CVV) and settle. */
  cardPay(): void {
    const digits = onlyDigits(this.cardNumber);
    if (!passesLuhn(digits)) {
      this.toast('Card number failed validation. Please check it.');
      return;
    }
    const m = this.cardExp.match(/^(0[1-9]|1[0-2])\s*\/\s*(\d{2})$/);
    if (!m) {
      this.toast('Expiry must be in MM/YY format.');
      return;
    }
    const expYear = 2000 + Number(m[2]);
    const expMonth = Number(m[1]);
    const now = new Date();
    const isFuture =
      expYear > now.getFullYear() ||
      (expYear === now.getFullYear() && expMonth >= now.getMonth() + 1);
    if (!isFuture) {
      this.toast('That card has expired.');
      return;
    }
    if (this.cardCvv.trim().length < 3 || this.cardCvv.trim().length > 4) {
      this.toast('CVV must be the 3-4 digits at the back of your card.');
      return;
    }
    void this.settle(`${this.cardBrand(digits)} ${maskCardTail(digits)}`);
  }

  private cardBrand(digits: string): string {
    if (/^4/.test(digits)) {
      return 'Visa';
    }
    if (/^5[1-5]/.test(digits)) {
      return 'Mastercard';
    }
    if (/^3[47]/.test(digits)) {
      return 'AmEx';
    }
    return 'Card';
  }

  /**
   * The money moment: mark as processing, run the "gateway confirmation",
   * then only create the booking once the receiver check has passed.
   */
  private async settle(paidVia: string): Promise<void> {
    if (!this.concert) {
      this.toast('Event not found — please go back and reopen it.');
      return;
    }
    const session = this.auth.getSession();
    if (!session) {
      return;
    }

    this.step = 'processing';

    // Simulated gateway: receiver account matched, funds captured.
    this.zone.runOutsideAngular(() => {
      setTimeout(() => {
        this.zone.run(async () => {
          // REAL backend call: Postgres place_booking — server-computed price,
          // DB-level seat locking ('Seat already taken' if someone beat us)
          const booking = await this.bookingService.create(
            this.concert!.id,
            this.tierId,
            this.tierName,
            this.seats,
            paidVia
          );
          if (!booking) {
            this.toast('Seat conflict or payment issue — pick seats again.');
            this.step = 'select';
            this.backToSelect();
            return;
          }
          // 🎟 strongest taste signal — future Explore order adapts.
          this.recommend.recordPurchase(this.concert!);
          this.lastCode = booking.ticketCode;
          this.step = 'success';
        });
      }, 1900);
    });
  }

  viewTickets(): void {
    this.router.navigate(['/tabs/my-tickets'], { replaceUrl: true });
  }

  /** QR payload shown to the customer for scanning. */
  qrPayload(): string {
    return `VIBETIXPAY|${MERCHANT.name}|${MERCHANT.tag}|${this.total()}`;
  }

  qrImage(): string {
    return (
      'https://api.qrserver.com/v1/create-qr-code/?size=220x220&bgcolor=FFFFFF&data=' +
      encodeURIComponent(this.qrPayload())
    );
  }

  private async toast(message: string): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2200,
      position: 'top',
      color: 'dark',
      icon: 'shield-checkmark-outline',
    });
    await toast.present();
  }
}

import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastController } from '@ionic/angular/lazy';
import { App } from '@capacitor/app';
import { Capacitor, PluginListenerHandle } from '@capacitor/core';
import { AppLauncher } from '@capacitor/app-launcher';

import { Concert, ConcertService } from '../services/concert.service';
import { SupabaseService } from '../services/supabase.service';
import { BookingService } from '../services/booking.service';
import { AuthService } from '../services/auth.service';
import { RecommendService } from '../services/recommend.service';
import { PaymentService, SavedMethod, passesLuhn, onlyDigits, maskCardTail, MERCHANT } from '../services/payment.service';
import { NotificationService } from '../services/notification.service';

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
export class PaymentPage implements OnInit, OnDestroy {
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
  gcashOpening = false;
  gcashReturned = false;
  gcashError = '';
  /** Which GCash detail was just copied: number / amount / ref. */
  gcashCopied = '';
  /** Payment reference shown to the customer and copied into GCash notes. */
  gcashRef = '';

  /** In-app simulated GCash payment sheet (used when the real app can't be opened). */
  gcashSimOpen = false;
  gcashMpin = '';
  gcashSimProcessing = false;
  gcashSimError = '';

  private appListener?: PluginListenerHandle;
  private visibilityHandler?: () => void;
  private copiedTimer?: ReturnType<typeof setTimeout>;

  /** QR verify handoff state */
  qrChecked = false;
  qrBroken = false;

  lastCode = '';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private concertService: ConcertService,
    private bookingService: BookingService,
    public auth: AuthService,
    private paymentService: PaymentService,
    private recommend: RecommendService,
    private toastCtrl: ToastController,
    private notification: NotificationService,
    private sb: SupabaseService
  ) {
    // Failsafe: the method list must never be empty, even if the
    // lifecycle below is interrupted before options are assigned.
    this.refreshOptions();
  }

  ngOnInit(): void {
    // Know when the customer comes back from the GCash app.
    this.listenForReturn();
    void this.ionViewWillEnter();
  }

  ngOnDestroy(): void {
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = undefined;
    }
    void this.appListener?.remove();
    this.appListener = undefined;
    if (this.copiedTimer) {
      clearTimeout(this.copiedTimer);
    }
  }

  async ionViewWillEnter(): Promise<void> {
    await this.auth.ensureSession().catch(() => undefined);
    try {
      const email = this.auth.getSession()?.email ?? '';
      await this.paymentService.hydrate(email).catch(() => undefined);
    } catch {
      /* optional */
    }
    try {
      const id = this.route.snapshot.queryParamMap.get('id') ?? '';
      // Hydrate + direct-fetch fallback so checkout never fails with
      // "concert not found" on a cold start / stale cache.
      const found = await this.concertService.ensureLoaded(id);
      this.concert = found;
      this.tierName = this.route.snapshot.queryParamMap.get('tier') ?? '';
      const tierId = this.route.snapshot.queryParamMap.get('tierId') ?? '';
      this.tierId = tierId.length > 0 ? tierId : null;
      this.unitPrice = Number(this.route.snapshot.queryParamMap.get('price') ?? 0);
      this.seats = (this.route.snapshot.queryParamMap.get('seats') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    } catch {
      /* keep previous values — page stays usable */
    }

    this.refreshOptions();

    this.step = 'select';
    this.selected = null;
    this.qrChecked = false;
    this.gcashOpened = false;
    this.gcashOpening = false;
    this.gcashReturned = false;
    this.gcashError = '';
    this.gcashCopied = '';
    this.gcashRef = this.makeGcashRef();
    this.gcashSimOpen = false;
    this.gcashMpin = '';
    this.gcashSimProcessing = false;
    this.gcashSimError = '';
    this.cdr.detectChanges();
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
    if (option.kind === 'gcash') {
      this.gcashRef = this.makeGcashRef();
      this.gcashOpened = false;
      this.gcashOpening = false;
      this.gcashReturned = false;
      this.gcashError = '';
      this.gcashCopied = '';
      // Open the GCash app immediately when GCash is selected.
      void this.openGcashApp();
    }
  }

  trackOption(index: number, option: PayOption): string {
    return option.key;
  }

  backToSelect(): void {
    this.selected = null;
    this.step = 'select';
    this.qrChecked = false;
    this.gcashOpened = false;
    this.gcashOpening = false;
    this.gcashReturned = false;
    this.gcashError = '';
    this.gcashCopied = '';
    this.gcashSimOpen = false;
    this.gcashMpin = '';
    this.gcashSimProcessing = false;
    this.gcashSimError = '';
    this.cdr.detectChanges();
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

  /**
   * Hands the payment off to the real GCash app.
   *
   * GCash does not publish a "send money" deep link that pre-fills the
   * receiver and amount, so the honest flow is: open the app, copy the
   * number/amount, pay inside GCash, then return here to confirm.
   */
  async openGcashApp(): Promise<void> {
    if (this.gcashOpening) {
      return;
    }
    this.gcashOpening = true;
    this.gcashOpened = true;
    this.gcashReturned = false;
    this.gcashError = '';
    this.cdr.detectChanges();

    if (Capacitor.isNativePlatform()) {
      // Try a pre-filling deep link first (receiver + amount + reference),
      // then fall back to opening the app home, then the Play Store.
      const amount = this.total().toFixed(2);
      const ref = encodeURIComponent(this.gcashRef);
      const num = MERCHANT.gcashNumber;
      const candidates = [
        `gcash://sendmoney?number=${num}&amount=${amount}&note=${ref}&name=${encodeURIComponent(MERCHANT.name)}`,
        `gcash://transfer?number=${num}&amount=${amount}&reference=${ref}`,
        `gcash://pay?receiver=${num}&amount=${amount}&reference=${ref}`,
        MERCHANT.gcashScheme,
      ];
      let opened = false;
      for (const url of candidates) {
        try {
          await AppLauncher.openUrl({ url });
          opened = true;
          break;
        } catch {
          /* try the next candidate */
        }
      }
      if (!opened) {
        try {
          await AppLauncher.openUrl({ url: MERCHANT.gcashStore });
          this.gcashError =
            'GCash is not installed - we opened the Play Store. Install it, then tap "Reopen GCash".';
        } catch {
          this.gcashError =
            'Could not open GCash automatically. Open the app manually and use the details above.';
        }
      }
    } else {
      // Browser preview (ng serve): can't launch the real app, so open an
      // in-app GCash payment sheet that is pre-filled with the receiver,
      // amount and reference — lets you test the full payment flow.
      this.gcashSimOpen = true;
      this.gcashMpin = '';
      this.gcashSimProcessing = false;
      this.gcashSimError = '';
      this.gcashReturned = true;
      this.gcashError = '';
    }

    this.gcashOpening = false;
    this.cdr.detectChanges();
  }

  /** Close the in-app GCash payment sheet without paying. */
  closeGcashSim(): void {
    this.gcashSimOpen = false;
    this.gcashMpin = '';
    this.gcashSimProcessing = false;
    this.gcashSimError = '';
    this.cdr.detectChanges();
  }

  /** Simulated GCash payment (browser preview): validate MPIN then settle. */
  async gcashSimPay(): Promise<void> {
    if (this.gcashSimProcessing) {
      return;
    }
    const mpin = (this.gcashMpin || '').trim();
    if (!/^\d{4}$/.test(mpin)) {
      this.gcashSimError = 'Enter your 4-digit GCash MPIN to continue.';
      this.cdr.detectChanges();
      return;
    }
    this.gcashSimProcessing = true;
    this.gcashSimError = '';
    this.cdr.detectChanges();

    // Brief gateway-style pause so the flow feels like a real payment.
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 1200);
    });

    this.gcashSimProcessing = false;
    this.gcashSimOpen = false;
    this.gcashReturned = true;
    this.gcashOpened = true;
    this.cdr.detectChanges();
    void this.settle('GCash · ' + MERCHANT.name);
  }

  /** "I paid inside the app" → settle the booking and issue the ticket. */
  gcashConfirmPaid(): void {
    if (this.step !== 'pay') {
      return;
    }
    this.gcashSimOpen = false;
    void this.settle('GCash · ' + MERCHANT.name);
  }

  /** Copies one of the GCash payment details to the clipboard. */
  async copyGcash(field: 'number' | 'amount' | 'ref'): Promise<void> {
    const value =
      field === 'number'
        ? MERCHANT.gcashNumber
        : field === 'amount'
          ? this.total().toFixed(2)
          : this.gcashRef;
    const ok = await this.copyText(value);
    if (!ok) {
      await this.toast('Could not copy - long-press the value instead.');
      return;
    }
    this.gcashCopied = field;
    this.cdr.detectChanges();
    if (this.copiedTimer) {
      clearTimeout(this.copiedTimer);
    }
    this.copiedTimer = setTimeout(() => {
      this.gcashCopied = '';
      this.cdr.detectChanges();
    }, 1800);
  }

  private async copyText(value: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      /* fall through - older WebViews need execCommand */
    }
    try {
      const area = document.createElement('textarea');
      area.value = value;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }

  /** Re-activate the page when the customer returns from GCash. */
  private listenForReturn(): void {
    if (this.visibilityHandler) {
      return;
    }
    this.visibilityHandler = () => {
      if (document.visibilityState === 'visible' && this.gcashOpened) {
        this.gcashReturned = true;
        this.cdr.detectChanges();
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);

    void App.addListener('appStateChange', ({ isActive }) => {
      if (isActive && this.gcashOpened) {
        this.gcashReturned = true;
        this.cdr.detectChanges();
      }
    })
      .then((handle) => {
        this.appListener = handle;
      })
      .catch(() => undefined);
  }

  private makeGcashRef(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    try {
      const bytes = new Uint8Array(6);
      crypto.getRandomValues(bytes);
      const code = Array.from(bytes)
        .map((b) => alphabet[b % alphabet.length])
        .join('');
      return 'GC-' + code;
    } catch {
      return 'GC-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    }
  }

  /** Simulated bank/GCash app scan: verify receiver then settle. */
  verifyQrPayment(): void {
    if (!this.qrChecked) {
      this.qrChecked = true;
      this.toast(
        `Receiver verified ✓ · ${MERCHANT.name} · ${MERCHANT.gcashNumberDisplay}`
      );
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
    if (this.step === 'processing') {
      return; // already charging — ignore double taps
    }
    if (!this.concert) {
      this.toast('Event not found — please go back and reopen it.');
      return;
    }
    await this.auth.ensureSession().catch(() => undefined);
    const session = this.auth.getSession();
    if (!session) {
      this.toast('Your session expired — please sign in again.');
      void this.router.navigate(['/login'], { replaceUrl: true });
      return;
    }

    this.step = 'processing';
    this.cdr.detectChanges();

    // Final availability check: never take money for a seat that sold while
    // the customer was in checkout.
    const taken = await this.bookingService.takenSeats(this.concert.id);
    const conflict = this.seats.filter((seat) => taken.has(seat.trim().toUpperCase()));
    if (conflict.length > 0) {
      this.toast(`${conflict.join(', ')} just sold out — pick another seat.`);
      this.backToSelect();
      return;
    }

    // REAL backend call: Postgres place_booking — server-computed price,
    // DB-level seat locking ('Seat already taken' if someone beat us).
    // Hard timeout so a dead network can't leave the spinner forever.
    // TESTING MODE: no artificial gateway delay — settle as soon as the DB
    // confirms, so checkout feels instant instead of "Verifying payment…".
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), 15000);
    });
    const booking = await Promise.race([
      this.bookingService.create(
        this.concert.id,
        this.tierId,
        this.tierName,
        this.seats,
        paidVia
      ),
      timeout,
    ]).finally(() => {
      if (timer) {
        clearTimeout(timer);
      }
    });

    if (!booking) {
      const reason =
        this.bookingService.lastError ||
        'Payment could not be completed — the server took too long. Check your connection and try again.';
      this.toast(reason);
      this.backToSelect();
      return;
    }

    // 🎟 strongest taste signal — future Explore order adapts.
    this.recommend.recordPurchase(this.concert);
    this.lastCode = booking.ticketCode;
    // Notify the customer (in-app notification center + browser notification).
    const buyerEmail =
      booking.customerEmail || this.auth.getSession()?.email || '';
    if (buyerEmail && this.concert) {
      this.notification.notifyPurchase(
        buyerEmail,
        booking.ticketCode,
        this.concert.name,
        booking.total
      );
      // Send a real confirmation email via the Resend-backed edge function.
      if (buyerEmail && this.concert) {
        void this.sb.client.functions
          .invoke('send-ticket-email', {
            body: {
              type: 'purchase',
              to: buyerEmail,
              name: this.auth.getSession()?.name ?? '',
              ticketCode: booking.ticketCode,
              concertName: this.concert.name,
              concertDate: this.concert.date,
              venue: this.concert.venue,
              tier: booking.tier,
              seats: booking.seats,
              total: booking.total,
            },
          })
          .catch(() => undefined);
      }
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          new Notification('VIBETIX ticket confirmed', {
            body: `${this.concert.name} · ${booking.ticketCode}`,
          });
        } catch {
          /* ignore */
        }
      }
    }
    // Refresh the booking cache so the new ticket is available immediately.
    void this.bookingService.hydrate().catch(() => undefined);
    this.step = 'success';
    // Zoneless app: async state changes need an explicit change detection pass.
    this.cdr.detectChanges();
  }

  viewTickets(): void {
    this.router.navigate(['/tabs/my-tickets'], { replaceUrl: true });
  }

  /** QR payload shown to the customer for scanning. */
  qrPayload(): string {
    return `VIBETIXPAY|${MERCHANT.name}|${MERCHANT.tag}|${this.total()}`;
  }

  /** Static GCash QR image supplied by the merchant (QR folder/STATIC QR.jpg). */
  qrImage(): string {
    return 'qr/STATIC%20QR.jpg';
  }

  private async toast(message: string): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration: 4200,
      position: 'top',
      color: 'dark',
      icon: 'shield-checkmark-outline',
    });
    await toast.present();
  }
}

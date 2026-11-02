import { ChangeDetectorRef, Component, NgZone, OnInit } from '@angular/core';
import { AlertController } from '@ionic/angular/lazy';
import { Router } from '@angular/router';
import { AuthService, Session } from '../services/auth.service';
import { PaymentService, SavedMethod } from '../services/payment.service';
import { NotificationService, AppNotification } from '../services/notification.service';
import { runRefresh } from '../utils/refresher';

@Component({
  selector: 'app-account',
  templateUrl: './account.page.html',
  styleUrls: ['./account.page.scss'],
  standalone: false,
})
export class AccountPage implements OnInit {
  session: Session | null = null;
  methods: SavedMethod[] = [];
  notifications: AppNotification[] = [];
  staffCount = 0;
  companyCode = '…';

  readonly kindIcons: Record<string, string> = {
    gcash: 'phone-portrait-outline',
    card: 'card-outline',
    play: 'logo-google-play',
  };

  readonly roleLabels: Record<string, string> = {
    admin: 'Administrator',
    staff: 'Event Staff',
    customer: 'Customer',
  };

  constructor(
    public auth: AuthService,
    private paymentService: PaymentService,
    private notificationService: NotificationService,
    private router: Router,
    private alertCtrl: AlertController,
    private zone: NgZone,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    void this.ionViewWillEnter();
  }

  async ionViewWillEnter(): Promise<void> {
    // Restore the persisted session first (survives refresh / cold start)
    await this.auth.ensureSession().catch(() => undefined);
    this.zone.run(() => {
      this.session = this.auth.getSession();
      this.cdr.detectChanges();
    });
    await this.refreshMethods();
    this.zone.run(() => {
      this.notifications = this.notificationService.list(this.session?.email ?? '');
      this.cdr.detectChanges();
    });

    // Admin extras: staff count + current company code (from Supabase)
    if (this.session?.role === 'admin') {
      try {
        const staff = await this.auth.staffAccounts();
        this.zone.run(() => {
          this.staffCount = staff.length;
          this.cdr.detectChanges();
        });
      } catch {
        /* keep previous */
      }
      try {
        const code = await this.auth.refreshCompanyCode();
        this.zone.run(() => {
          this.companyCode = code || 'unavailable';
          this.cdr.detectChanges();
        });
      } catch {
        /* keep previous */
      }
    }
    if (this.session?.role === 'staff') {
      try {
        await this.auth.refreshCompanyCode();
      } catch {
        /* keep previous */
      }
    }
    this.cdr.detectChanges();
  }

  private async refreshMethods(): Promise<void> {
    const email = this.session?.email ?? '';
    try {
      await this.paymentService.hydrate(email);
    } catch {
      /* keep current cache */
    }
    this.zone.run(() => {
      this.methods = this.paymentService.getMethods(email);
      this.cdr.detectChanges();
    });
  }

  /** Pull-down-to-refresh refetches profile extras + saved methods. */
  async doRefresh(event: Event): Promise<void> {
    await runRefresh(event, async () => {
      // A cold start may not have restored the profile yet — do it first.
      await this.auth.ensureSession().catch(() => undefined);
      this.zone.run(() => (this.session = this.auth.getSession()));
      const email = this.session?.email ?? '';
      const jobs: Promise<void>[] = [
        this.paymentService.hydrate(email).then(() => {
          this.zone.run(() => (this.methods = this.paymentService.getMethods(email)));
        }),
      ];
      if (this.session?.role === 'admin') {
        jobs.push(
          this.auth.staffAccounts().then((staff) => {
            this.zone.run(() => (this.staffCount = staff.length));
          })
        );
      }
      if (this.session?.role === 'admin' || this.session?.role === 'staff') {
        jobs.push(
          this.auth.refreshCompanyCode().then((code) => {
            this.zone.run(() => (this.companyCode = code || 'unavailable'));
          })
        );
      }
      await Promise.all(jobs.map((p) => p.catch(() => undefined)));
    });
  }

  get isCustomer(): boolean {
    return this.session?.role === 'customer';
  }

  get isStaff(): boolean {
    return this.session?.role === 'staff';
  }

  get isAdmin(): boolean {
    return this.session?.role === 'admin';
  }

  get staffJoined(): boolean {
    return this.auth.isStaffJoined();
  }

  manageMethods(): void {
    this.router.navigate(['/tabs/payment-methods']);
  }

  openMyReviews(): void {
    this.router.navigate(['/tabs/my-reviews']);
  }

  joinCompany(): void {
    this.router.navigate(['/staff/join']);
  }

  manageTeam(): void {
    this.router.navigate(['/admin/team']);
  }

  dashboard(): void {
    if (this.isAdmin) {
      this.router.navigate(['/admin/dashboard']);
    }
  }

  initials(): string {
    if (!this.session?.name) {
      return '?';
    }
    return this.session.name
      .split(' ')
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  async logout(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Sign out',
      message: 'Are you sure you want to sign out of VIBETIX?',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Sign out',
          role: 'destructive',
          handler: () => {
            this.auth.logout();
            this.router.navigate(['/login'], { replaceUrl: true });
          },
        },
      ],
    });
    await alert.present();
  }
}

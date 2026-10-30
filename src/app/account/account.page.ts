import { Component, NgZone } from '@angular/core';
import { AlertController } from '@ionic/angular/lazy';
import { Router } from '@angular/router';
import { AuthService, Session } from '../services/auth.service';
import { PaymentService, SavedMethod } from '../services/payment.service';

@Component({
  selector: 'app-account',
  templateUrl: './account.page.html',
  styleUrls: ['./account.page.scss'],
  standalone: false,
})
export class AccountPage {
  session: Session | null = null;
  methods: SavedMethod[] = [];
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
    private router: Router,
    private alertCtrl: AlertController,
    private zone: NgZone
  ) {}

  ionViewWillEnter(): void {
    this.session = this.auth.getSession();
    this.refreshMethods();

    // Admin extras: staff count + current company code (from Supabase)
    if (this.session?.role === 'admin') {
      void this.auth.staffAccounts().then((staff) => {
        this.zone.run(() => (this.staffCount = staff.length));
      });
      void this.auth.refreshCompanyCode().then((code) => {
        this.zone.run(() => (this.companyCode = code || 'unavailable'));
      });
    }
    if (this.session?.role === 'staff') {
      void this.auth.refreshCompanyCode();
    }
  }

  private refreshMethods(): void {
    const email = this.session?.email ?? '';
    void this.paymentService.hydrate(email).then(() => {
      this.zone.run(() => {
        this.methods = this.paymentService.getMethods(email);
      });
    });
    this.methods = this.paymentService.getMethods(email);
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

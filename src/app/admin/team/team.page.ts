import { ChangeDetectorRef, Component, NgZone, OnInit } from '@angular/core';
import { AlertController } from '@ionic/angular/lazy';
import { ToastController } from '@ionic/angular/lazy';
import { Router } from '@angular/router';

import { AuthService, AppUser } from '../../services/auth.service';
import { runRefresh } from '../../utils/refresher';

@Component({
  selector: 'app-team',
  templateUrl: './team.page.html',
  styleUrls: ['./team.page.scss'],
  standalone: false,
})
export class TeamPage implements OnInit {
  staff: AppUser[] = [];
  adding = false;
  busy = false;

  addName = '';
  addEmail = '';

  /** Shown once after creating the account — never displayed again. */
  newCredentials: { email: string; password: string } | null = null;

  constructor(
    private auth: AuthService,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
    private router: Router,
    private zone: NgZone,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    void this.ionViewWillEnter();
  }

  async ionViewWillEnter(): Promise<void> {
    try {
      await this.auth.refreshCompanyCode();
    } catch {
      /* keep current */
    }
    await this.refresh();
    this.cdr.detectChanges();
  }

  private async refresh(): Promise<void> {
    try {
      const staff = await this.auth.staffAccounts();
      this.zone.run(() => {
        this.staff = staff;
        this.cdr.detectChanges();
      });
    } catch {
      /* keep current */
    }
  }

  /** Pull-down-to-refresh refetches the staff list + join state. */
  async doRefresh(event: Event): Promise<void> {
    await runRefresh(event, async () => {
      await Promise.all([
        this.auth.refreshCompanyCode().then(() => undefined),
        this.refresh().catch(() => undefined),
      ]);
      this.cdr.detectChanges();
    });
  }

  get companyCode(): string {
    return this.auth.getCompanyCode();
  }

  copyCode(): void {
    navigator.clipboard?.writeText(this.companyCode).catch(() => {
      /* clipboard optional — code is visible anyway */
    });
    this.toast('Company code copied.');
  }

  async regenCode(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Reset company code',
      message:
        'Staff who already joined stay in. New staff must use the new code to join.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Reset',
          handler: () => {
            void (async () => {
              await this.auth.regenerateCompanyCode();
              this.toast('New company code generated.');
            })();
          },
        },
      ],
    });
    await alert.present();
  }

  toggleAdd(): void {
    this.adding = !this.adding;
    this.addName = '';
    this.addEmail = '';
    this.newCredentials = null;
  }

  async createStaff(): Promise<void> {
    if (this.busy) {
      return;
    }
    if (!this.addName.trim() || !this.addEmail.trim()) {
      this.toast('Fill in both name and email.');
      return;
    }
    this.busy = true;
    const created = await this.auth.addStaff(this.addName, this.addEmail);
    this.busy = false;
    this.cdr.detectChanges();

    if (!created) {
      this.toast(
        'Could not create the staff account — deploy the "create-staff" function (see supabase/README.md) or use a signed-up account.'
      );
      return;
    }
    this.newCredentials = created;
    this.adding = false;
    this.addName = '';
    this.addEmail = '';
    void this.refresh();
    this.toast('Staff account created.');
  }

  async removeStaff(member: AppUser): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: 'Remove staff',
      message: `${member.name} (${member.email}) will lose access to the company.`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Remove',
          role: 'destructive',
          handler: () => {
            void (async () => {
              await this.auth.removeStaff(member.email);
              this.toast('Staff member removed.');
              void this.refresh();
            })();
          },
        },
      ],
    });
    await alert.present();
  }

  doneWithCredentials(): void {
    this.newCredentials = null;
  }

  back(): void {
    this.router.navigate(['/admin/account']);
  }

  private async toast(message: string): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration: 3000,
      position: 'top',
      color: 'dark',
    });
    await toast.present();
  }
}

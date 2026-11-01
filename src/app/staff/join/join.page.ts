import { ChangeDetectorRef, Component } from '@angular/core';
import { Router } from '@angular/router';
import { ToastController } from '@ionic/angular/lazy';

import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-join',
  templateUrl: './join.page.html',
  styleUrls: ['./join.page.scss'],
  standalone: false,
})
export class JoinPage {
  code = '';
  joining = false;

  /** Demo helper: shows the current valid code so testers can log in. */
  revealCode = false;

  constructor(
    public auth: AuthService,
    private router: Router,
    private toastCtrl: ToastController,
    private cdr: ChangeDetectorRef
  ) {}

  ionViewWillEnter(): void {
    this.code = '';
    void this.auth.refreshCompanyCode().then(() => this.cdr.detectChanges());
  }

  get joined(): boolean {
    return this.auth.isStaffJoined();
  }

  async enter(): Promise<void> {
    if (this.joining) {
      return;
    }
    if ((this.code || '').trim().length < 4) {
      this.toast('Enter the code your admin gave you.', 'dark');
      return;
    }
    this.joining = true;
    const ok = await this.auth.joinCompany(this.code);
    this.joining = false;
    this.cdr.detectChanges();

    if (ok) {
      this.toast('🎉 Company joined — welcome to the team!', 'dark');
      this.router.navigate(['/staff/dashboard'], { replaceUrl: true });
    } else {
      this.toast('That code is not valid. Ask your admin for the current one.', 'dark');
    }
  }

  onInput(event: CustomEvent): void {
    const value = (event as unknown as { detail: { value: string } }).detail?.value ?? '';
    this.code = value.toUpperCase();
  }

  onEnterKey(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      void this.enter();
    }
  }

  goDashboard(): void {
    this.router.navigate(['/staff/dashboard'], { replaceUrl: true });
  }

  async leaveCompany(): Promise<void> {
    // Demo: signing out returns to login; a joined staff can re-join later.
    this.auth.logout();
    this.router.navigate(['/login'], { replaceUrl: true });
  }

  private async toast(message: string, color: string): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2400,
      position: 'top',
      color,
      icon: 'people-circle-outline',
    });
    await toast.present();
  }
}

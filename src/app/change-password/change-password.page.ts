import { ChangeDetectorRef, Component, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { ToastController } from '@ionic/angular/lazy';

import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-change-password',
  templateUrl: './change-password.page.html',
  styleUrls: ['./change-password.page.scss'],
  standalone: false,
})
export class ChangePasswordPage {
  newPassword = '';
  confirm = '';
  saving = false;
  error = '';

  constructor(
    private auth: AuthService,
    private router: Router,
    private toastCtrl: ToastController,
    private zone: NgZone,
    private cdr: ChangeDetectorRef
  ) {}

  async save(): Promise<void> {
    this.error = '';
    if (this.newPassword.length < 8) {
      this.error = 'Password must be at least 8 characters.';
      return;
    }
    if (this.newPassword !== this.confirm) {
      this.error = 'Passwords do not match.';
      return;
    }
    this.saving = true;
    this.cdr.detectChanges();
    const ok = await this.auth.changePassword(this.newPassword);
    this.saving = false;
    if (!ok) {
      this.error = 'Could not update password. Try again.';
      this.cdr.detectChanges();
      return;
    }
    void this.toast('Password updated.');
    await this.router.navigateByUrl(this.auth.roleHome, { replaceUrl: true });
  }

  private async toast(message: string): Promise<void> {
    const t = await this.toastCtrl.create({
      message,
      duration: 2000,
      position: 'top',
      color: 'primary',
    });
    await t.present();
  }
}
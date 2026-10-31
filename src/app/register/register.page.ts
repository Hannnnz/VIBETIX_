import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { ToastController } from '@ionic/angular/lazy';

import { AuthService } from '../services/auth.service';
import { SessionDataService } from '../services/session-data.service';

@Component({
  selector: 'app-register',
  templateUrl: './register.page.html',
  styleUrls: ['./register.page.scss'],
  standalone: false,
})
export class RegisterPage {
  name = '';
  email = '';
  password = '';
  confirm = '';

  /** New: pick your account type. */
  role: 'customer' | 'staff' = 'customer';

  constructor(
    private auth: AuthService,
    private router: Router,
    private toastCtrl: ToastController,
    private data: SessionDataService
  ) {}

  async submit(): Promise<void> {
    const email = this.email.trim().toLowerCase();

    if (!this.name.trim()) {
      this.toast('Please enter your name.');
      return;
    }
    if (!email.includes('@') || !email.includes('.')) {
      this.toast('Please enter a valid email address.');
      return;
    }
    if (this.password.length < 6) {
      this.toast('Password must be at least 6 characters.');
      return;
    }
    if (this.password !== this.confirm) {
      this.toast('Passwords do not match.');
      return;
    }

    const session = await this.auth.register(this.name, email, this.password, this.role);
    if (!session) {
      this.toast(
        'Signup issue — if the account exists or needs email confirmation, check your inbox or try signing in.'
      );
      return;
    }

    if (this.role === 'staff') {
      await this.data.warm(session, 4000);
      const staffToast = await this.toastCtrl.create({
        message: `Welcome, ${session.name}! One more step: join your company.`,
        duration: 2400,
        position: 'top',
        color: 'success',
      });
      await staffToast.present();
      this.router.navigateByUrl('/staff/join', { replaceUrl: true });
      return;
    }

    const toast = await this.toastCtrl.create({
      message: `Welcome to VIBETIX, ${session.name}! 🎉`,
      duration: 2200,
      position: 'top',
      color: 'success',
    });
    await toast.present();
    await this.data.warm(session);
    this.router.navigateByUrl('/tabs/concerts', { replaceUrl: true });
  }

  private async toast(message: string): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2000,
      position: 'top',
      color: 'primary',
    });
    await toast.present();
  }
}

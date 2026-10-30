import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { ToastController } from '@ionic/angular/lazy';

import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: false,
})
export class LoginPage {
  email = '';
  password = '';

  /** Passwords are hardcoded test credentials, safe to show on the login card. */
  testAccounts = [
    { label: 'Admin', email: 'admin@gmail.com', password: 'admin123', dot: 'dot-admin' },
    { label: 'Staff', email: 'staff@gmail.com', password: 'staff123', dot: 'dot-staff' },
    { label: 'Customer', email: 'user@gmail.com', password: 'user123', dot: 'dot-customer' },
  ];

  constructor(
    private auth: AuthService,
    private router: Router,
    private toastCtrl: ToastController
  ) {}

  ionViewWillEnter(): void {
    // Already signed in? Skip the login screen straight away.
    if (this.auth.getSession()) {
      this.router.navigateByUrl(this.auth.roleHome, { replaceUrl: true });
    }
  }

  quickFill(email: string, password: string): void {
    this.email = email;
    this.password = password;
  }

  async login(): Promise<void> {
    if (!this.email.trim() || !this.password) {
      this.toast('Please enter your email and password.');
      return;
    }
    const session = this.auth.login(this.email, this.password);
    if (!session) {
      this.toast('Invalid email or password.');
      return;
    }
    const welcome =
      session.role === 'customer'
        ? `Welcome back, ${session.name}!`
        : `Signed in as ${session.role.toUpperCase()}`;
    this.toast(welcome);
    this.router.navigateByUrl(this.auth.roleHome, { replaceUrl: true });
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

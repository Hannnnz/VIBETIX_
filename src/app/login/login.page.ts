import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { ToastController } from '@ionic/angular/lazy';

import { AuthService } from '../services/auth.service';
import { SessionDataService } from '../services/session-data.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: false,
})
export class LoginPage {
  email = '';
  password = '';
  remember = false;
  signingIn = false;

  /** Passwords are hardcoded test credentials, safe to show on the login card. */
  testAccounts = [
    { label: 'Admin', email: 'admin@gmail.com', password: 'admin123', dot: 'dot-admin' },
    { label: 'Staff', email: 'staff@gmail.com', password: 'staff123', dot: 'dot-staff' },
    { label: 'Customer', email: 'user@gmail.com', password: 'user123', dot: 'dot-customer' },
  ];

  constructor(
    private auth: AuthService,
    private router: Router,
    private toastCtrl: ToastController,
    private data: SessionDataService
  ) {}

  ionViewWillEnter(): void {
    // Already signed in? Skip the login screen straight away.
    if (this.auth.getSession()) {
      this.router.navigateByUrl(this.auth.roleHome, { replaceUrl: true });
      return;
    }
    // Prefill from "Remember me" (kept for the lifetime of the app session).
    if (this.auth.rememberedEmail) {
      this.email = this.auth.rememberedEmail;
      this.remember = this.auth.rememberMe;
    }
  }

  quickFill(email: string, password: string): void {
    this.email = email;
    this.password = password;
  }

  async login(): Promise<void> {
    if (this.signingIn) {
      return;
    }
    if (!this.email.trim() || !this.password) {
      this.toast('Please enter your email and password.');
      return;
    }
    this.signingIn = true;
    try {
      this.auth.rememberMe = this.remember;
      this.auth.rememberedEmail = this.remember ? this.email.trim() : '';
      const session = await this.auth.login(this.email, this.password);
      if (!session) {
        this.toast(this.auth.lastLoginError ?? 'Invalid email or password.');
        return;
      }
      // Preload the signed-in data BEFORE navigating so the first screen
      // paints with content (no manual pull-to-refresh needed).
      await this.data.warm(session);
      const welcome =
        session.role === 'customer'
          ? `Welcome back, ${session.name}!`
          : `Signed in as ${session.role.toUpperCase()}`;
      void this.toast(welcome);
      await this.router.navigateByUrl(this.auth.roleHome, { replaceUrl: true });
    } finally {
      this.signingIn = false;
    }
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

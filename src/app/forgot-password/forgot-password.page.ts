import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { ToastController } from '@ionic/angular/lazy';

import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-forgot-password',
  templateUrl: './forgot-password.page.html',
  styleUrls: ['./forgot-password.page.scss'],
  standalone: false,
})
export class ForgotPasswordPage {
  email = '';

  constructor(
    private auth: AuthService,
    private router: Router,
    private toastCtrl: ToastController
  ) {}

  async send(): Promise<void> {
    const email = this.email.trim().toLowerCase();
    if (!email.includes('@') || !email.includes('.')) {
      this.toast('Please enter a valid email address.');
      return;
    }
    await this.toast('If that email is registered, a reset link is on its way. ✉️');
    this.auth.rememberedEmail = email;
    this.router.navigateByUrl('/login');
  }

  private async toast(message: string): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2600,
      position: 'top',
      color: 'dark',
      icon: 'mail-outline',
    });
    await toast.present();
  }
}

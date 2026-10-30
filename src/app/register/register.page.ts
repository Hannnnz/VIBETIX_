import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { ToastController } from '@ionic/angular/lazy';

import { AuthService } from '../services/auth.service';

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

  constructor(
    private auth: AuthService,
    private router: Router,
    private toastCtrl: ToastController
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

    const session = this.auth.register(this.name, email, this.password);
    if (!session) {
      this.toast('This email is already registered. Try signing in.');
      return;
    }

    const toast = await this.toastCtrl.create({
      message: `Welcome to VIBETIX, ${session.name}! 🎉`,
      duration: 2200,
      position: 'top',
      color: 'success',
    });
    await toast.present();
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

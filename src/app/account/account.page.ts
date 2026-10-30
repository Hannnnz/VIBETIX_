import { Component } from '@angular/core';
import { AlertController } from '@ionic/angular/lazy';
import { Router } from '@angular/router';

import { AuthService, Session } from '../services/auth.service';

@Component({
  selector: 'app-account',
  templateUrl: './account.page.html',
  styleUrls: ['./account.page.scss'],
  standalone: false,
})
export class AccountPage {
  session: Session | null = null;

  constructor(
    private auth: AuthService,
    private router: Router,
    private alertCtrl: AlertController
  ) {}

  ionViewWillEnter(): void {
    this.session = this.auth.getSession();
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

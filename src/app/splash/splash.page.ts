import { Component, NgZone } from '@angular/core';
import { Router } from '@angular/router';

import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-splash',
  templateUrl: './splash.page.html',
  styleUrls: ['./splash.page.scss'],
  standalone: false,
})
export class SplashPage {
  letters = ['V', 'I', 'B', 'E', 'T', 'I', 'X'];

  constructor(
    private auth: AuthService,
    private router: Router,
    private zone: NgZone
  ) {}

  ionViewWillEnter(): void {
    // Brand animation, then straight to login (or the role's home).
    this.zone.runOutsideAngular(() => {
      setTimeout(() => {
        this.zone.run(() => {
          const target = this.auth.getSession() ? this.auth.roleHome : '/login';
          this.router.navigateByUrl(target, { replaceUrl: true });
        });
      }, 2400);
    });
  }
}

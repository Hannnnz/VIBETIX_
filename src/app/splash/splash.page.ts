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

  async ionViewWillEnter(): Promise<void> {
    // Brand animation runs while the persisted Supabase session restores.
    this.zone.runOutsideAngular(() => {
      setTimeout(() => {
        this.zone.run(async () => {
          await this.auth.ensureSession();
          const target = this.auth.getSession() ? this.auth.roleHome : '/login';
          this.router.navigateByUrl(target, { replaceUrl: true });
        });
      }, 2400);
    });
  }
}

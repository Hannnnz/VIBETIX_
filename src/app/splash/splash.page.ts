import { Component, NgZone, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';

import { AuthService } from '../services/auth.service';
import { SessionDataService } from '../services/session-data.service';

/** Give the brand animation time to finish before leaving. */
const MIN_SHOW_MS = 2000;
/** Never keep the user on the splash for longer than this, even offline. */
const MAX_WAIT_MS = 5000;

@Component({
  selector: 'app-splash',
  templateUrl: './splash.page.html',
  styleUrls: ['./splash.page.scss'],
  standalone: false,
})
export class SplashPage implements OnDestroy {
  letters = ['V', 'I', 'B', 'E', 'T', 'I', 'X'];

  private timer?: ReturnType<typeof setTimeout>;
  private leaving = false;

  constructor(
    private auth: AuthService,
    private router: Router,
    private zone: NgZone,
    private data: SessionDataService
  ) {}

  ionViewWillEnter(): void {
    const startedAt = Date.now();

    // The Supabase client is already warm (APP_INITIALIZER connects it as
    // soon as the app boots). Restore the persisted session in parallel
    // with the animation, but cap the wait so a slow network never blocks.
    // Once restored, preload the signed-in data so the first screen paints
    // with content instead of an empty list.
    const restored = this.auth
      .ensureSession()
      .then(() => this.data.warm(this.auth.getSession()))
      .catch(() => undefined);
    void Promise.race([restored, this.sleep(MAX_WAIT_MS)]).then(() => {
      const remaining = Math.max(0, MIN_SHOW_MS - (Date.now() - startedAt));
      this.zone.runOutsideAngular(() => {
        this.timer = setTimeout(() => this.zone.run(() => this.leave()), remaining);
      });
    });
  }

  ionViewWillLeave(): void {
    this.clearTimer();
  }

  ionViewDidLeave(): void {
    this.clearTimer();
  }

  ngOnDestroy(): void {
    this.clearTimer();
  }

  private leave(): void {
    if (this.leaving) {
      return;
    }
    this.leaving = true;
    this.clearTimer();
    const target = this.auth.getSession() ? this.auth.roleHome : '/login';
    void this.router.navigateByUrl(target, { replaceUrl: true });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}

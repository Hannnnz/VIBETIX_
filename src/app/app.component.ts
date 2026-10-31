import { Component, OnDestroy, OnInit } from '@angular/core';
import { App as CapacitorApp } from '@capacitor/app';
import { PluginListenerHandle } from '@capacitor/core';
import { Subscription } from 'rxjs';

import { AuthService } from './services/auth.service';
import { SessionDataService } from './services/session-data.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent implements OnInit, OnDestroy {
  private authSub?: Subscription;
  private resumeHandle?: PluginListenerHandle;

  constructor(
    private auth: AuthService,
    private data: SessionDataService
  ) {}

  ngOnInit(): void {
    // Login / session restore / token refresh → preload the signed-in data.
    // Screens then paint from a warm cache instead of waiting for a manual
    // pull-to-refresh.
    this.authSub = this.auth.changes$.subscribe((session) => {
      if (session) {
        void this.data.warm(session);
      }
    });

    // Session may already have been restored by the boot initializer before
    // this component subscribed.
    const restored = this.auth.getSession();
    if (restored) {
      void this.data.warm(restored);
    }

    // Coming back from the background: refresh the profile + data too.
    void this.watchResume();
  }

  ngOnDestroy(): void {
    this.authSub?.unsubscribe();
    void this.resumeHandle?.remove();
  }

  private async watchResume(): Promise<void> {
    try {
      this.resumeHandle = await CapacitorApp.addListener(
        'appStateChange',
        ({ isActive }) => {
          if (!isActive) {
            return;
          }
          void this.auth.refreshProfile().then((session) => {
            if (session) {
              return this.data.warm(session);
            }
            return undefined;
          });
        }
      );
    } catch {
      /* web / plugin unavailable — resume sync is optional */
    }
  }
}

import { NgModule, inject, provideAppInitializer } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RouteReuseStrategy } from '@angular/router';

import { IonicModule, IonicRouteStrategy } from '@ionic/angular/lazy';

import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import { AuthService } from './services/auth.service';
import { SupabaseService } from './services/supabase.service';

@NgModule({
  declarations: [AppComponent],
  imports: [BrowserModule, IonicModule.forRoot(), AppRoutingModule],
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    // Connect to Supabase the moment the app boots: create the client and
    // restore the persisted session/profile in the background, instead of
    // waiting for the first screen to lazily instantiate it.
    provideAppInitializer(() => {
      const sb = inject(SupabaseService);
      const auth = inject(AuthService);
      void sb.client.auth.getSession();
      void auth.ensureSession();
    }),
  ],
  bootstrap: [AppComponent],
})
export class AppModule {}

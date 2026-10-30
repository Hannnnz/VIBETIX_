import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';

import { authGuard, roleGuard } from './guards/auth.guard';

const routes: Routes = [
  {
    path: 'splash',
    loadChildren: () =>
      import('./splash/splash.module').then((m) => m.SplashPageModule),
  },
  {
    path: 'login',
    loadChildren: () => import('./login/login.module').then((m) => m.LoginPageModule),
  },
  {
    path: 'forgot-password',
    loadChildren: () =>
      import('./forgot-password/forgot-password.module').then(
        (m) => m.ForgotPasswordPageModule
      ),
  },
  {
    path: 'register',
    loadChildren: () =>
      import('./register/register.module').then((m) => m.RegisterPageModule),
  },
  // Customer area (tabbed). Customer example: user@gmail.com
  {
    path: 'tabs',
    canActivate: [authGuard],
    loadChildren: () => import('./tabs/tabs.module').then((m) => m.TabsPageModule),
  },
  {
    path: 'concert/:id',
    canActivate: [authGuard],
    loadChildren: () =>
      import('./concert-detail/concert-detail.module').then(
        (m) => m.ConcertDetailPageModule
      ),
  },
  // Checkout — payment methods: GCash / card / QR / Google Play
  {
    path: 'payment',
    canActivate: [authGuard],
    loadChildren: () =>
      import('./payment/payment.module').then((m) => m.PaymentPageModule),
  },
  // Staff area with tab nav: Dashboard · Scan · Account. staff@gmail.com
  {
    path: 'staff',
    canActivate: [roleGuard(['staff', 'admin'])],
    loadChildren: () =>
      import('./staff/staff-tabs.module').then((m) => m.StaffTabsPageModule),
  },
  // Admin area with tab nav: Dashboard · Events · Bookings · Account. admin@gmail.com
  {
    path: 'admin',
    canActivate: [roleGuard(['admin'])],
    loadChildren: () =>
      import('./admin/admin-tabs.module').then((m) => m.AdminTabsPageModule),
  },
  {
    path: '',
    redirectTo: 'splash',
    pathMatch: 'full',
  },
  {
    path: '**',
    redirectTo: 'splash',
  },
];

@NgModule({
  imports: [
    RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules }),
  ],
  exports: [RouterModule],
})
export class AppRoutingModule {}

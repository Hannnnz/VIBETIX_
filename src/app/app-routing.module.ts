import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';

import { authGuard, roleGuard } from './guards/auth.guard';

const routes: Routes = [
  {
    path: 'login',
    loadChildren: () => import('./login/login.module').then((m) => m.LoginPageModule),
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
  // Staff area. Staff example: staff@gmail.com
  {
    path: 'staff',
    canActivate: [roleGuard(['staff', 'admin'])],
    loadChildren: () => import('./staff/staff.module').then((m) => m.StaffPageModule),
  },
  // Admin area. Admin example: admin@gmail.com
  {
    path: 'admin',
    canActivate: [roleGuard(['admin'])],
    loadChildren: () => import('./admin/admin.module').then((m) => m.AdminPageModule),
  },
  {
    path: 'admin/concert-form',
    canActivate: [roleGuard(['admin'])],
    loadChildren: () =>
      import('./concert-form/concert-form.module').then((m) => m.ConcertFormPageModule),
  },
  {
    path: '',
    redirectTo: 'login',
    pathMatch: 'full',
  },
  {
    path: '**',
    redirectTo: 'login',
  },
];

@NgModule({
  imports: [
    RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules }),
  ],
  exports: [RouterModule],
})
export class AppRoutingModule {}

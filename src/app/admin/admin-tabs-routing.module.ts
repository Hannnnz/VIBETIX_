import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AdminTabsPage } from './admin-tabs.page';

/**
 * The 'admin' prefix is declared in app-routing.module.ts.
 * Children: /admin/dashboard · /admin/events · /admin/bookings
 *           /admin/account · /admin/event-form
 */
const routes: Routes = [
  {
    path: '',
    component: AdminTabsPage,
    children: [
      {
        path: 'dashboard',
        loadChildren: () =>
          import('./admin-dashboard/admin-dashboard.module').then(
            (m) => m.AdminDashboardPageModule
          ),
      },
      {
        path: 'events',
        loadChildren: () =>
          import('./admin-events/admin-events.module').then(
            (m) => m.AdminEventsPageModule
          ),
      },
      {
        path: 'bookings',
        loadChildren: () =>
          import('./admin-bookings/admin-bookings.module').then(
            (m) => m.AdminBookingsPageModule
          ),
      },
      {
        path: 'account',
        loadChildren: () =>
          import('../account/account.module').then((m) => m.AccountPageModule),
      },
      {
        path: 'event-form',
        loadChildren: () =>
          import('../concert-form/concert-form.module').then(
            (m) => m.ConcertFormPageModule
          ),
      },
      {
        path: '',
        redirectTo: 'dashboard',
        pathMatch: 'full',
      },
    ],
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class AdminTabsPageRoutingModule {}

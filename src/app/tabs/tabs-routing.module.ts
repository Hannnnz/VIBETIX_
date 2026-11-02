import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { TabsPage } from './tabs.page';

/**
 * NOTE: the 'tabs' prefix is already declared in app-routing.module.ts,
 * so this module only declares what comes AFTER it.
 */
const routes: Routes = [
  {
    path: '',
    component: TabsPage,
    children: [
      {
        path: 'concerts',
        loadChildren: () =>
          import('../concerts/concerts.module').then((m) => m.ConcertsPageModule),
      },
      {
        path: 'calendar',
        loadChildren: () =>
          import('../calendar/calendar.module').then((m) => m.CalendarPageModule),
      },
      {
        path: 'my-tickets',
        loadChildren: () =>
          import('../my-tickets/my-tickets.module').then((m) => m.MyTicketsPageModule),
      },
      {
        path: 'my-reviews',
        loadChildren: () =>
          import('../my-reviews/my-reviews.module').then((m) => m.MyReviewsPageModule),
      },
      {
        path: 'account',
        loadChildren: () =>
          import('../account/account.module').then((m) => m.AccountPageModule),
      },
      {
        path: 'payment-methods',
        loadChildren: () =>
          import('../payment-methods/payment-methods.module').then(
            (m) => m.PaymentMethodsPageModule
          ),
      },
      {
        path: '',
        redirectTo: 'concerts',
        pathMatch: 'full',
      },
    ],
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class TabsPageRoutingModule {}

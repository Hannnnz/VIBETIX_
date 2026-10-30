import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { StaffTabsPage } from './staff-tabs.page';

/**
 * The 'staff' prefix is declared in app-routing.module.ts,
 * so this module declares everything AFTER it:
 *   /staff/dashboard · /staff/scan · /staff/account
 */
const routes: Routes = [
  {
    path: '',
    component: StaffTabsPage,
    children: [
      {
        path: 'dashboard',
        loadChildren: () =>
          import('../staff/staff.module').then((m) => m.StaffPageModule),
      },
      {
        path: 'scan',
        loadChildren: () =>
          import('../staff/scan/scan.module').then((m) => m.ScanPageModule),
      },
      {
        path: 'account',
        loadChildren: () =>
          import('../account/account.module').then((m) => m.AccountPageModule),
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
export class StaffTabsPageRoutingModule {}

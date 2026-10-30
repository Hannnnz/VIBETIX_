import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AdminBookingsPage } from './admin-bookings.page';

const routes: Routes = [
  {
    path: '',
    component: AdminBookingsPage,
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class AdminBookingsPageRoutingModule {}

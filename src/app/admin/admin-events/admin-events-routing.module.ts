import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AdminEventsPage } from './admin-events.page';

const routes: Routes = [
  {
    path: '',
    component: AdminEventsPage,
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class AdminEventsPageRoutingModule {}

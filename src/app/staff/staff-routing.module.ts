import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { StaffPage } from './staff.page';

const routes: Routes = [
  {
    path: '',
    component: StaffPage,
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class StaffPageRoutingModule {}

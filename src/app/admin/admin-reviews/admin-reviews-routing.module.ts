import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { AdminReviewsPage } from './admin-reviews.page';

const routes: Routes = [
  {
    path: '',
    component: AdminReviewsPage,
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class AdminReviewsPageRoutingModule {}

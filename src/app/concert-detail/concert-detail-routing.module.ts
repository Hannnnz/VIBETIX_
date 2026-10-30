import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ConcertDetailPage } from './concert-detail.page';

const routes: Routes = [
  {
    path: '',
    component: ConcertDetailPage,
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class ConcertDetailPageRoutingModule {}

import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ConcertsPage } from './concerts.page';

const routes: Routes = [
  {
    path: '',
    component: ConcertsPage,
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class ConcertsPageRoutingModule {}

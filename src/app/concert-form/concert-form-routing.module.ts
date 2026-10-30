import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ConcertFormPage } from './concert-form.page';

const routes: Routes = [
  {
    path: '',
    component: ConcertFormPage,
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class ConcertFormPageRoutingModule {}

import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular/lazy';
import { FormsModule } from '@angular/forms';
import { ConcertFormPage } from './concert-form.page';

import { ConcertFormPageRoutingModule } from './concert-form-routing.module';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    ConcertFormPageRoutingModule,
  ],
  declarations: [ConcertFormPage],
})
export class ConcertFormPageModule {}

import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular/lazy';
import { FormsModule } from '@angular/forms';
import { ConcertDetailPage } from './concert-detail.page';

import { ConcertDetailPageRoutingModule } from './concert-detail-routing.module';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    ConcertDetailPageRoutingModule,
  ],
  declarations: [ConcertDetailPage],
})
export class ConcertDetailPageModule {}

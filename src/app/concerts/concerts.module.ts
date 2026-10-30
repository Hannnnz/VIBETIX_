import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular/lazy';
import { FormsModule } from '@angular/forms';
import { ConcertsPage } from './concerts.page';

import { ConcertsPageRoutingModule } from './concerts-routing.module';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    ConcertsPageRoutingModule,
  ],
  declarations: [ConcertsPage],
})
export class ConcertsPageModule {}

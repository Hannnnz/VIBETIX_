import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular/lazy';
import { FormsModule } from '@angular/forms';
import { TicketDetailPage } from './ticket-detail.page';

import { TicketDetailPageRoutingModule } from './ticket-detail-routing.module';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    TicketDetailPageRoutingModule,
  ],
  declarations: [TicketDetailPage],
})
export class TicketDetailPageModule {}
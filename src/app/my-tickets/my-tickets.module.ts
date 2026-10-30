import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular/lazy';
import { FormsModule } from '@angular/forms';
import { MyTicketsPage } from './my-tickets.page';

import { MyTicketsPageRoutingModule } from './my-tickets-routing.module';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    MyTicketsPageRoutingModule,
  ],
  declarations: [MyTicketsPage],
})
export class MyTicketsPageModule {}

import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular/lazy';
import { FormsModule } from '@angular/forms';
import { AdminBookingsPage } from './admin-bookings.page';

import { AdminBookingsPageRoutingModule } from './admin-bookings-routing.module';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    AdminBookingsPageRoutingModule,
  ],
  declarations: [AdminBookingsPage],
})
export class AdminBookingsPageModule {}

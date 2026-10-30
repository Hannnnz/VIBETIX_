import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular/lazy';
import { FormsModule } from '@angular/forms';
import { StaffPage } from './staff.page';

import { StaffPageRoutingModule } from './staff-routing.module';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    StaffPageRoutingModule,
  ],
  declarations: [StaffPage],
})
export class StaffPageModule {}

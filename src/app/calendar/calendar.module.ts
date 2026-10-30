import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular/lazy';
import { FormsModule } from '@angular/forms';
import { CalendarPage } from './calendar.page';

import { CalendarPageRoutingModule } from './calendar-routing.module';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    CalendarPageRoutingModule,
  ],
  declarations: [CalendarPage],
})
export class CalendarPageModule {}

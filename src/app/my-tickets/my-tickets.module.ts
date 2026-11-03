import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular/lazy';
import { FormsModule } from '@angular/forms';
import { MyTicketsPage } from './my-tickets.page';
import { NotificationBellComponent } from '../components/notification-bell/notification-bell.component';
import { ReviewFormComponent } from '../components/review-form/review-form.component';

import { MyTicketsPageRoutingModule } from './my-tickets-routing.module';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    MyTicketsPageRoutingModule,
    ReviewFormComponent,
    NotificationBellComponent,
  ],
  declarations: [MyTicketsPage],
})
export class MyTicketsPageModule {}

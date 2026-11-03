import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular/lazy';
import { FormsModule } from '@angular/forms';
import { AdminEventsPage } from './admin-events.page';
import { NotificationBellComponent } from '../../components/notification-bell/notification-bell.component';

import { AdminEventsPageRoutingModule } from './admin-events-routing.module';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    AdminEventsPageRoutingModule,
    NotificationBellComponent,
  ],
  declarations: [AdminEventsPage],
})
export class AdminEventsPageModule {}

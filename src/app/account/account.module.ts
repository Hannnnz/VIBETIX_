import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular/lazy';
import { FormsModule } from '@angular/forms';
import { AccountPage } from './account.page';
import { NotificationBellComponent } from '../components/notification-bell/notification-bell.component';

import { AccountPageRoutingModule } from './account-routing.module';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    AccountPageRoutingModule,
    NotificationBellComponent,
  ],
  declarations: [AccountPage],
})
export class AccountPageModule {}

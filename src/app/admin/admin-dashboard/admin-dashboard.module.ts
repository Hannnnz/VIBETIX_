import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular/lazy';
import { FormsModule } from '@angular/forms';
import { AdminDashboardPage } from './admin-dashboard.page';

import { AdminDashboardPageRoutingModule } from './admin-dashboard-routing.module';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    AdminDashboardPageRoutingModule,
  ],
  declarations: [AdminDashboardPage],
})
export class AdminDashboardPageModule {}

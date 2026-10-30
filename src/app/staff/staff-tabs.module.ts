import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular/lazy';
import { FormsModule } from '@angular/forms';
import { StaffTabsPage } from './staff-tabs.page';

import { StaffTabsPageRoutingModule } from './staff-tabs-routing.module';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    StaffTabsPageRoutingModule,
  ],
  declarations: [StaffTabsPage],
})
export class StaffTabsPageModule {}

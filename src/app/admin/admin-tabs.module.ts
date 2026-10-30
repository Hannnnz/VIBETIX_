import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular/lazy';
import { FormsModule } from '@angular/forms';
import { AdminTabsPage } from './admin-tabs.page';

import { AdminTabsPageRoutingModule } from './admin-tabs-routing.module';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    AdminTabsPageRoutingModule,
  ],
  declarations: [AdminTabsPage],
})
export class AdminTabsPageModule {}

import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular/lazy';
import { FormsModule } from '@angular/forms';
import { ScanPage } from './scan.page';

import { ScanPageRoutingModule } from './scan-routing.module';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    ScanPageRoutingModule,
  ],
  declarations: [ScanPage],
})
export class ScanPageModule {}

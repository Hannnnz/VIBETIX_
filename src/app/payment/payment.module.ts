import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular/lazy';
import { FormsModule } from '@angular/forms';
import { PaymentPage } from './payment.page';

import { PaymentPageRoutingModule } from './payment-routing.module';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    PaymentPageRoutingModule,
  ],
  declarations: [PaymentPage],
})
export class PaymentPageModule {}

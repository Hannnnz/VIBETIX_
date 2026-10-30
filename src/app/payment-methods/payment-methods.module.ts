import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular/lazy';
import { FormsModule } from '@angular/forms';
import { PaymentMethodsPage } from './payment-methods.page';

import { PaymentMethodsPageRoutingModule } from './payment-methods-routing.module';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    PaymentMethodsPageRoutingModule,
  ],
  declarations: [PaymentMethodsPage],
})
export class PaymentMethodsPageModule {}

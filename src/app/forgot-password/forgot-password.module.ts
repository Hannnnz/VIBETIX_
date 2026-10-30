import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular/lazy';
import { FormsModule } from '@angular/forms';
import { ForgotPasswordPage } from './forgot-password.page';

import { ForgotPasswordPageRoutingModule } from './forgot-password-routing.module';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    ForgotPasswordPageRoutingModule,
  ],
  declarations: [ForgotPasswordPage],
})
export class ForgotPasswordPageModule {}

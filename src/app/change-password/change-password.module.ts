import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular/lazy';

import { ChangePasswordPage } from './change-password.page';
import { ChangePasswordPageRoutingModule } from './change-password-routing.module';

@NgModule({
  declarations: [ChangePasswordPage],
  imports: [CommonModule, FormsModule, IonicModule, ChangePasswordPageRoutingModule],
})
export class ChangePasswordPageModule {}
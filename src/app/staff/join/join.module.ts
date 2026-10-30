import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular/lazy';
import { FormsModule } from '@angular/forms';
import { JoinPage } from './join.page';

import { JoinPageRoutingModule } from './join-routing.module';

@NgModule({
  imports: [CommonModule, FormsModule, IonicModule, JoinPageRoutingModule],
  declarations: [JoinPage],
})
export class JoinPageModule {}

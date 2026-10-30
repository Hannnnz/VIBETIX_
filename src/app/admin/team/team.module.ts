import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular/lazy';
import { FormsModule } from '@angular/forms';
import { TeamPage } from './team.page';

import { TeamPageRoutingModule } from './team-routing.module';

@NgModule({
  imports: [CommonModule, FormsModule, IonicModule, TeamPageRoutingModule],
  declarations: [TeamPage],
})
export class TeamPageModule {}

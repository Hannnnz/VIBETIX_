import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular/lazy';

import { AdminReviewsPage } from './admin-reviews.page';
import { NotificationBellComponent } from '../../components/notification-bell/notification-bell.component';
import { AdminReviewsPageRoutingModule } from './admin-reviews-routing.module';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    AdminReviewsPageRoutingModule,
    NotificationBellComponent,
  ],
  declarations: [AdminReviewsPage],
})
export class AdminReviewsPageModule {}

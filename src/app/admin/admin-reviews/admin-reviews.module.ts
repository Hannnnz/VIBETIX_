import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular/lazy';

import { AdminReviewsPage } from './admin-reviews.page';
import { AdminReviewsPageRoutingModule } from './admin-reviews-routing.module';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    AdminReviewsPageRoutingModule,
  ],
  declarations: [AdminReviewsPage],
})
export class AdminReviewsPageModule {}

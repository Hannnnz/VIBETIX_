import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular/lazy';

import { ReviewFormComponent } from '../components/review-form/review-form.component';
import { MyReviewsPage } from './my-reviews.page';
import { MyReviewsPageRoutingModule } from './my-reviews-routing.module';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    MyReviewsPageRoutingModule,
    ReviewFormComponent,
  ],
  declarations: [MyReviewsPage],
})
export class MyReviewsPageModule {}

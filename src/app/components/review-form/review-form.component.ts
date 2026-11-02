import {
  Component,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnInit,
  Output,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AlertController } from '@ionic/angular/lazy';

import { Review, ReviewService } from '../../services/review.service';

/**
 * Bottom-sheet review editor used by My Tickets and My Reviews.
 * The server still enforces attendance/ownership; this only handles UX.
 */
@Component({
  selector: 'app-review-form',
  templateUrl: './review-form.component.html',
  styleUrls: ['./review-form.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule],
})
export class ReviewFormComponent implements OnInit, OnChanges {
  @Input() eventId = '';
  @Input() ticketId = '';
  @Input() review: Review | null = null;

  @Output() saved = new EventEmitter<Review>();
  @Output() deleted = new EventEmitter<string>();
  @Output() closed = new EventEmitter<void>();

  readonly stars = [1, 2, 3, 4, 5];
  readonly maxComment = 500;

  rating = 0;
  comment = '';
  saving = false;
  deleting = false;
  error = '';

  private lastReviewId = '';

  constructor(
    private reviewService: ReviewService,
    private alertCtrl: AlertController
  ) {}

  ngOnInit(): void {
    this.syncFromReview();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['review']) {
      this.syncFromReview();
    }
  }

  private syncFromReview(): void {
    const id = this.review?.id ?? '';
    if (id === this.lastReviewId) {
      return;
    }
    this.lastReviewId = id;
    this.rating = this.review?.rating ?? 0;
    this.comment = this.review?.comment ?? '';
    this.error = '';
  }

  get isEdit(): boolean {
    return !!this.review;
  }

  setRating(value: number): void {
    if (this.saving || this.deleting) {
      return;
    }
    this.rating = value;
    this.error = '';
  }

  close(): void {
    if (this.saving || this.deleting) {
      return;
    }
    this.closed.emit();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close();
  }

  async submit(): Promise<void> {
    if (this.saving || this.deleting) {
      return;
    }
    if (this.rating < 1 || this.rating > 5) {
      this.error = 'Choose a rating from 1 to 5 stars.';
      return;
    }
    if (this.comment.length > this.maxComment) {
      this.error = `Keep your comment to ${this.maxComment} characters or fewer.`;
      return;
    }
    if (!this.isEdit && (!this.eventId || !this.ticketId)) {
      this.error = 'This ticket cannot be reviewed right now.';
      return;
    }

    this.saving = true;
    this.error = '';
    try {
      const saved = this.isEdit
        ? await this.reviewService.update(
            this.review!.id,
            this.rating,
            this.comment.trim()
          )
        : await this.reviewService.create({
            eventId: this.eventId,
            ticketId: this.ticketId,
            rating: this.rating,
            comment: this.comment.trim(),
          });
      this.saved.emit(saved);
    } catch (e) {
      this.error = (e as Error)?.message ?? 'Could not save your review.';
    } finally {
      this.saving = false;
    }
  }

  async confirmDelete(): Promise<void> {
    if (!this.review || this.deleting || this.saving) {
      return;
    }
    const alert = await this.alertCtrl.create({
      header: 'Delete review',
      message: 'Delete your review? This cannot be undone.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: () => void this.deleteReview(),
        },
      ],
    });
    await alert.present();
  }

  private async deleteReview(): Promise<void> {
    if (!this.review) {
      return;
    }
    this.deleting = true;
    this.error = '';
    try {
      await this.reviewService.remove(this.review.id);
      this.deleted.emit(this.review.id);
    } catch (e) {
      this.error = (e as Error)?.message ?? 'Could not delete your review.';
    } finally {
      this.deleting = false;
    }
  }
}

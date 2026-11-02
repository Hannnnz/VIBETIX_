import { Injectable, NgZone } from '@angular/core';
import { Subject } from 'rxjs';

import { SupabaseService } from './supabase.service';

export type ReviewStatus = 'visible' | 'hidden';
export type ReviewSort = 'newest' | 'highest' | 'lowest' | 'helpful';

export interface ReviewReport {
  id: string;
  reason: string;
  createdAt: string;
  userId: string;
}

export interface Review {
  id: string;
  eventId: string;
  eventName: string;
  userId: string;
  userName: string;
  userEmail: string;
  ticketId: string;
  ticketTier: string;
  rating: number;
  comment: string;
  status: ReviewStatus;
  createdAt: string;
  updatedAt: string;
  helpfulCount: number;
  userHelpful: boolean;
  reportCount: number;
  reports: ReviewReport[];
}

export interface EventReviewSummary {
  average: number;
  total: number;
  /** Counts keyed by star (1…5). */
  counts: Record<number, number>;
  reviews: Review[];
}

export interface ReviewStats {
  averageRating: number;
  totalReviews: number;
  visibleReviews: number;
  reportedReviews: number;
  openReports: number;
}

export interface EventRating {
  average: number;
  total: number;
}

export interface CreateReviewInput {
  eventId: string;
  ticketId: string;
  rating: number;
  comment: string;
}

export interface AdminReviewFilters {
  status?: ReviewStatus | null;
  eventId?: string | null;
  rating?: number | null;
  reported?: boolean;
}

/**
 * Reviews live in Supabase. Every write/read goes through a
 * security-definer RPC so the rules (attended ticket, duplicate,
 * ownership, admin role, rate limits) are enforced by the server,
 * not by hiding buttons in the UI.
 */
@Injectable({ providedIn: 'root' })
export class ReviewService {
  /** Emits after a review/helpful/report changes (dashboard badge). */
  readonly changes$ = new Subject<void>();

  lastError = '';

  private realtimeTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private sb: SupabaseService,
    private zone: NgZone
  ) {
    this.bindRealtime();
  }

  private get client() {
    return this.sb.client;
  }

  private bindRealtime(): void {
    try {
      this.client
        .channel('vibetix-reviews')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'reviews' },
          () => this.scheduleChange()
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'review_reports' },
          () => this.scheduleChange()
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'review_helpful' },
          () => this.scheduleChange()
        )
        .subscribe();
    } catch {
      /* realtime is optional */
    }
  }

  private scheduleChange(): void {
    if (this.realtimeTimer) {
      clearTimeout(this.realtimeTimer);
    }
    this.realtimeTimer = setTimeout(() => {
      this.zone.run(() => this.changes$.next());
    }, 250);
  }

  // ── Public / customer ───────────────────────────────────────────

  async forEvent(
    eventId: string,
    sort: ReviewSort = 'newest',
    rating: number | null = null
  ): Promise<EventReviewSummary> {
    const data = await this.rpc('get_event_reviews', {
      p_event_id: eventId,
      p_sort: sort,
      p_rating: rating,
    });
    const raw = (data ?? {}) as Record<string, any>;
    const countsRaw = (raw['counts'] ?? {}) as Record<string, unknown>;
    return {
      average: Number(raw['average'] ?? 0),
      total: Number(raw['total'] ?? 0),
      counts: {
        1: Number(countsRaw['1'] ?? 0),
        2: Number(countsRaw['2'] ?? 0),
        3: Number(countsRaw['3'] ?? 0),
        4: Number(countsRaw['4'] ?? 0),
        5: Number(countsRaw['5'] ?? 0),
      },
      reviews: this.mapList(raw['reviews']),
    };
  }

  async create(input: CreateReviewInput): Promise<Review> {
    const data = await this.rpc('create_review', {
      p_event_id: input.eventId,
      p_rating: input.rating,
      p_comment: input.comment,
      p_ticket_id: input.ticketId,
    });
    const mapped = this.mapReview(data);
    this.emit();
    return mapped;
  }

  async update(reviewId: string, rating: number, comment: string): Promise<Review> {
    const data = await this.rpc('update_review', {
      p_review_id: reviewId,
      p_rating: rating,
      p_comment: comment,
    });
    const mapped = this.mapReview(data);
    this.emit();
    return mapped;
  }

  async remove(reviewId: string): Promise<void> {
    await this.rpc('delete_review', { p_review_id: reviewId });
    this.emit();
  }

  async toggleHelpful(reviewId: string): Promise<{ helpful: boolean; count: number }> {
    const data = (await this.rpc('toggle_review_helpful', {
      p_review_id: reviewId,
    })) as Record<string, any>;
    this.emit();
    return {
      helpful: Boolean(data?.['helpful']),
      count: Number(data?.['count'] ?? 0),
    };
  }

  async report(reviewId: string, reason: string): Promise<void> {
    await this.rpc('report_review', {
      p_review_id: reviewId,
      p_reason: reason,
    });
    this.emit();
  }

  async myReviews(): Promise<Review[]> {
    return this.mapList(await this.rpc('get_my_reviews'));
  }

  // ── Admin ───────────────────────────────────────────────────────

  async adminList(filters: AdminReviewFilters = {}): Promise<Review[]> {
    return this.mapList(
      await this.rpc('admin_get_reviews', {
        p_status: filters.status ?? null,
        p_event: filters.eventId ?? null,
        p_rating: filters.rating ?? null,
        p_reported: filters.reported ?? false,
      })
    );
  }

  async adminStats(): Promise<ReviewStats> {
    const data = (await this.rpc('admin_get_review_stats')) as Record<string, any>;
    return {
      averageRating: Number(data?.['average_rating'] ?? 0),
      totalReviews: Number(data?.['total_reviews'] ?? 0),
      visibleReviews: Number(data?.['visible_reviews'] ?? 0),
      reportedReviews: Number(data?.['reported_reviews'] ?? 0),
      openReports: Number(data?.['open_reports'] ?? 0),
    };
  }

  async adminReported(limit = 5): Promise<Review[]> {
    return this.mapList(
      await this.rpc('admin_get_reported_reviews', { p_limit: limit })
    );
  }

  async adminSetStatus(reviewId: string, status: ReviewStatus): Promise<void> {
    await this.rpc('admin_set_review_status', {
      p_review_id: reviewId,
      p_status: status,
    });
    this.emit();
  }

  async adminDelete(reviewId: string): Promise<void> {
    await this.rpc('admin_delete_review', { p_review_id: reviewId });
    this.emit();
  }

  async adminDismissReport(reportId: string): Promise<void> {
    await this.rpc('admin_dismiss_report', { p_report_id: reportId });
    this.emit();
  }

  async eventRatings(): Promise<Map<string, EventRating>> {
    const data = await this.rpc('get_event_ratings');
    const map = new Map<string, EventRating>();
    (Array.isArray(data) ? data : []).forEach((row: Record<string, any>) => {
      map.set(String(row['event_id']), {
        average: Number(row['average_rating'] ?? 0),
        total: Number(row['total_reviews'] ?? 0),
      });
    });
    return map;
  }

  // ── Mapping / errors ────────────────────────────────────────────

  private async rpc(name: string, args: Record<string, unknown> = {}): Promise<any> {
    this.lastError = '';
    try {
      const { data, error } = await this.client.rpc(name, args);
      if (error) {
        throw error;
      }
      return data;
    } catch (error) {
      const message = this.friendly(error);
      this.lastError = message;
      throw new Error(message);
    }
  }

  private friendly(error: unknown): string {
    const e = error as { message?: string; code?: string } | null;
    const message = String(e?.message ?? 'Something went wrong. Please try again.');
    if (e?.code === '42501' || /admin access required/i.test(message)) {
      return 'You do not have permission to do that.';
    }
    return message;
  }

  private mapList(value: unknown): Review[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.map((row) => this.mapReview(row));
  }

  private mapReview(value: unknown): Review {
    const row = (value ?? {}) as Record<string, any>;
    return {
      id: String(row['id'] ?? ''),
      eventId: String(row['event_id'] ?? ''),
      eventName: String(row['event_name'] ?? ''),
      userId: String(row['user_id'] ?? ''),
      userName: String(row['user_name'] ?? 'Customer'),
      userEmail: String(row['user_email'] ?? ''),
      ticketId: String(row['ticket_id'] ?? ''),
      ticketTier: String(row['ticket_tier'] ?? ''),
      rating: Number(row['rating'] ?? 0),
      comment: String(row['comment'] ?? ''),
      status: row['status'] === 'hidden' ? 'hidden' : 'visible',
      createdAt: String(row['created_at'] ?? ''),
      updatedAt: String(row['updated_at'] ?? row['created_at'] ?? ''),
      helpfulCount: Number(row['helpful_count'] ?? 0),
      userHelpful: Boolean(row['user_helpful']),
      reportCount: Number(row['report_count'] ?? 0),
      reports: (Array.isArray(row['reports']) ? row['reports'] : []).map(
        (report: Record<string, any>) => ({
          id: String(report['id'] ?? ''),
          reason: String(report['reason'] ?? ''),
          createdAt: String(report['created_at'] ?? ''),
          userId: String(report['user_id'] ?? ''),
        })
      ),
    };
  }

  private emit(): void {
    this.zone.run(() => this.changes$.next());
  }
}

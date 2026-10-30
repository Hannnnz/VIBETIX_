import { Component, NgZone } from '@angular/core';
import { Router } from '@angular/router';

import { Concert, ConcertService } from '../services/concert.service';
import { BookingService } from '../services/booking.service';
import { AuthService } from '../services/auth.service';
import { eventDateTime, daysUntil } from '../utils/countdown';

interface DayCell {
  date: Date;
  inMonth: boolean;
  isToday: boolean;
  hasEvents: boolean;
}

interface DayEvent {
  concert: Concert;
  bought: boolean;
  dayLabel: string;
  started: boolean;
}

@Component({
  selector: 'app-calendar',
  templateUrl: './calendar.page.html',
  styleUrls: ['./calendar.page.scss'],
  standalone: false,
})
export class CalendarPage {
  weeks: DayCell[][] = [];
  monthLabel = '';
  selected: Date | null = null;

  readonly weekdayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  constructor(
    private concertService: ConcertService,
    private bookingService: BookingService,
    private auth: AuthService,
    private router: Router,
    private zone: NgZone
  ) {}

  ionViewWillEnter(): void {
    // live calendar straight from Supabase (repaint inside the zone!)
    Promise.all([this.concertService.hydrate(), this.bookingService.hydrate()])
      .catch(() => undefined)
      .then(() => this.zone.run(() => this.rebuild()));
    this.rebuild();
  }

  /** Shifts the visible month by -1 / +1, keeping the same day selected when possible. */
  shift(delta: number): void {
    const base = this.selected ?? new Date();
    const next = new Date(base.getFullYear(), base.getMonth() + delta, 1);
    this.selected = new Date(next);
    this.rebuild();
  }

  select(cell: DayCell): void {
    this.selected = new Date(cell.date);
    this.rebuild();
  }

  rebuild(): void {
    const focus = this.selected ?? new Date();
    const y = focus.getFullYear();
    const m = focus.getMonth();

    this.monthLabel = focus.toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    });

    const cellFor = (d: Date, inMonth: boolean): DayCell => ({
      date: d,
      inMonth,
      isToday: this.sameDay(d, new Date()),
      hasEvents: this.scheduleFor(d).length > 0,
    });

    const first = new Date(y, m, 1);
    const startOffset = first.getDay(); // Sunday = 0
    const weeks: DayCell[][] = [];

    let cursor = new Date(y, m, 1 - startOffset);
    do {
      const week: DayCell[] = [];
      for (let i = 0; i < 7; i++) {
        week.push(cellFor(cursor, cursor.getMonth() === m));
        cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
      }
      weeks.push(week);
    } while (weeks.length < 6);

    this.weeks = weeks;
  }

  private sameDay(a: Date, b: Date): boolean {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  isoDate(d: Date): string {
    const pad = (n: number) => (n < 10 ? '0' + n : '' + n);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  private scheduleFor(d: Date): Concert[] {
    const iso = this.isoDate(d);
    return this.concertService.getAll().filter((c) => c.date === iso);
  }

  /** Events on the selected date + owned-ticket status + countdown. */
  eventsOnSelected(): DayEvent[] {
    if (!this.selected) {
      return [];
    }
    const email = this.auth.getSession()?.email ?? '';
    const ownedIds = new Set(
      this.bookingService.getBookingsFor(email).map((b) => b.concertId)
    );
    const now = Date.now();

    return this.scheduleFor(this.selected)
      .map((concert) => {
        const target = eventDateTime(concert);
        const diffDays = daysUntil(target, now);
        return {
          concert,
          bought: ownedIds.has(concert.id),
          dayLabel:
            diffDays === 0
              ? diffHours(target, now) > 0
                ? 'Happening today!'
                : 'Started'
              : `${diffDays} day${diffDays === 1 ? '' : 's'} before start`,
          started: target.getTime() <= now,
        };
      })
      .sort((a, b) => a.concert.date.localeCompare(b.concert.date));
  }

  open(concert: Concert): void {
    this.router.navigate(['/concert', concert.id]);
  }
}

function diffHours(target: Date, now: number): number {
  return Math.floor((target.getTime() - now) / 3600000);
}

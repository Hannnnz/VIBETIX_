/** Shared date/countdown helpers for the whole app. */

export function eventDateTime(concert: { date: string; time: string }): Date {
  return new Date(`${concert.date}T${concert.time || '00:00'}`);
}

/** DD:HH:MM:SS until the event; 00:00:00:00 once it started. */
export function countdownString(target: Date, now = Date.now()): string {
  const diff = target.getTime() - now;
  if (diff <= 0) {
    return '00:00:00:00';
  }
  const totalSec = Math.floor(diff / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const pad = (n: number) => (n < 10 ? '0' + n : '' + n);
  return `${pad(days)}:${pad(hours)}:${pad(mins)}:${pad(secs)}`;
}

/** Whole days remaining, minimum 0 — used for "19 days before start". */
export function daysUntil(target: Date, now = Date.now()): number {
  const diff = target.getTime() - now;
  if (diff <= 0) {
    return 0;
  }
  return Math.ceil(diff / 86400000);
}

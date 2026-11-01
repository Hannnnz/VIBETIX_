import { ChangeDetectorRef, Component, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { ToastController } from '@ionic/angular/lazy';

import { Concert, ConcertService } from '../services/concert.service';
import { RecommendService } from '../services/recommend.service';
import { AuthService } from '../services/auth.service';
import { runRefresh } from '../utils/refresher';
@Component({
  selector: 'app-concerts',
  templateUrl: './concerts.page.html',
  styleUrls: ['./concerts.page.scss'],
  standalone: false,
})
export class ConcertsPage {
  search = '';

  memo: { key: string; list: Concert[] } = { key: '', list: [] };

  constructor(
    private concerts: ConcertService,
    private recommend: RecommendService,
    private auth: AuthService,
    private router: Router,
    private toastCtrl: ToastController,
    private zone: NgZone,
    private cdr: ChangeDetectorRef
  ) {
    // 🔴 Realtime: a new event lands in the DB → feed repaints itself.
    this.concerts.changes$.subscribe(() =>
      this.zone.run(() => {
        this.memo = { key: '', list: [] };
        this.cdr.detectChanges();
      })
    );
  }

  async ionViewWillEnter(): Promise<void> {
    await this.auth.ensureSession().catch(() => undefined);
    // LIVE data from Supabase + personalized loves, then re-rank the feed.
    await Promise.all([
      this.concerts.hydrate(),
      this.recommend.hydrate(),
    ]).catch(() => undefined);
    this.zone.run(() => {
      this.memo = { key: '', list: [] };
      this.cdr.detectChanges();
    });
  }

  /** Pull-down-to-refresh refetches the feed + recommendations. */
  async doRefresh(event: Event): Promise<void> {
    await runRefresh(event, async () => {
      await Promise.all([this.concerts.hydrate(), this.recommend.hydrate()]);
      this.zone.run(() => {
        this.memo = { key: '', list: [] };
        this.cdr.detectChanges();
      });
    });
  }

  /**
   * Search filters the raw catalog.
   * No search → ranked feed: the user's loved ♥ bands / genres
   * consistently come first (recommendation engine).
   */
  filtered(): Concert[] {
    const term = this.search.trim().toLowerCase();
    const all = this.concerts.getAll();
    if (!term) {
      const key = 'rank:' + all.length + ':' + this.recommend.lovedCount();
      if (this.memo.key !== key) {
        this.memo = { key, list: this.recommend.rank(all) };
      }
      return this.memo.list;
    }
    return all.filter((c) =>
      [c.name, c.artist, c.genre, c.venue]
        .join(' ')
        .toLowerCase()
        .includes(term)
    );
  }

  /** Whether the feed is personalised (shown as a chip in the UI). */
  get personalized(): boolean {
    return !this.search.trim() && this.recommend.lovedCount() > 0;
  }

  dateLabel(date: string): string {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  open(concert: Concert): void {
    // 👁 counts into the recommendation engine.
    this.recommend.recordView(concert);
    this.router.navigate(['/concert', concert.id]);
  }

  async toggleLove(concert: Concert, event: Event): Promise<void> {
    event.stopPropagation();
    const loved = await this.recommend.toggleLove(concert);
    this.memo.key = ''; // force feed re-rank
    const toast = await this.toastCtrl.create({
      message: loved
        ? `♥ ${concert.artist} — we'll put their gigs first for you`
        : `Removed ${concert.artist} from your faves`,
      duration: 1800,
      position: 'top',
      color: 'dark',
    });
    await toast.present();
  }

  isLoved(concert: Concert): boolean {
    return this.recommend.isLoved(concert.id);
  }
}

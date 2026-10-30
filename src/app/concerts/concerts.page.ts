import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { ToastController } from '@ionic/angular/lazy';

import { Concert, ConcertService } from '../services/concert.service';
import { RecommendService } from '../services/recommend.service';

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
    private router: Router,
    private toastCtrl: ToastController
  ) {}

  ionViewWillEnter(): void {
    // LIVE data from Supabase + personalized loves, then re-rank the feed.
    void this.concerts.hydrate().then(() => (this.memo.key = ''));
    void this.recommend.hydrate();
    this.memo.key = '';
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
    const loved = this.recommend.toggleLove(concert);
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

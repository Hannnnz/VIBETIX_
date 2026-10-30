import { Component } from '@angular/core';
import { Router } from '@angular/router';

import { Concert, ConcertService } from '../services/concert.service';

@Component({
  selector: 'app-concerts',
  templateUrl: './concerts.page.html',
  styleUrls: ['./concerts.page.scss'],
  standalone: false,
})
export class ConcertsPage {
  search = '';

  constructor(
    private concerts: ConcertService,
    private router: Router
  ) {}

  ionViewWillEnter(): void {
    // Re-sorts / refreshes if an admin edited the list.
    this.concerts.getAll();
  }

  filtered(): Concert[] {
    const term = this.search.trim().toLowerCase();
    const all = this.concerts.getAll();
    if (!term) {
      return all;
    }
    return all.filter((c) =>
      [c.name, c.artist, c.genre, c.venue]
        .join(' ')
        .toLowerCase()
        .includes(term)
    );
  }

  dateLabel(date: string): string {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  open(concert: Concert): void {
    this.router.navigate(['/concert', concert.id]);
  }
}

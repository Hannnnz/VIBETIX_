import { Component } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { Concert, ConcertService } from '../services/concert.service';
import { AuthService } from '../services/auth.service';
import { SupabaseService } from '../services/supabase.service';
import { completeRefresher } from '../utils/refresher';

interface TicketTier {
  id?: string;
  name: string;
  price: number;
  perks: string;
}

@Component({
  selector: 'app-concert-detail',
  templateUrl: './concert-detail.page.html',
  styleUrls: ['./concert-detail.page.scss'],
  standalone: false,
})
export class ConcertDetailPage {
  concert: Concert | undefined;
  tiers: TicketTier[] = [];
  selectedTier: TicketTier | null = null;

  /** Seat map: 4 rows × 8 seats; taken seats come from the real bookings */
  rows = ['A', 'B', 'C', 'D'];
  cols = [1, 2, 3, 4, 5, 6, 7, 8];
  taken = new Set<string>();
  selected = new Set<string>();

  private maxSeats = 6;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private concertService: ConcertService,
    public auth: AuthService,
    private sb: SupabaseService
  ) {}

  ionViewWillEnter(): void {
    this.load();
  }

  /** Pull-down-to-refresh refetches the event + taken seats. */
  async doRefresh(event: Event): Promise<void> {
    await this.concertService.hydrate().catch(() => undefined);
    this.load();
    completeRefresher(event);
  }

  load(): void {
    const id = this.route.snapshot.paramMap.get('id');
    this.concert = this.concertService.getById(id || '');
    if (this.concert) {
      const perks: Record<string, string> = {
        'Gen Ad': 'Free seating section',
        'Upper Box': 'Reserved seat, elevated view',
        'Lower Box': 'Reserved seat, closer stage',
        VIP: 'Premium seated area + VIP lane',
        SVIP: 'Front zone + artist merch pack',
      };
      this.tiers = this.concertService.tiersFor(this.concert.id).map((t) => ({
        id: t.id,
        name: t.name,
        price: Math.round(this.concert!.price * t.multiplier),
        perks: perks[t.name] ?? 'Standard access',
      }));
      this.selectedTier = this.selectedTier
        ? this.tiers.find((t) => t.name === this.selectedTier!.name) ?? null
        : null;
      this.selected = new Set<string>();
      this.loadTakenSeats();
    }
  }

  /** Sold seats straight from the bookings table (always current). */
  private async loadTakenSeats(): Promise<void> {
    if (!this.concert) {
      return;
    }
    try {
      const { data, error } = await this.sb.client
        .from('seats')
        .select('seat_code')
        .eq('concert_id', this.concert.id);
      if (error) {
        return;
      }
      const codes = (data ?? []).map((s) => (s as { seat_code: string }).seat_code);
      this.taken = new Set(codes);
    } catch {
      /* offline — show all seats free */
    }
  }

  rulesList(): string[] {
    return (this.concert?.rules ?? '')
      .split('\n')
      .map((r) => r.trim())
      .filter((r) => r.length > 0);
  }

  chooseTier(tier: TicketTier): void {
    this.selectedTier = tier;
    this.selected = new Set<string>();
  }

  toggleSeat(seat: string): void {
    if (!this.selectedTier) {
      return;
    }
    if (this.taken.has(seat)) {
      return;
    }
    if (!this.selected.has(seat) && this.selected.size >= this.maxSeats) {
      // silent cap — the step-3 summary shows the count clearly
      return;
    }
    if (this.selected.has(seat)) {
      this.selected.delete(seat);
    } else {
      this.selected.add(seat);
    }
  }

  isSelected(seat: string): boolean {
    return this.selected.has(seat);
  }

  isTaken(seat: string): boolean {
    return this.taken.has(seat);
  }

  seats(): string[] {
    return [...this.selected].sort();
  }

  total(): number {
    return (this.selectedTier?.price ?? 0) * this.selected.size;
  }

  dateLabel(date: string): string {
    return new Date(date).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  /** Hands the order over to the checkout / payment page. */
  async buy(): Promise<void> {
    const session = this.auth.getSession();
    if (!session || !this.concert) {
      return;
    }
    if (!this.selectedTier || this.selected.size === 0) {
      return;
    }
    this.router.navigate(['/payment'], {
      queryParams: {
        id: this.concert.id,
        tier: this.selectedTier.name,
        tierId: this.selectedTier.id ?? '',
        price: this.selectedTier.price,
        seats: this.seats().join(','),
      },
    });
  }
}

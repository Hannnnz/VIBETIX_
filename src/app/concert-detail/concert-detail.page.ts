import { ChangeDetectorRef, Component, NgZone, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastController } from '@ionic/angular/lazy';

import { Concert, ConcertService } from '../services/concert.service';
import { AuthService } from '../services/auth.service';
import { SupabaseService } from '../services/supabase.service';
import { runRefresh } from '../utils/refresher';

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
export class ConcertDetailPage implements OnInit {
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
    private sb: SupabaseService,
    private zone: NgZone,
    private cdr: ChangeDetectorRef,
    private toastCtrl: ToastController
  ) {}

  ngOnInit(): void {
    void this.ionViewWillEnter();
  }

  async ionViewWillEnter(): Promise<void> {
    await this.load();
  }

  /** Pull-down-to-refresh refetches the event + taken seats. */
  async doRefresh(event: Event): Promise<void> {
    await runRefresh(event, () => this.load());
  }

  async load(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id') || '';
    // Hydrate + direct-fetch fallback so a created event is never reported
    // as "not found" just because the local cache was empty/stale.
    const found = await this.concertService.ensureLoaded(id);
    this.zone.run(() => {
      this.concert = found;
      this.cdr.detectChanges();
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
      }
    });
    if (this.concert) {
      await this.loadTakenSeats();
    }
    this.cdr.detectChanges();
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
      this.zone.run(() => (this.taken = new Set(codes)));
      this.cdr.detectChanges();
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
    await this.auth.ensureSession().catch(() => undefined);
    const session = this.auth.getSession();
    if (!session || !this.concert) {
      void this.toast('Please sign in again to continue checkout.', 'primary');
      return;
    }
    if (!this.selectedTier || this.selected.size === 0) {
      return;
    }

    // Re-check availability right before checkout: if someone else grabbed
    // one of these seats while this page was open, don't send the customer
    // into a failing payment — drop the seats and say so immediately.
    await this.loadTakenSeats();
    const conflict = [...this.selected].filter((seat) => this.taken.has(seat));
    if (conflict.length > 0) {
      this.selected = new Set([...this.selected].filter((seat) => !this.taken.has(seat)));
      this.cdr.detectChanges();
      void this.toast(
        `${conflict.join(', ')} just sold out — pick another seat.`,
        'warning'
      );
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

  private async toast(message: string, color = 'dark'): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2400,
      position: 'top',
      color,
    });
    await toast.present();
  }
}

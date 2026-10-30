import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastController } from '@ionic/angular/lazy';

import { Concert, ConcertService } from '../services/concert.service';
import { BookingService } from '../services/booking.service';
import { AuthService } from '../services/auth.service';

interface TicketTier {
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

  /** Seat map: 4 rows × 8 seats, some already taken */
  rows = ['A', 'B', 'C', 'D'];
  cols = [1, 2, 3, 4, 5, 6, 7, 8];
  taken = new Set<string>();
  selected = new Set<string>();

  private maxSeats = 6;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private concertService: ConcertService,
    private bookingService: BookingService,
    private auth: AuthService,
    private toastCtrl: ToastController
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    const id = this.route.snapshot.paramMap.get('id');
    this.concert = this.concertService.getById(id || '');
    if (this.concert) {
      const base = this.concert.price;
      this.tiers = [
        { name: 'Gen Ad', price: base, perks: 'Free seating section' },
        { name: 'Upper Box', price: Math.round(base * 1.25), perks: 'Reserved seat, elevated view' },
        { name: 'Lower Box', price: Math.round(base * 1.5), perks: 'Reserved seat, closer stage' },
        { name: 'VIP', price: Math.round(base * 2), perks: 'Premium seated area + VIP lane' },
        { name: 'SVIP', price: Math.round(base * 3), perks: 'Front zone + artist merch pack' },
      ];
      // pre-seed an untaken map; user picks a tier first
      this.taken = new Set<string>();
      this.selected = new Set<string>();
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
    this.taken = this.generateTakenSeats();
  }

  /** ~1/3 of seats are already sold */
  private generateTakenSeats(): Set<string> {
    const taken = new Set<string>();
    while (taken.size < 12) {
      const row = this.rows[Math.floor(Math.random() * this.rows.length)];
      const col = 1 + Math.floor(Math.random() * this.cols.length);
      taken.add(`${row}${col}`);
    }
    return taken;
  }

  toggleSeat(seat: string): void {
    if (!this.selectedTier) {
      return;
    }
    if (this.taken.has(seat)) {
      return;
    }
    if (!this.selected.has(seat) && this.selected.size >= this.maxSeats) {
      this.toast(`Up to ${this.maxSeats} seats per booking.`);
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

  async buy(): Promise<void> {
    const session = this.auth.getSession();
    if (!session || !this.concert) {
      return;
    }
    if (!this.selectedTier || this.selected.size === 0) {
      this.toast('Pick a ticket type and your seats first.');
      return;
    }
    const booking = this.bookingService.create(
      this.concert,
      this.selectedTier.name,
      this.selectedTier.price,
      this.seats(),
      session
    );
    const toast = await this.toastCtrl.create({
      message: `${booking.quantity} seat(s) booked · ${booking.ticketCode}`,
      duration: 2500,
      position: 'top',
      color: 'dark',
      icon: 'ticket-outline',
    });
    await toast.present();
    this.router.navigate(['/tabs/my-tickets']);
  }

  private async toast(message: string): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration: 1800,
      position: 'top',
      color: 'dark',
    });
    await toast.present();
  }
}

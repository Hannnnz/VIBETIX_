import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastController } from '@ionic/angular/lazy';

import { Concert, ConcertService } from '../services/concert.service';
import { BookingService } from '../services/booking.service';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-concert-detail',
  templateUrl: './concert-detail.page.html',
  styleUrls: ['./concert-detail.page.scss'],
  standalone: false,
})
export class ConcertDetailPage implements OnInit {
  concert: Concert | undefined;
  quantity = 1;

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
  }

  changeQuantity(delta: number): void {
    this.quantity = Math.min(10, Math.max(1, this.quantity + delta));
  }

  total(): number {
    return (this.concert?.price ?? 0) * this.quantity;
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
    const booking = this.bookingService.create(this.concert, this.quantity, session);
    const toast = await this.toastCtrl.create({
      message: `Tickets bought! Code: ${booking.ticketCode}`,
      duration: 2500,
      position: 'top',
      color: 'success',
      icon: 'ticket-outline',
    });
    await toast.present();
    this.router.navigate(['/tabs/my-tickets']);
  }
}

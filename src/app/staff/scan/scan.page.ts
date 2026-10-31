import { Component } from '@angular/core';
import { ToastController } from '@ionic/angular/lazy';

import { Booking, BookingService } from '../../services/booking.service';
import { Concert, ConcertService } from '../../services/concert.service';
import { runRefresh } from '../../utils/refresher';

interface ScanResult {
  state: 'success' | 'invalid' | 'already-used' | 'none';
  booking?: Booking;
}

@Component({
  selector: 'app-scan',
  templateUrl: './scan.page.html',
  styleUrls: ['./scan.page.scss'],
  standalone: false,
})
export class ScanPage {
  manualCode = '';
  /** null while the scanner is "live" */
  result: ScanResult | null = null;
  lastGoodCode: string | null = null;

  constructor(
    private bookingService: BookingService,
    private concertService: ConcertService,
    private toastCtrl: ToastController
  ) {}

  ionViewWillEnter(): void {
    // door list straight from the server
    void this.bookingService.hydrate();
  }

  /** Pull-down-to-refresh refetches the door list. */
  async doRefresh(event: Event): Promise<void> {
    await runRefresh(event, () => this.bookingService.hydrate());
  }

  concertOf(booking: Booking): Concert | undefined {
    return this.concertService.getById(booking.concertId);
  }

  dateLabel(date: string): string {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  /**
   * Point the staff camera at the customer's e-ticket code.
   * Camera/QR hardware is not wired up in this frontend demo,
   * so scanning can also be simulated from the demo button.
   */
  scanCode(input: string): void {
    const code = input.trim();
    if (!code) {
      return;
    }
    const booking = this.bookingService.findByTicketCode(code);
    if (!booking) {
      this.result = { state: 'invalid' };
      return;
    }
    this.manualCode = code;
    this.result =
      booking.status === 'active'
        ? { state: 'success', booking }
        : { state: 'already-used', booking };
  }

  /** Demo button: pretends a customer just walked up with a valid ticket. */
  simulateScan(): void {
    const active = this.bookingService.getAll().filter((b) => b.status === 'active');
    if (!active.length) {
      this.toast('No pending tickets to scan — all checked in.');
      return;
    }
    const pick = active[Math.floor(Math.random() * active.length)];
    this.scanCode(pick.ticketCode);
  }

  /** Confirms the check-in — DB-enforced one entry per ticket (RPC). */
  async confirmCheckIn(): Promise<void> {
    const booking = this.result?.booking;
    if (!booking) {
      return;
    }
    const outcome = await this.bookingService.gateCheckIn(booking.ticketCode);
    if (outcome.ok) {
      this.result = { state: 'already-used', booking };
      this.lastGoodCode = booking.ticketCode;
      this.toast(`Gate cleared:\n${outcome.message}`);
    } else if (outcome.reason === 'already-used') {
      this.result = { state: 'already-used', booking };
      this.toast(`${booking.ticketCode} was already checked in.`);
    } else {
      this.toast(outcome.reason === 'invalid' ? 'Ticket not found.' : outcome.reason);
    }
    void this.bookingService.hydrate();
  }

  /** Right-swipe result away / clear button to use the scanner again. */
  resetScan(): void {
    this.result = null;
    this.manualCode = '';
  }

  private async toast(message: string): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2600,
      position: 'top',
      color: 'dark',
      icon: 'scan-outline',
    });
    await toast.present();
  }
}

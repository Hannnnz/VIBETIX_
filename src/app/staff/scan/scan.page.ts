import { Component, ElementRef, NgZone, ViewChild } from '@angular/core';
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

  /** Camera scanner state */
  cameraActive = false;
  cameraError = '';
  private stream: MediaStream | null = null;
  private rafId: number | null = null;
  @ViewChild('scanVideo') scanVideo?: ElementRef<HTMLVideoElement>;

  constructor(
    private bookingService: BookingService,
    private concertService: ConcertService,
    private toastCtrl: ToastController,
    private zone: NgZone
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

  /** Opens the device camera and scans QR codes using BarcodeDetector when available. */
  async startCamera(): Promise<void> {
    this.cameraError = '';
    if (!navigator.mediaDevices?.getUserMedia) {
      this.cameraError = 'Camera access is not supported in this browser.';
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      this.cameraActive = true;
      // Wait for the view to render the <video> element.
      setTimeout(() => {
        const video = this.scanVideo?.nativeElement;
        if (video) {
          video.srcObject = this.stream;
          void video.play().catch(() => undefined);
        }
        this.runDetection();
      }, 0);
    } catch (e) {
      this.cameraError = (e as Error)?.message || 'Could not open the camera.';
      this.cameraActive = false;
    }
  }

  /** Stops the camera stream. */
  stopCamera(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.cameraActive = false;
  }

  private runDetection(): void {
    const BarcodeDetectorCtor = (window as any).BarcodeDetector;
    if (!BarcodeDetectorCtor) {
      this.cameraError =
        'Live QR decoding is not supported in this browser. Use manual entry below.';
      return;
    }
    const detector = new BarcodeDetectorCtor({ formats: ['qr_code'] });
    const video = this.scanVideo?.nativeElement;
    if (!video) {
      return;
    }
    const tick = async () => {
      if (!this.cameraActive || !this.stream) {
        return;
      }
      try {
        const codes = await detector.detect(video);
        if (codes && codes.length > 0) {
          const value = codes[0].rawValue;
          this.zone.run(() => {
            this.stopCamera();
            this.scanCode(value);
          });
          return;
        }
      } catch {
        /* ignore frame errors */
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  ionViewWillLeave(): void {
    this.stopCamera();
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

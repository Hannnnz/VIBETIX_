import { Component } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastController } from '@ionic/angular/lazy';

import { Concert, ConcertService } from '../services/concert.service';

@Component({
  selector: 'app-concert-form',
  templateUrl: './concert-form.page.html',
  styleUrls: ['./concert-form.page.scss'],
  standalone: false,
})
export class ConcertFormPage {
  form: Concert = {
    id: '',
    name: '',
    artist: '',
    genre: '',
    venue: '',
    date: '',
    time: '20:00',
    price: 0,
    description: '',
    emoji: '🎤',
    color: 1,
    imageUrl: '',
    rules: '',
  };

  editingId: string | null = null;
  previewBroken = false;

  constructor(
    private concertService: ConcertService,
    private route: ActivatedRoute,
    private router: Router,
    private toastCtrl: ToastController
  ) {}

  ionViewWillEnter(): void {
    // make sure the catalog is fresh before looking up the event
    void this.concertService.hydrate().then(() => this.loadFromQuery());
    this.loadFromQuery();
  }

  private loadFromQuery(): void {
    const id = this.route.snapshot.queryParamMap.get('id');
    const existing = id ? this.concertService.getById(id) : undefined;
    if (existing) {
      this.editingId = existing.id;
      this.form = { ...existing };
    } else {
      this.editingId = null;
      this.form = {
        id: '',
        name: '',
        artist: '',
        genre: '',
        venue: '',
        date: '',
        time: '20:00',
        price: 0,
        description: '',
        emoji: '🎤',
        color: 1,
        imageUrl: '',
        rules: '',
      };
    }
    this.previewBroken = false;
  }

  /** Tiny emoji fallback is still used when no image URL is provided. */
  keepEmojiFallback(): void {
    this.previewBroken = false;
  }

  get isEditing(): boolean {
    return this.editingId !== null;
  }

  async save(): Promise<void> {
    if (!this.form.name.trim() || !this.form.artist.trim()) {
      this.toast('Concert name and artist are required.');
      return;
    }
    if (!this.form.venue.trim()) {
      this.toast('Venue is required.');
      return;
    }
    if (!this.form.date) {
      this.toast('Please pick a date.');
      return;
    }
    if (!this.form.price || this.form.price <= 0) {
      this.toast('Ticket price must be greater than 0.');
      return;
    }

    const payload = {
      name: this.form.name,
      artist: this.form.artist,
      genre: this.form.genre,
      venue: this.form.venue,
      date: this.form.date,
      time: this.form.time,
      price: this.form.price,
      description: this.form.description,
      imageUrl: (this.form.imageUrl || '').trim(),
      rules: (this.form.rules || '').trim(),
      emoji: this.form.emoji,
    };

    if (this.editingId) {
      await this.concertService.update(this.editingId, payload);
      this.toast('Event updated — saved to the database.');
    } else {
      const created = await this.concertService.add(
        payload as Omit<Concert, 'id' | 'color'>
      );
      this.toast(
        created
          ? 'Event created in the database.'
          : `Could not save the event — server said: ${this.concertService.lastSaveError}`
      );
    }
    this.router.navigate(['/admin/events']);
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

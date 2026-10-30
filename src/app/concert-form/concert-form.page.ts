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
 emojiChoices = ['🎤', '🎸', '🎧', '🎷', '🎹', '🥁', '✨', '🔥', '💜', '🌆'];

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
  };

  editingId: string | null = null;

  constructor(
    private concertService: ConcertService,
    private route: ActivatedRoute,
    private router: Router,
    private toastCtrl: ToastController
  ) {}

  ionViewWillEnter(): void {
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
      };
    }
  }

  pickEmoji(emoji: string): void {
    this.form.emoji = emoji;
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
      emoji: this.form.emoji,
    };

    if (this.editingId) {
      this.concertService.update(this.editingId, payload);
      this.toast('Concert updated.');
    } else {
      this.concertService.add(payload as Omit<Concert, 'id' | 'color'>);
      this.toast('Concert created.');
    }
    this.router.navigate(['/admin']);
  }

  private async toast(message: string): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration: 1800,
      position: 'top',
      color: 'primary',
    });
    await toast.present();
  }
}

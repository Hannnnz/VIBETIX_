import { ChangeDetectorRef, Component, ElementRef, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastController } from '@ionic/angular/lazy';

import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

import { Concert, ConcertService } from '../services/concert.service';
import { AuthService } from '../services/auth.service';
import { SupabaseService } from '../services/supabase.service';

@Component({
  selector: 'app-concert-form',
  templateUrl: './concert-form.page.html',
  styleUrls: ['./concert-form.page.scss'],
  standalone: false,
})
export class ConcertFormPage {
  @ViewChild('fileInput') fileInputRef?: ElementRef<HTMLInputElement>;

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
    imagePath: '',
    rules: '',
  };

  editingId: string | null = null;
  previewBroken = false;

  // image upload state
  pendingImageBlob: Blob | null = null;
  pendingImageExt = 'jpg';
  previewObjectUrl: string | null = null;
  imageRemoved = false;
  imageError = '';
  originalImageUrl = '';
  originalImagePath = '';
  saving = false;

  constructor(
    private concertService: ConcertService,
    private auth: AuthService,
    private sb: SupabaseService,
    private route: ActivatedRoute,
    private router: Router,
    private toastCtrl: ToastController,
    private cdr: ChangeDetectorRef
  ) {}

  ionViewWillEnter(): void {
    void this.concertService.hydrate().then(() => {
      this.loadFromQuery();
      this.cdr.detectChanges();
    });
    this.loadFromQuery();
  }

  ionViewWillLeave(): void {
    if (this.previewObjectUrl) {
      URL.revokeObjectURL(this.previewObjectUrl);
      this.previewObjectUrl = null;
    }
  }

  private loadFromQuery(): void {
    const id = this.route.snapshot.queryParamMap.get('id');
    const existing = id ? this.concertService.getById(id) : undefined;
    if (existing) {
      this.editingId = existing.id;
      this.form = { ...existing, imageUrl: existing.imageUrl || '', imagePath: existing.imagePath || '' };
      this.originalImageUrl = existing.imageUrl || '';
      this.originalImagePath = existing.imagePath || '';
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
        imagePath: '',
        rules: '',
      };
      this.originalImageUrl = '';
      this.originalImagePath = '';
    }
    this.pendingImageBlob = null;
    if (this.previewObjectUrl) {
      URL.revokeObjectURL(this.previewObjectUrl);
      this.previewObjectUrl = null;
    }
    this.imageRemoved = false;
    this.imageError = '';
    this.previewBroken = false;
  }

  get isEditing(): boolean {
    return this.editingId !== null;
  }

  get previewUrl(): string {
    if (this.previewObjectUrl) {
      return this.previewObjectUrl;
    }
    if (!this.imageRemoved && this.form.imageUrl) {
      return this.form.imageUrl;
    }
    return '';
  }

  async chooseImage(): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      await this.pickFromLibrary();
    } else {
      this.fileInputRef?.nativeElement.click();
    }
  }

  private async pickFromLibrary(): Promise<void> {
    try {
      const photo = await Camera.getPhoto({
        source: CameraSource.Photos,
        resultType: CameraResultType.DataUrl,
        quality: 90,
      });
      if (!photo.dataUrl) {
        return;
      }
      const res = await fetch(photo.dataUrl);
      const blob = await res.blob();
      const type = blob.type || (photo.format ? `image/${photo.format}` : '');
      await this.handleSelectedBlob(blob, type);
    } catch {
      // user cancelled or plugin unavailable — ignore
    }
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    await this.handleSelectedBlob(file, file.type);
  }

  private async handleSelectedBlob(blob: Blob, type: string): Promise<void> {
    this.imageError = '';
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(type)) {
      this.imageError = 'Only JPEG, PNG, or WebP images are allowed.';
      this.cdr.detectChanges();
      return;
    }
    if (blob.size > 40 * 1024 * 1024) {
      this.imageError = 'Image must be 40 MB or smaller.';
      this.cdr.detectChanges();
      return;
    }
    try {
      const resized = await this.resizeImage(blob, 1600);
      if (this.previewObjectUrl) {
        URL.revokeObjectURL(this.previewObjectUrl);
      }
      this.pendingImageBlob = resized.blob;
      this.pendingImageExt = resized.ext;
      this.previewObjectUrl = URL.createObjectURL(resized.blob);
      this.imageRemoved = false;
      this.form.imageUrl = '';
      this.form.imagePath = '';
    } catch (e) {
      this.imageError = 'Could not read this image.';
      console.error('image resize failed', e);
    }
    this.cdr.detectChanges();
  }

  private async resizeImage(file: Blob, maxWidth: number): Promise<{ blob: Blob; ext: string }> {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('image load failed'));
    });
    URL.revokeObjectURL(objectUrl);

    const scale = Math.min(1, maxWidth / (img.naturalWidth || img.width || 1));
    const width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
    const height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('canvas unavailable');
    }
    ctx.drawImage(img, 0, 0, width, height);

    const mime = file.type || 'image/jpeg';
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('resize failed'))),
        mime,
        0.9
      );
    });
    const ext = (mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    return { blob, ext };
  }

  removeImage(): void {
    if (this.previewObjectUrl) {
      URL.revokeObjectURL(this.previewObjectUrl);
      this.previewObjectUrl = null;
    }
    this.pendingImageBlob = null;
    this.imageRemoved = true;
    this.form.imageUrl = '';
    this.form.imagePath = '';
    this.imageError = '';
    this.cdr.detectChanges();
  }

  async save(): Promise<void> {
    if (!this.form.name.trim() || !this.form.artist.trim()) {
      await this.toast('Concert name and artist are required.');
      return;
    }
    if (!this.form.venue.trim()) {
      await this.toast('Venue is required.');
      return;
    }
    if (!this.form.date) {
      await this.toast('Please pick a date.');
      return;
    }
    if (!this.form.price || this.form.price <= 0) {
      await this.toast('Ticket price must be greater than 0.');
      return;
    }

    this.saving = true;
    this.cdr.detectChanges();

    const userId = await this.getUserId();
    let imageUrl = (this.form.imageUrl || '').trim();
    let imagePath: string | undefined =
      (this.form.imagePath || '').trim() || undefined;

    // If a new image was chosen, upload it first.
    let uploadedPath: string | null = null;
    if (this.pendingImageBlob) {
      if (!userId) {
        this.saving = false;
        await this.toast('You must be signed in to upload an image.');
        this.cdr.detectChanges();
        return;
      }
      const path = `${userId}/${this.uuid()}.${this.pendingImageExt}`;
      const { error: upErr } = await this.sb.client.storage
        .from('event-images')
        .upload(path, this.pendingImageBlob, {
          contentType: this.pendingImageBlob.type || 'image/jpeg',
          upsert: false,
        });
      if (upErr) {
        this.saving = false;
        await this.toast(`Upload failed: ${upErr.message}`);
        this.cdr.detectChanges();
        return;
      }
      uploadedPath = path;
      const { data: pub } = this.sb.client.storage
        .from('event-images')
        .getPublicUrl(path);
      imageUrl = pub.publicUrl;
      imagePath = path;
    } else if (this.imageRemoved) {
      imageUrl = '';
      imagePath = '';
    } else {
      imageUrl = (this.originalImageUrl || '').trim();
      imagePath = (this.originalImagePath || '').trim() || undefined;
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
      imageUrl,
      imagePath,
      rules: (this.form.rules || '').trim(),
      emoji: this.form.emoji,
    };

    try {
      if (this.editingId) {
        await this.concertService.update(this.editingId, payload);
        // delete the old file when replaced or removed
        const oldPath = this.originalImagePath;
        const newPath = imagePath || '';
        if (oldPath && oldPath !== newPath) {
          try {
            await this.sb.client.storage.from('event-images').remove([oldPath]);
          } catch (e) {
            console.error('old image delete failed', e);
          }
        }
        await this.toast('Event updated — saved to the database.');
      } else {
        const created = await this.concertService.add(
          payload as Omit<Concert, 'id' | 'color'>
        );
        if (!created) {
          // roll back the uploaded file on failure
          if (uploadedPath) {
            try {
              await this.sb.client.storage.from('event-images').remove([uploadedPath]);
            } catch {
              /* ignore */
            }
          }
          await this.toast(
            `Could not save the event — server said: ${this.concertService.lastSaveError}`
          );
          this.saving = false;
          this.cdr.detectChanges();
          return;
        }
        await this.toast('Event created in the database.');
      }
      this.router.navigate(['/admin/events']);
    } finally {
      this.saving = false;
      this.cdr.detectChanges();
    }
  }

  private async getUserId(): Promise<string | null> {
    const cached = this.auth.getUserId();
    if (cached) {
      return cached;
    }
    try {
      const { data } = await this.sb.client.auth.getUser();
      return data.user?.id ?? null;
    } catch {
      return null;
    }
  }

  private uuid(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
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
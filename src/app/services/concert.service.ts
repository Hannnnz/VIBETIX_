import { Injectable } from '@angular/core';

export interface Concert {
  id: string;
  name: string;
  artist: string;
  genre: string;
  venue: string;
  /** ISO date: YYYY-MM-DD */
  date: string;
  time: string;
  price: number;
  description: string;
  emoji: string;
  /** Index of the gradient used for the cover (1..6). */
  color: number;
}

/**
 * Frontend-only demo catalog — recreated on every launch.
 */
const SEED: Concert[] = [
  {
    id: 'c1',
    name: 'Neon Nights Live',
    artist: 'The Midnight Wave',
    genre: 'Pop / Electronic',
    venue: 'MOA Arena, Pasay',
    date: '2026-11-20',
    time: '20:00',
    price: 1800,
    description:
      'An electrifying night of synth-pop and lights. The Midnight Wave takes the stage with their chart-topping Neon album, full band, lasers and all.',
    emoji: '🌆',
    color: 1,
  },
  {
    id: 'c2',
    name: 'Rock Revolution',
    artist: 'Thunderjaw',
    genre: 'Rock',
    venue: 'Araneta Coliseum, Quezon City',
    date: '2026-12-05',
    time: '19:00',
    price: 3200,
    description:
      'Heavy riffs, loud crowds. Thunderjaw returns for a one-night-only full set of their biggest hits with a surprise opening act.',
    emoji: '🎸',
    color: 2,
  },
  {
    id: 'c3',
    name: 'Acoustic Soul Session',
    artist: 'Isla Voice',
    genre: 'Acoustic',
    venue: 'Music Hall, Taguig',
    date: '2026-11-28',
    time: '18:30',
    price: 1200,
    description:
      'An intimate unplugged evening with acoustic guitars, soft lights and raw vocals. Limited seating for the ultimate chill vibe.',
    emoji: '🎤',
    color: 3,
  },
  {
    id: 'c4',
    name: 'EDM Skyropolis',
    artist: 'DJ Aux',
    genre: 'EDM',
    venue: 'World Trade Center, Pasay',
    date: '2026-12-19',
    time: '21:00',
    price: 2800,
    description:
      'A mega indoor rave with a 50-meter LED wall, confetti drops and back-to-back DJ sets until midnight. Bring the energy.',
    emoji: '🎧',
    color: 4,
  },
  {
    id: 'c5',
    name: 'K-Pop Wave Fusion',
    artist: 'Seoul Circuit',
    genre: 'K-Pop',
    venue: 'MOA Arena, Pasay',
    date: '2026-12-12',
    time: '19:00',
    price: 4500,
    description:
      'The Korean sensation Seoul Circuit headlines a fusion event featuring dance crews, hit songs and fan interactions.',
    emoji: '💜',
    color: 5,
  },
  {
    id: 'c6',
    name: 'Jazz After Dark',
    artist: 'Blue Note Trio',
    genre: 'Jazz',
    venue: 'The Vibe Lounge, Makati',
    date: '2026-12-30',
    time: '21:30',
    price: 1000,
    description:
      'Smooth saxophone, warm drinks and a classy crowd. End the year with the smoothest jazz night in the city.',
    emoji: '🎷',
    color: 6,
  },
];

/**
 * Pure in-memory concert "database" for the frontend demo.
 * Admin CRUD works, but everything resets when the app restarts.
 */
@Injectable({ providedIn: 'root' })
export class ConcertService {
  concerts: Concert[] = [...SEED];

  getAll(): Concert[] {
    return this.concerts;
  }

  getById(id: string): Concert | undefined {
    return this.concerts.find((c) => c.id === id);
  }

  add(input: Omit<Concert, 'id' | 'color'>): Concert {
    const concert: Concert = {
      ...input,
      id: 'c' + Date.now(),
      color: Math.floor(Math.random() * 6) + 1,
    };
    this.concerts = [concert, ...this.concerts];
    return concert;
  }

  update(id: string, changes: Partial<Concert>): void {
    this.concerts = this.concerts.map((c) =>
      c.id === id ? { ...c, ...changes, id: c.id, color: c.color } : c
    );
  }

  remove(id: string): void {
    this.concerts = this.concerts.filter((c) => c.id !== id);
  }
}

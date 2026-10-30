import { Injectable } from '@angular/core';

/**
 * VIBETIX roles.
 * The whole app is role-aware: admin > staff > customer.
 */
export type Role = 'admin' | 'staff' | 'customer';

export interface AppUser {
  email: string;
  password: string;
  name: string;
  role: Role;
}

export interface Session {
  email: string;
  name: string;
  role: Role;
}

/**
 * HARDCODED test users (per requirements):
 *   staff@gmail.com  | staff123  -> staff
 *   admin@gmail.com  | admin123  -> admin
 *   user@gmail.com   | user123   -> customer
 */
const USERS: AppUser[] = [
  { email: 'admin@gmail.com', password: 'admin123', name: 'Admin VIBETIX', role: 'admin' },
  { email: 'staff@gmail.com', password: 'staff123', name: 'Staff VIBETIX', role: 'staff' },
  { email: 'user@gmail.com', password: 'user123', name: 'Juan Customer', role: 'customer' },
];

/**
 * Pure frontend auth: the session lives in memory only.
 * No server, no storage — restart the app and it resets (demo mode).
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private session: Session | null = null;

  /** Returns the session when the email/password match a hardcoded user. */
  login(email: string, password: string): Session | null {
    const normalized = (email || '').trim().toLowerCase();
    const found = USERS.find(
      (u) => u.email === normalized && u.password === password
    );
    if (!found) {
      return null;
    }
    this.session = {
      email: found.email,
      name: found.name,
      role: found.role,
    };
    return this.session;
  }

  logout(): void {
    this.session = null;
  }

  getSession(): Session | null {
    return this.session;
  }

  /** Landing route right after a successful login. */
  get roleHome(): string {
    const role = this.session?.role;
    if (role === 'admin') {
      return '/admin';
    }
    if (role === 'staff') {
      return '/staff';
    }
    return '/tabs/concerts';
  }
}

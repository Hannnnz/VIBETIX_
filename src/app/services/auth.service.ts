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

/** Info stored in localStorage while a user is signed in. */
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

const SESSION_KEY = 'vibetix_session';

@Injectable({ providedIn: 'root' })
export class AuthService {
  /** Returns the session when the email/password match a hardcoded user. */
  login(email: string, password: string): Session | null {
    const normalized = (email || '').trim().toLowerCase();
    const found = USERS.find(
      (u) => u.email === normalized && u.password === password
    );
    if (!found) {
      return null;
    }
    const session: Session = {
      email: found.email,
      name: found.name,
      role: found.role,
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  logout(): void {
    localStorage.removeItem(SESSION_KEY);
  }

  getSession(): Session | null {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? (JSON.parse(raw) as Session) : null;
    } catch {
      return null;
    }
  }

  /** Landing route right after a successful login. */
  get roleHome(): string {
    const role = this.getSession()?.role;
    if (role === 'admin') {
      return '/admin';
    }
    if (role === 'staff') {
      return '/staff';
    }
    return '/tabs/concerts';
  }
}

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
  /** Staff flag: has joined the company using an admin join code. */
  joined: boolean;
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
  { email: 'admin@gmail.com', password: 'admin123', name: 'Admin VIBETIX', role: 'admin', joined: true },
  { email: 'staff@gmail.com', password: 'staff123', name: 'Staff VIBETIX', role: 'staff', joined: true },
  { email: 'user@gmail.com', password: 'user123', name: 'Juan Customer', role: 'customer', joined: true },
];

const DEFAULT_COMPANY_CODE = 'VIBETIX2026';

/**
 * Pure frontend auth: the session lives in memory only.
 * No server, no storage — restart the app and it resets (demo mode).
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private session: Session | null = null;

  /** Accounts created on the Register screen (also in-memory only). */
  private registered: AppUser[] = [];

  /** Staff accounts the admin removed (hidden from login + lists). */
  private removed: string[] = [];

  /** "Remember me" — keeps the email around while the app is open. */
  rememberedEmail = '';
  rememberMe = false;

  /** Company join code that admins hand out to staff (MS Teams-style). */
  private companyCode = DEFAULT_COMPANY_CODE;

  getCompanyCode(): string {
    return this.companyCode;
  }

  regenerateCompanyCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'VTX';
    for (let i = 0; i < 5; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    this.companyCode = code;
    return code;
  }

  private allUsers(): AppUser[] {
    return [...USERS, ...this.registered].filter(
      (u) => !this.removed.includes(u.email)
    );
  }

  private findUser(email: string): AppUser | undefined {
    const normalized = email.trim().toLowerCase();
    return this.allUsers().find((u) => u.email === normalized);
  }

  /** Returns the session when the email/password match a known user. */
  login(email: string, password: string): Session | null {
    const normalized = (email || '').trim().toLowerCase();
    const found = this.allUsers().find(
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
    if (this.rememberMe) {
      this.rememberedEmail = found.email;
    } else {
      this.rememberedEmail = '';
    }
    return this.session;
  }

  /** Frontend-only sign up: customer joins directly, staff joins via company code. */
  register(
    name: string,
    email: string,
    password: string,
    role: 'customer' | 'staff'
  ): Session | null {
    if (this.findUser(email)) {
      return null; // email already taken
    }
    const user: AppUser = {
      email: email.trim().toLowerCase(),
      password,
      name: name.trim(),
      role,
      joined: role === 'customer',
    };
    this.registered.push(user);
    this.session = { email: user.email, name: user.name, role: user.role };
    return this.session;
  }

  logout(): void {
    this.session = null;
  }

  getSession(): Session | null {
    return this.session;
  }

  /** Whether the signed-in staff member is already part of the company. */
  isStaffJoined(): boolean {
    const session = this.session;
    if (!session || session.role !== 'staff') {
      return false;
    }
    return this.findUser(session.email)?.joined === true;
  }

  /** Staff enters the code their admin gave them. */
  joinCompany(code: string): boolean {
    const session = this.session;
    if (!session || session.role !== 'staff') {
      return false;
    }
    if ((code || '').trim().toUpperCase() !== this.companyCode) {
      return false;
    }
    const user = this.findUser(session.email);
    if (user) {
      user.joined = true;
    }
    return true;
  }

  /** Staff accounts visible to the admin's team page. */
  staffAccounts(): AppUser[] {
    return this.allUsers().filter((u) => u.role === 'staff');
  }

  /** Admin onboards a staff account directly; credentials are shown once. */
  addStaff(
    name: string,
    email: string
  ): { email: string; password: string } | null {
    const normalized = email.trim().toLowerCase();
    if (!normalized.includes('@') || this.findUser(normalized)) {
      return null;
    }
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let password = 'vtx';
    for (let i = 0; i < 4; i++) {
      password += chars[Math.floor(Math.random() * chars.length)];
    }
    this.registered.push({
      email: normalized,
      password,
      name: name.trim(),
      role: 'staff',
      joined: true,
    });
    return { email: normalized, password };
  }

  /** Admin removes a staff member from the company. */
  removeStaff(email: string): void {
    const normalized = email.trim().toLowerCase();
    if (!this.removed.includes(normalized)) {
      this.removed.push(normalized);
    }
  }

  /** Landing route right after a successful login. */
  get roleHome(): string {
    const role = this.session?.role;
    if (role === 'admin') {
      return '/admin/dashboard';
    }
    if (role === 'staff') {
      return '/staff/dashboard';
    }
    return '/tabs/concerts';
  }
}

import { Injectable, NgZone } from '@angular/core';

import { SupabaseService } from './supabase.service';

/**
 * VIBETIX roles.
 * The whole app is role-aware: admin > staff > customer.
 */
export type Role = 'admin' | 'staff' | 'customer';

export interface AppUser {
  id: string;
  email: string;
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

interface ProfileRow {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  joined: boolean;
}

/**
 * REAL backend auth via Supabase:
 *  - passwords are hashed by GoTrue (never stored by VIBETIX)
 *  - the profile row (role/joined) lives in the `profiles` table
 *  - the session persists across refreshes & app restarts
 *  - a synchronous cache is kept for guards + templates
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  /** In-memory cache for sync access (guards, templates, roleHome). */
  private current: Session | null = null;
  private profile: ProfileRow | null = null;

  /** Company join code that admins hand out to staff (MS Teams-style). */
  private companyCodeValue: string | null = null;

  /** "Remember me" keeps the email pre-filled while the app is open. */
  rememberedEmail = '';
  rememberMe = false;

  constructor(
    private sb: SupabaseService,
    private zone: NgZone
  ) {}

  private get client() {
    return this.sb.client;
  }

  // ──────────────────────────────────────────────────────────────────
  // Session cache
  // ──────────────────────────────────────────────────────────────────

  getSession(): Session | null {
    return this.current;
  }

  getUserId(): string | null {
    return this.profile?.id ?? null;
  }

  private applyProfile(row: ProfileRow | null): void {
    this.profile = row;
    this.current = row
      ? { email: row.email, name: row.full_name, role: row.role }
      : null;
    if (row && this.rememberMe) {
      this.rememberedEmail = row.email;
    }
  }

  private cacheFrom(userId: string): Promise<void> {
    return this.zone.run(() => this.doCacheFrom(userId));
  }

  private async doCacheFrom(userId: string): Promise<void> {
    const { data, error } = await this.client
      .from('profiles')
      .select('id, email, full_name, role, joined')
      .eq('id', userId)
      .single();
    if (!error && data) {
      this.applyProfile(data as ProfileRow);
    }
  }

  /**
   * Restores a persisted session (app restart / page refresh).
   * Splash calls this before routing.
   */
  async hydrateSession(): Promise<void> {
    try {
      const { data } = await this.client.auth.getUser();
      if (data?.user) {
        await this.cacheFrom(data.user.id);
        // auto-load company code for admins/staff
        if (this.current) {
          void this.loadCompanyCode();
        }
      }
    } catch {
      /* not signed in — fine */
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Login / Register / Logout
  // ──────────────────────────────────────────────────────────────────

  async login(email: string, password: string): Promise<Session | null> {
    const { data, error } = await this.client.auth.signInWithPassword({
      email: (email || '').trim().toLowerCase(),
      password,
    });
    if (error || !data.user) {
      return null;
    }
    await this.cacheFrom(data.user.id);
    void this.loadCompanyCode();
    return this.current;
  }

  /**
   * Frontend sign up. The `profiles` trigger creates the row with the
   * chosen role; customers are auto-joined, staff start un-joined.
   */
  async register(
    name: string,
    email: string,
    password: string,
    role: 'customer' | 'staff'
  ): Promise<Session | null> {
    const { data, error } = await this.client.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        data: { full_name: name.trim(), role },
      },
    });
    if (error || !data.user) {
      return null;
    }
    // If "Confirm email" is ON in Supabase, there is no session yet —
    // the user must verify before first login. Sessions exist right away
    // when verification is disabled (fastest for the demo).
    if (!data.session) {
      return null;
    }
    await this.cacheFrom(data.user.id);
    void this.loadCompanyCode();
    return this.current;
  }

  /** Error message from register() — call right after a null result. */
  async lastRegisterError(): Promise<string> {
    const { data } = await this.client.auth.getUser();
    if (!data.user) {
      return 'Account created — please verify your email, then sign in.';
    }
    return 'Sign-up failed. Try again.';
  }

  async logout(): Promise<void> {
    this.rememberedEmail = this.rememberMe ? this.rememberedEmail : '';
    this.current = null;
    this.profile = null;
    this.companyCodeValue = null;
    this.client.auth.signOut();
  }

  async getSessionEmail(): Promise<string> {
    if (this.current?.email) {
      return this.current.email;
    }
    const { data } = await this.client.auth.getUser();
    return data.user?.email ?? '';
  }

  // ──────────────────────────────────────────────────────────────────
  // Staff / company (MS-Teams style join)
  // ──────────────────────────────────────────────────────────────────

  /** Whether the signed-in staff member is already part of the company. */
  isStaffJoined(): boolean {
    if (!this.profile || this.profile.role !== 'staff') {
      return false;
    }
    return this.profile.joined === true;
  }

  /** Staff enters the code their admin gave them. */
  async joinCompany(code: string): Promise<boolean> {
    const active = await this.loadCompanyCode();
    if ((code || '').trim().toUpperCase() !== (active ?? '').toUpperCase()) {
      return false;
    }
    if (!this.profile) {
      return false;
    }
    const { error } = await this.client
      .from('profiles')
      .update({ joined: true })
      .eq('id', this.profile.id);
    if (error) {
      return false;
    }
    this.profile.joined = true;
    return true;
  }

  private async loadCompanyCode(): Promise<string | null> {
    try {
      const { data, error } = await this.client
        .from('company_settings')
        .select('company_code')
        .eq('id', 1)
        .single();
      if (!error && data) {
        this.zone.run(() => (this.companyCodeValue = data.company_code));
      }
    } catch {
      /* table might not exist yet — ignore */
    }
    return this.companyCodeValue;
  }

  /** Cached code (may be null until loaded — call loadCompanyCode first). */
  getCompanyCode(): string {
    return this.companyCodeValue ?? '…';
  }

  /** Registers are async; pages should await refreshCompanyCode(). */
  async refreshCompanyCode(): Promise<string> {
    await this.loadCompanyCode();
    return this.companyCodeValue ?? '';
  }

  /** Admin: mint a brand-new join code. */
  async regenerateCompanyCode(): Promise<string> {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'VTX';
    for (let i = 0; i < 5; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    const { error } = await this.client
      .from('company_settings')
      .update({ company_code: code, updated_at: new Date().toISOString() })
      .eq('id', 1);
    if (error) {
      return this.companyCodeValue ?? '';
    }
    this.companyCodeValue = code;
    return code;
  }

  /** Staff accounts visible to the admin's team page. */
  async staffAccounts(): Promise<AppUser[]> {
    const { data: staff, error } = await this.client
      .from('profiles')
      .select('id, email, full_name, role, joined')
      .eq('role', 'staff')
      .order('created_at', { ascending: true });
    if (error || !staff) {
      return [];
    }

    // Hide blocklisted accounts (best effort — public read may be blocked
    // for non-admins, in which case they simply see everyone).
    const { data: removed } = await this.client
      .from('removed_accounts')
      .select('email');

    const removedSet = new Set((removed ?? []).map((r) => r.email));
    return (staff as ProfileRow[])
      .filter((s) => !removedSet.has(s.email))
      .map((s) => ({
        id: s.id,
        email: s.email,
        name: s.full_name,
        role: s.role,
        joined: s.joined,
      }));
  }

  /** Admin onboards a staff account via edge function; password shown once. */
  async addStaff(
    name: string,
    email: string
  ): Promise<{ email: string; password: string } | null> {
    const { data, error } = await this.client.functions.invoke('create-staff', {
      body: { name, email },
    });
    if (error || !data || (data as { error?: string }).error) {
      return null;
    }
    const payload = data as { email: string; password: string };
    return payload;
  }

  /** Non-null error text after addStaff failed — surface in the UI. */
  async addStaffError(): Promise<string> {
    const { error } = await this.client.functions.invoke('create-staff', {
      body: { name: '', email: '' },
    });
    return (error as { message?: string } | null)?.message ?? 'Edge function not deployed yet.';
  }

  /** Admin removes a staff member from the company (login blocklist). */
  async removeStaff(email: string): Promise<void> {
    await this.client
      .from('removed_accounts')
      .delete()
      .eq('email', email);
    const { error } = await this.client
      .from('removed_accounts')
      .insert({ email: (email || '').trim().toLowerCase() });
    if (error) {
      console.error('removeStaff insert failed', error);
    }
  }

  /** Landing route right after a successful login. */
  get roleHome(): string {
    const role = this.current?.role;
    if (role === 'admin') {
      return '/admin/dashboard';
    }
    if (role === 'staff') {
      return '/staff/dashboard';
    }
    return '/tabs/concerts';
  }
}

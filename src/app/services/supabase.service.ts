import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

import { environment } from '../../environments/environment';

/**
 * Single Supabase client for the whole app (auth + database + storage).
 * Only the ANON key lives here — the service_role key must NEVER be
 * bundled into the app; it belongs on the server side (edge functions).
 */
@Injectable({ providedIn: 'root' })
export class SupabaseService {
  readonly client: SupabaseClient;

  constructor() {
    this.client = createClient(
      environment.supabaseUrl,
      environment.supabaseAnonKey,
      {
        auth: {
          // "Remember me"/persistence like a real app: session survives
          // refresh & restart until the user signs out.
          persistSession: true,
          autoRefreshToken: true,
        },
      }
    );
  }
}

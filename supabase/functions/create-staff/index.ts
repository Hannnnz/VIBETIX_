import { createClient } from 'jsr:@supabase/supabase-js@2';

/**
 * VIBETIX edge function: create-staff
 * Admin-only — creates a staff auth account + profile in one call.
 * The service_role key stays server-side here; never in the app.
 *
 * Deploy:
 *   supabase functions deploy create-staff --project-ref vtocnpgguwggpgvvylzn
 *   supabase secrets set SERVICE_ROLE_KEY=<service_role key>
 */
Deno.serve(async (req: Request) => {
  // CORS for the Ionic app
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  try {
    const { name, email } = await req.json();
    if (!name || !email) {
      return json({ error: 'name and email are required' }, 400);
    }

    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) {
      return json({ error: 'You must be signed in as an admin.' }, 401);
    }
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    // Only real admins may do this.
    const {
      data: { user },
      error: userError,
    } = await admin.auth.getUser();
    if (userError || !user) {
      return json({ error: 'You must be signed in as an admin.' }, 401);
    }
    const { data: me, error: profileError } = await admin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();
    if (profileError || me?.role !== 'admin') {
      return json({ error: 'Only admins can create staff.' }, 403);
    }

    // Generate a temp password vtxXXXXXX
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let password = 'vtx';
    for (let i = 0; i < 5; i++) {
      password += chars[Math.floor(Math.random() * chars.length)];
    }

    const service = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: created, error } = await service.auth.admin.createUser({
      email: String(email).trim().toLowerCase(),
      password,
      email_confirm: true,
      user_metadata: { full_name: String(name).trim(), role: 'staff' },
    });
    if (error) {
      const msg = error.message ?? '';
      if (/already.*registered|already exists|duplicate/i.test(msg)) {
        return json({ error: 'That email is already registered.' }, 409);
      }
      return json({ error: msg || 'Could not create the staff account.' }, 400);
    }

    // Guarantee profile row exists with role=staff & joined (trigger usually did it)
    await service
      .from('profiles')
      .upsert({
        id: created.user.id,
        email: created.user.email,
        full_name: String(name).trim(),
        role: 'staff',
        joined: true,
        must_change_password: true,
      });

    return json({ email: created.user.email, password });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    },
  });
}

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
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    // Only real admins may do this.
    const { data: me } = await admin
      .from('profiles')
      .select('role')
      .eq('id', (await admin.auth.getUser()).data.user?.id ?? '')
      .single();
    if (me?.role !== 'admin') {
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
      return json({ error: error.message }, 400);
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

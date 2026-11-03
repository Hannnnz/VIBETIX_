import { createClient } from 'jsr:@supabase/supabase-js@2';

/**
 * VIBETIX edge function: reset-staff-password
 * Admin-only — generates a new temporary password for a staff member.
 *
 * Deploy:
 *   supabase functions deploy reset-staff-password --project-ref vtocnpgguwggpgvvylzn
 *   supabase secrets set SERVICE_ROLE_KEY=<service_role key>
 */
const SAFE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function generatePassword(length = 12): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += SAFE_CHARS[bytes[i] % SAFE_CHARS.length];
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  try {
    const { staff_id } = await req.json();
    if (!staff_id) {
      return json({ error: 'staff_id is required' }, 400);
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

    const {
      data: { user },
      error: userError,
    } = await admin.auth.getUser();
    if (userError || !user) {
      return json({ error: 'You must be signed in as an admin.' }, 401);
    }

    const { data: me } = await admin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();
    if (me?.role !== 'admin') {
      return json({ error: 'Only admins can reset passwords.' }, 403);
    }

    const service = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Verify the target is a staff member.
    const { data: staff, error: staffError } = await service
      .from('profiles')
      .select('id, email, role')
      .eq('id', staff_id)
      .single();
    if (staffError || !staff || staff.role !== 'staff') {
      return json({ error: 'Staff member not found.' }, 404);
    }

    // Rate limit: max 5 resets per admin per minute.
    const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
    const { count } = await service
      .from('password_reset_audit')
      .select('id', { count: 'exact', head: true })
      .eq('admin_id', user.id)
      .gte('created_at', oneMinuteAgo);
    if ((count ?? 0) >= 5) {
      return json({ error: 'Too many resets. Please wait a minute.' }, 429);
    }

    const password = generatePassword(12);

    const { error: updateError } = await service.auth.admin.updateUserById(
      staff_id,
      { password }
    );
    if (updateError) {
      return json({ error: updateError.message || 'Could not reset password.' }, 400);
    }

    // Best-effort sign-out of existing sessions (admin API requires a JWT;
    // if unavailable we still force a change via must_change_password).
    try {
      // No-op placeholder: the flag below blocks further use until changed.
    } catch {
      /* ignore */
    }

    await service
      .from('profiles')
      .update({ must_change_password: true })
      .eq('id', staff_id);

    // Audit log (no password).
    await service.from('password_reset_audit').insert({
      admin_id: user.id,
      staff_id,
    });

    return json({ email: staff.email, password });
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
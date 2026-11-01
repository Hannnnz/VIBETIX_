import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  try {
    const payload = await req.json();
    const {
      type,
      to,
      name,
      ticketCode,
      concertName,
      concertDate,
      venue,
      tier,
      seats,
      total,
    } = payload ?? {};

    if (!type || !to || !ticketCode || !concertName) {
      return json({ error: 'type, to, ticketCode and concertName are required' }, 400);
    }
    if (type !== 'purchase' && type !== 'attendance') {
      return json({ error: 'type must be "purchase" or "attendance"' }, 400);
    }

    const authHeader = req.headers.get('Authorization') ?? '';
    const anon = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: userData } = await anon.auth.getUser();
    if (!userData?.user) {
      return json({ error: 'Not authenticated.' }, 401);
    }

    const service = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Duplicate prevention: one email per (ticket, type).
    const { data: existing } = await service
      .from('email_logs')
      .select('id, status')
      .eq('ticket_code', ticketCode)
      .eq('email_type', type)
      .maybeSingle();

    if (existing) {
      return json({ sent: false, reason: 'already_sent', status: existing.status }, 200);
    }

    // Record a pending row first (atomic-ish guard against concurrent scans).
    const { error: insertErr } = await service.from('email_logs').insert({
      recipient: to,
      email_type: type,
      ticket_code: ticketCode,
      status: 'pending',
    });
    if (insertErr) {
      // Unique violation => already sent by a concurrent request.
      if (/duplicate|unique/i.test(insertErr.message ?? '')) {
        return json({ sent: false, reason: 'already_sent', status: 'pending' }, 200);
      }
      return json({ error: insertErr.message }, 500);
    }

    const apiKey = Deno.env.get('RESEND_API_KEY');
    if (!apiKey) {
      await service
        .from('email_logs')
        .update({ status: 'failed', error: 'RESEND_API_KEY not configured' })
        .eq('ticket_code', ticketCode)
        .eq('email_type', type);
      return json({ sent: false, reason: 'missing_api_key' }, 500);
    }

    const subject =
      type === 'purchase'
        ? `Your VIBETIX ticket: ${concertName}`
        : `Thank You for Attending ${concertName}!`;

    const qrUrl =
      'https://api.qrserver.com/v1/create-qr-code/?size=220x220&bgcolor=FFFFFF&data=' +
      encodeURIComponent(ticketCode);

    const html =
      type === 'purchase'
        ? purchaseTemplate({ name, concertName, concertDate, venue, tier, seats, ticketCode, total, qrUrl })
        : attendanceTemplate({ name, concertName, ticketCode });

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'VIBETIX <onboarding@resend.dev>',
        to: [to],
        subject,
        html,
      }),
    });

    const resendData = await resendRes.json().catch(() => ({}));
    if (!resendRes.ok) {
      const errMsg = (resendData as { message?: string })?.message ?? `Resend HTTP ${resendRes.status}`;
      await service
        .from('email_logs')
        .update({ status: 'failed', error: errMsg })
        .eq('ticket_code', ticketCode)
        .eq('email_type', type);
      return json({ sent: false, reason: errMsg }, 500);
    }

    await service
      .from('email_logs')
      .update({ status: 'sent', provider_id: (resendData as { id?: string })?.id ?? null })
      .eq('ticket_code', ticketCode)
      .eq('email_type', type);

    return json({ sent: true, id: (resendData as { id?: string })?.id ?? null }, 200);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function purchaseTemplate(d: {
  name: string;
  concertName: string;
  concertDate?: string;
  venue?: string;
  tier?: string;
  seats?: string[];
  ticketCode: string;
  total?: number;
  qrUrl: string;
}): string {
  const seats = (d.seats ?? []).join(', ');
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,sans-serif;color:#fff;">
  <div style="max-width:560px;margin:0 auto;padding:24px;">
    <h1 style="color:#e50914;margin:0 0 8px;">VIBETIX</h1>
    <p style="color:#9a9a9a;margin:0 0 20px;">Ticket confirmation</p>
    <p>Hi ${esc(d.name || 'there')},</p>
    <p>Your payment is confirmed. Here are your ticket details:</p>
    <div style="background:#1a1a1a;border:1px solid #333;border-radius:12px;padding:16px;margin:16px 0;">
      <p style="margin:4px 0;"><strong>Event:</strong> ${esc(d.concertName)}</p>
      ${d.concertDate ? `<p style="margin:4px 0;"><strong>Date:</strong> ${esc(d.concertDate)}</p>` : ''}
      ${d.venue ? `<p style="margin:4px 0;"><strong>Venue:</strong> ${esc(d.venue)}</p>` : ''}
      ${d.tier ? `<p style="margin:4px 0;"><strong>Ticket:</strong> ${esc(d.tier)}</p>` : ''}
      ${seats ? `<p style="margin:4px 0;"><strong>Seats:</strong> ${esc(seats)}</p>` : ''}
      <p style="margin:4px 0;"><strong>Ticket code:</strong> ${esc(d.ticketCode)}</p>
      ${d.total != null ? `<p style="margin:4px 0;"><strong>Total paid:</strong> ₱${Number(d.total).toFixed(2)}</p>` : ''}
    </div>
    <p style="text-align:center;margin:16px 0;">
      <img src="${d.qrUrl}" alt="Ticket QR" width="220" height="220" style="border-radius:8px;background:#fff;padding:8px;" />
    </p>
    <p style="color:#9a9a9a;font-size:12px;">Show this QR code at the gate for entry. Keep this email for your records.</p>
  </div>
</body></html>`;
}

function attendanceTemplate(d: { name: string; concertName: string; ticketCode: string }): string {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,sans-serif;color:#fff;">
  <div style="max-width:560px;margin:0 auto;padding:24px;">
    <h1 style="color:#e50914;margin:0 0 8px;">VIBETIX</h1>
    <p style="color:#9a9a9a;margin:0 0 20px;">Attendance confirmed</p>
    <p>Hi ${esc(d.name || 'there')},</p>
    <p>Thank you for attending <strong>${esc(d.concertName)}</strong>! Your ticket <strong>${esc(d.ticketCode)}</strong> has been marked as used.</p>
    <p>We hope you enjoyed the show. See you at the next one!</p>
    <p style="color:#9a9a9a;font-size:12px;margin-top:24px;">— The VIBETIX team</p>
  </div>
</body></html>`;
}
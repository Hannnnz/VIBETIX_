import { createClient } from 'jsr:@supabase/supabase-js@2';

/**
 * VIBETIX Edge Function: send-push
 *
 * Triggered by a Supabase Database Webhook on INSERT into public.notifications.
 * Reads the user's FCM tokens and sends the notification through the FCM
 * HTTP v1 API. The Firebase service account lives in Supabase secrets only.
 *
 * Required secrets:
 *   FIREBASE_SERVICE_ACCOUNT   the service-account JSON (string)
 *   WEBHOOK_SECRET             shared secret for the database webhook
 *   (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected by Supabase)
 *
 * Deploy without a user JWT (the webhook is server-to-server):
 *   supabase functions deploy send-push --no-verify-jwt
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-webhook-secret',
};

interface NotificationRecord {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
}

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

let cached: TokenCache = { token: '', expiresAt: 0 };

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  try {
    const expectedSecret = Deno.env.get('WEBHOOK_SECRET') ?? '';
    if (expectedSecret) {
      const supplied =
        req.headers.get('x-webhook-secret') ??
        (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
      if (supplied !== expectedSecret) {
        return json({ error: 'Invalid webhook secret.' }, 401);
      }
    }

    const payload = await req.json();
    const record: NotificationRecord = payload?.record ?? payload;
    if (!record?.user_id || !record?.id) {
      return json({ error: 'Missing notification record.' }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: tokens, error } = await supabase
      .from('device_tokens')
      .select('id, token')
      .eq('user_id', record.user_id);

    if (error) {
      return json({ error: error.message }, 500);
    }
    if (!tokens || tokens.length === 0) {
      return json({ sent: 0, removed: 0, reason: 'no device tokens' });
    }

    const account = serviceAccount();
    const accessToken = await fcmAccessToken(account);
    const data = stringifyData(record);

    let sent = 0;
    let removed = 0;
    const failures: string[] = [];

    for (const row of tokens as { id: string; token: string }[]) {
      const result = await sendToToken(
        accessToken,
        account.project_id,
        row.token,
        record,
        data
      );
      if (result.ok) {
        sent++;
      } else if (result.invalid) {
        // FCM says this token is dead → drop it.
        await supabase.from('device_tokens').delete().eq('id', row.id);
        removed++;
      } else {
        failures.push(result.message);
      }
    }

    return json({ sent, removed, failed: failures.length, failures });
  } catch (error) {
    return json({ error: (error as Error)?.message ?? 'Unknown error' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function serviceAccount(): ServiceAccount {
  const raw = Deno.env.get('FIREBASE_SERVICE_ACCOUNT') ?? '';
  if (raw) {
    const parsed = JSON.parse(raw) as ServiceAccount;
    if (parsed.project_id && parsed.client_email && parsed.private_key) {
      return parsed;
    }
    throw new Error('FIREBASE_SERVICE_ACCOUNT is missing required fields.');
  }

  const project_id = Deno.env.get('FIREBASE_PROJECT_ID') ?? '';
  const client_email = Deno.env.get('FIREBASE_CLIENT_EMAIL') ?? '';
  const private_key = (Deno.env.get('FIREBASE_PRIVATE_KEY') ?? '').replace(
    /\\n/g,
    '\n'
  );
  if (!project_id || !client_email || !private_key) {
    throw new Error(
      'Set FIREBASE_SERVICE_ACCOUNT (or FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY).'
    );
  }
  return { project_id, client_email, private_key };
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToBytes(pem: string): Uint8Array {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function fcmAccessToken(account: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached.token && cached.expiresAt > now + 60) {
    return cached.token;
  }

  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const encoder = new TextEncoder();
  const unsigned =
    base64Url(encoder.encode(JSON.stringify(header))) +
    '.' +
    base64Url(encoder.encode(JSON.stringify(claims)));

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToBytes(account.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    encoder.encode(unsigned)
  );
  const assertion = `${unsigned}.${base64Url(new Uint8Array(signature))}`;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:
      'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' +
      encodeURIComponent(assertion),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    throw new Error(
      'FCM OAuth failed: ' + (body.error_description ?? body.error ?? response.status)
    );
  }

  cached = {
    token: body.access_token as string,
    expiresAt: now + Number(body.expires_in ?? 3600),
  };
  return cached.token;
}

function stringifyData(record: NotificationRecord): Record<string, string> {
  const source = (record.data ?? {}) as Record<string, unknown>;
  const out: Record<string, string> = {
    notification_id: record.id,
    type: record.type,
  };
  for (const key of [
    'screen',
    'event_id',
    'ticket_id',
    'booking_id',
    'ticket_code',
    'action',
  ]) {
    if (source[key] !== undefined && source[key] !== null) {
      out[key] = String(source[key]);
    }
  }
  return out;
}

async function sendToToken(
  accessToken: string,
  projectId: string,
  token: string,
  record: NotificationRecord,
  data: Record<string, string>
): Promise<{ ok: true } | { ok: false; invalid: boolean; message: string }> {
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: record.title, body: record.body },
          data,
          android: {
            priority: 'high',
            notification: {
              channel_id: 'default',
              sound: 'default',
            },
          },
        },
      }),
    }
  );

  if (response.ok) {
    return { ok: true };
  }

  const body = await response.json().catch(() => ({}));
  const status = body?.error?.status ?? '';
  const errorCode =
    body?.error?.details?.find?.(
      (detail: { errorCode?: string }) => detail?.errorCode
    )?.errorCode ?? '';
  const invalid =
    response.status === 404 ||
    status === 'NOT_FOUND' ||
    errorCode === 'UNREGISTERED' ||
    errorCode === 'SENDER_ID_MISMATCH';

  return {
    ok: false,
    invalid,
    message: `${response.status} ${status || response.statusText} ${errorCode}`.trim(),
  };
}

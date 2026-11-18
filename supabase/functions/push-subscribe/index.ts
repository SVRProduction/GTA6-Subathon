// push-subscribe: רישום טלפון להתראות (סטורי חדש, משימה נגמרה).
// ‎GET  → { key } המפתח הציבורי (VAPID_PUBLIC_KEY), או { key: null } אם ההתראות עוד לא הוגדרו
// ‎POST { subscription: PushSubscriptionJSON }      → נרשם
// ‎POST { unsubscribe: endpoint }                   → מבטל
// לא דורש התחברות עם Kick. סודות: VAPID_PUBLIC_KEY. פריסה: supabase functions deploy push-subscribe --no-verify-jwt
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const key = Deno.env.get('VAPID_PUBLIC_KEY') ?? null;
  if (req.method === 'GET') return json({ key });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  if (!key) return json({ error: 'ההתראות עוד לא הוגדרו' }, 503);

  let input: { subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }; unsubscribe?: string };
  try {
    input = await req.json();
  } catch {
    return json({ error: 'בקשה לא תקינה' }, 400);
  }
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  if (input.unsubscribe) {
    await sb.from('push_subs').delete().eq('endpoint', String(input.unsubscribe).slice(0, 800));
    return json({ ok: true });
  }
  const s = input.subscription;
  const endpoint = String(s?.endpoint ?? '');
  const p256dh = String(s?.keys?.p256dh ?? '');
  const auth = String(s?.keys?.auth ?? '');
  // רק כתובות https של שירותי ההתראות של הדפדפנים
  if (!/^https:\/\/[^\s/]+\/\S+$/.test(endpoint) || endpoint.length > 800 || !/^[\w-]{40,120}$/.test(p256dh) || !/^[\w-]{10,40}$/.test(auth)) {
    return json({ error: 'הרשמה לא תקינה' }, 400);
  }
  const { error } = await sb.from('push_subs').upsert({ endpoint, p256dh, auth });
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
});

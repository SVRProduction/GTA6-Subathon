// kick-webhook: Kick שולח לכאן כל הודעת צ'אט (chat.message.sent).
// פקודות שסופרות (רק אתה או מודרטור):  !death / !מוות  ·  !cat / !חתול  ·  עם "-" בסוף = ביטול (‎!death-)
// הפונקציה צריכה לרוץ בלי בדיקת JWT של Supabase: supabase functions deploy kick-webhook --no-verify-jwt
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const COMMANDS: Record<string, 'deaths' | 'cats'> = { death: 'deaths', 'מוות': 'deaths', 'מת': 'deaths', cat: 'cats', 'חתול': 'cats' };

let keyCache: { key: CryptoKey; at: number } | null = null;
/** המפתח הציבורי של Kick (לא שומרים קבוע בקוד: Kick יכולים להחליף אותו) */
async function kickKey(force = false) {
  if (keyCache && !force && Date.now() - keyCache.at < 3600_000) return keyCache.key;
  const r = await fetch('https://api.kick.com/public/v1/public-key');
  const j = await r.json();
  const pem: string = j?.data?.public_key ?? j?.public_key ?? '';
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('spki', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  keyCache = { key, at: Date.now() };
  return key;
}

async function verify(id: string, ts: string, body: string, sig: string) {
  const data = new TextEncoder().encode(`${id}.${ts}.${body}`);
  const s = Uint8Array.from(atob(sig), (c) => c.charCodeAt(0));
  if (await crypto.subtle.verify('RSASSA-PKCS1-v1_5', await kickKey(), s, data)) return true;
  // אולי המפתח הוחלף: מנסים פעם אחת עם מפתח טרי
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', await kickKey(true), s, data);
}

/** "!death" → {counter, delta}; לא פקודה → null */
export function parse(content: string) {
  const m = content.trim().match(/^!\s*([a-zA-Z֐-׿]+)\s*([+-]?)/);
  if (!m) return null;
  const counter = COMMANDS[m[1].toLowerCase()];
  return counter ? { counter, delta: m[2] === '-' ? -1 : 1 } : null;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok');
  const body = await req.text();
  const id = req.headers.get('Kick-Event-Message-Id') ?? '';
  const ts = req.headers.get('Kick-Event-Message-Timestamp') ?? '';
  const sig = req.headers.get('Kick-Event-Signature') ?? '';
  const type = req.headers.get('Kick-Event-Type') ?? '';
  try {
    if (!id || !sig || !(await verify(id, ts, body, sig))) return new Response('bad signature', { status: 401 });
  } catch {
    return new Response('bad signature', { status: 401 });
  }
  if (type !== 'chat.message.sent') return new Response('ignored');

  const ev = JSON.parse(body);
  const cmd = parse(String(ev.content ?? ''));
  if (!cmd) return new Response('ignored');
  const badges: Array<{ type?: string }> = ev.sender?.identity?.badges ?? [];
  const isOwner = ev.sender?.user_id != null && ev.sender.user_id === ev.broadcaster?.user_id;
  const isMod = badges.some((b) => b.type === 'moderator' || b.type === 'broadcaster');
  if (!isOwner && !isMod) return new Response('not allowed');

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  // העצירה הנוכחית (כדי לספור לפי משימה)
  const { data: s } = await sb.from('settings').select('current_mission_id').eq('id', 1).maybeSingle();
  let mission = s?.current_mission_id ?? null;
  if (!mission) {
    const { data: m } = await sb.from('missions').select('id').order('order_index', { ascending: false }).limit(1).maybeSingle();
    mission = m?.id ?? null;
  }
  // source_id ייחודי: אותה הודעה שנשלחה פעמיים (Kick מנסה שוב) נספרת פעם אחת
  const { error } = await sb.from('counter_events').insert({
    counter: cmd.counter,
    delta: cmd.delta,
    mission_id: mission,
    source: 'chat',
    source_id: String(ev.message_id ?? id),
  });
  if (error && !/duplicate key/.test(error.message)) return new Response(error.message, { status: 500 });
  return new Response('counted');
});

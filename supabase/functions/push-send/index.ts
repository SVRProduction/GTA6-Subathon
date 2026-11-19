// push-send: שולח התראה לכל הטלפונים הרשומים. נקרא מהטריגרים במסד הנתונים (update-replies-push.sql).
// ‎POST { kind: 'mission' | 'publish' | 'story' | 'test', id? }   (mission = הושלמה, publish = טיוטה שפורסמה)  עם הכותרת x-cron-secret
// סודות: CRON_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY. פריסה: supabase functions deploy push-send --no-verify-jwt
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';

const SITE = 'https://svrproduction.github.io/GTA6-Subathon/';
const fail = (error: string, status = 400) => Response.json({ error }, { status });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return fail('method', 405);
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return fail('unauthorized', 401);
  const pub = Deno.env.get('VAPID_PUBLIC_KEY');
  const priv = Deno.env.get('VAPID_PRIVATE_KEY');
  if (!pub || !priv) return fail('VAPID keys are not set', 503);
  webpush.setVapidDetails(SITE, pub, priv);

  let input: { kind?: string; id?: string };
  try {
    input = await req.json();
  } catch {
    return fail('bad json');
  }
  const kind = String(input.kind ?? '');
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // ── מה כתוב בהתראה ──
  let msg: { title: string; body: string; url: string; tag: string };
  if (kind === 'mission' || kind === 'publish') {
    const { data: m } = await sb.from('missions').select('id, title, is_milestone, order_index, published').eq('id', String(input.id ?? '')).maybeSingle();
    if (!m) return fail('mission not found', 404);
    // מספר העצירה = המיקום שלה במסלול (כמה עצירות עד אליה, כולל)
    const { count } = await sb.from('missions').select('id', { count: 'exact', head: true }).eq('published', true).lte('order_index', m.order_index ?? 0);
    const n = Math.max(1, count ?? 1);
    // mission = המשימה סומנה "הושלמה"; publish = טיוטה (בדרך כלל מיילסטון) פורסמה עכשיו
    msg =
      kind === 'publish'
        ? { title: m.is_milestone ? '🏆 מיילסטון חדש!' : 'משימה חדשה', body: m.title, url: `${SITE}phone.html#${m.is_milestone ? 'story' : 'm'}-${n}`, tag: 'publish' }
        : { title: m.is_milestone ? '🏆 מיילסטון הושלם!' : 'משימה נגמרה ✓', body: m.title, url: `${SITE}phone.html#${m.is_milestone ? 'story' : 'm'}-${n}`, tag: 'mission' };
  } else if (kind === 'story') {
    const { data: s } = await sb.from('stories').select('id, username, caption, status').eq('id', String(input.id ?? '')).maybeSingle();
    if (!s || s.status !== 'approved') return fail('story not found', 404);
    msg = { title: `סטורי חדש מ-${s.username}`, body: s.caption || 'פתחו כדי לראות', url: SITE, tag: 'story' };
  } else if (kind === 'test') {
    msg = { title: 'הסאבתון של עודד', body: 'ההתראות עובדות ✅', url: `${SITE}phone.html`, tag: 'test' };
  } else return fail('unknown kind');

  // ── לא להציף: לכל היותר התראה אחת בדקה מכל סוג ──
  if (kind !== 'test') {
    const { data: last } = await sb.from('push_log').select('sent_at').eq('kind', kind).maybeSingle();
    if (last && Date.now() - Date.parse(last.sent_at) < 60_000) return Response.json({ skipped: 'rate' });
    await sb.from('push_log').upsert({ kind, sent_at: new Date().toISOString() });
  }

  // ── שליחה לכולם; הרשמות שכבר לא קיימות (404/410) נמחקות ──
  const { data: subs } = await sb.from('push_subs').select('endpoint, p256dh, auth');
  const payload = JSON.stringify(msg);
  let sent = 0;
  const dead: string[] = [];
  await Promise.all(
    (subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, urgency: 'high' });
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) dead.push(s.endpoint);
      }
    }),
  );
  if (dead.length) await sb.from('push_subs').delete().in('endpoint', dead);
  return Response.json({ sent, removed: dead.length, total: subs?.length ?? 0 });
});

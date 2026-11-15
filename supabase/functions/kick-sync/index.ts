// kick-sync: רץ כל 2 דקות (pg_cron, ראו supabase/cron.sql).
// 1. סטטוס לייב + קטגוריה → live_status
// 2. אם בלייב על הקטגוריה → מאריך מקטע ב-play_segments (זמן משחק)
// 3. קליפים חדשים מהקטגוריה → clips
//
// ‎?action=probe     – רק בודק אם Kick עונה מהשרת הזה (בלי לכתוב כלום)
// ‎?action=subscribe – רושם webhook של הודעות צ'אט (צריך KICK_CLIENT_ID / KICK_CLIENT_SECRET)
//
// סודות (Supabase → Edge Functions → Secrets): CRON_SECRET, ואופציונלי KICK_CLIENT_ID, KICK_CLIENT_SECRET.
// SUPABASE_URL ו-SUPABASE_SERVICE_ROLE_KEY קיימים אוטומטית.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const GAP_MS = 6 * 60_000; // הפסקה ארוכה מזה = מקטע חדש
const UA = 'Mozilla/5.0 (compatible; subathon-journey/1.0)';

type Json = Record<string, any>;

async function kick(path: string): Promise<Json | null> {
  const r = await fetch(`https://kick.com/api/v2/${path}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`kick ${path}: ${r.status}`);
  return r.json();
}

/** גיבוי: ה-API הרשמי עם טוקן אפליקציה, אם הכתובות הלא רשמיות חסומות מהשרת */
async function appToken() {
  const id = Deno.env.get('KICK_CLIENT_ID');
  const secret = Deno.env.get('KICK_CLIENT_SECRET');
  if (!id || !secret) return null;
  const r = await fetch('https://id.kick.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }),
  });
  if (!r.ok) throw new Error(`kick token: ${r.status}`);
  return (await r.json()).access_token as string;
}

/** סטטוס לייב, מנורמל לשני המקורות */
async function liveStatus(channel: string) {
  try {
    const d = (await kick(`channels/${channel}/livestream`))?.data;
    return {
      is_live: !!d,
      category: d?.category?.slug ?? null,
      title: d?.session_title ?? null,
      viewers: d?.viewers ?? null,
      stream_id: d?.id != null ? String(d.id) : null,
      via: 'v2',
      byName: false,
    };
  } catch (e) {
    const token = await appToken();
    if (!token) throw e;
    const r = await fetch(`https://api.kick.com/public/v1/channels?slug=${encodeURIComponent(channel)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`kick public channels: ${r.status}`);
    const c = (await r.json()).data?.[0];
    const s = c?.stream;
    // ה-API הרשמי מחזיר שם קטגוריה; משווים אותו גם לכתובת (slug) וגם לשם
    const cat = c?.category?.name ? String(c.category.name) : null;
    return {
      is_live: !!s?.is_live,
      category: cat,
      title: c?.stream_title ?? null,
      viewers: s?.viewer_count ?? null,
      stream_id: s?.start_time ?? null,
      via: 'public',
      byName: true,
    };
  }
}

/** הקטגוריה תואמת? כתובות (slug) – השוואה מדויקת; שם מה-API הרשמי ("Grand Theft Auto VI (GTA)") – לפי השם בלי הסוגריים */
const norm = (x: string) => x.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, '');
const sameCategory = (got: string | null, want: string, byName = false) => !!got && (byName ? norm(got) === norm(want) : got.toLowerCase() === want.toLowerCase());

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const action = url.searchParams.get('action');
  const cronSecret = Deno.env.get('CRON_SECRET');
  // הפונקציה פתוחה (--no-verify-jwt), לכן כל מה שכותב דורש את הסוד; probe רק קורא
  if (action !== 'probe' && (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret))
    return new Response(cronSecret ? 'forbidden' : 'CRON_SECRET לא הוגדר', { status: 403 });

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: settings } = await sb.from('settings').select('kick_channel, kick_category').eq('id', 1).maybeSingle();
  const channel = (settings?.kick_channel || 'odedsvr').replace(/^.*kick\.com\//, '').replace(/[^\w-]/g, '').toLowerCase();
  const category = settings?.kick_category || 'grand-theft-auto-vi';
  const report: Json = { channel, category };

  try {
    if (action === 'probe') {
      const t0 = Date.now();
      report.status = await liveStatus(channel);
      report.ms = Date.now() - t0;
      return Response.json(report);
    }

    if (action === 'subscribe') {
      const token = await appToken();
      if (!token) return Response.json({ error: 'חסרים KICK_CLIENT_ID / KICK_CLIENT_SECRET' }, { status: 400 });
      const ch = await kick(`channels/${channel}`);
      const r = await fetch('https://api.kick.com/public/v1/events/subscriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ broadcaster_user_id: ch?.user_id, events: [{ name: 'chat.message.sent', version: 1 }], method: 'webhook' }),
      });
      return Response.json({ status: r.status, body: await r.json().catch(() => null) });
    }

    // ── 1+2: סטטוס וזמן משחק ──
    const now = new Date();
    const st = await liveStatus(channel);
    const on = st.is_live && sameCategory(st.category, category, st.byName);
    report.status = st;
    report.on_category = on;
    await sb.from('live_status').upsert({
      id: 1,
      is_live: st.is_live,
      on_category: on,
      category: st.category,
      title: st.title,
      viewers: st.viewers,
      stream_id: st.stream_id,
      checked_at: now.toISOString(),
    });
    if (on) {
      const { data: last } = await sb.from('play_segments').select('*').order('ended_at', { ascending: false }).limit(1).maybeSingle();
      const lastEnd = last ? new Date(last.ended_at).getTime() : 0;
      if (last && last.stream_id === st.stream_id && now.getTime() - lastEnd <= GAP_MS) {
        await sb.from('play_segments').update({ ended_at: now.toISOString() }).eq('id', last.id);
        report.segment = 'extended';
      } else {
        // מקטע חדש: מתחיל מהבדיקה הזו (לא מנחשים כמה זמן כבר שיחק לפניה)
        await sb.from('play_segments').insert({ stream_id: st.stream_id, started_at: now.toISOString(), ended_at: now.toISOString() });
        report.segment = 'new';
      }
    }

    // ── 3: קליפים חדשים (עמוד אחרי עמוד, עד שמגיעים לקליפ מוכר) ──
    const { data: newest } = await sb.from('clips').select('created_at').order('created_at', { ascending: false }).limit(1).maybeSingle();
    const since = newest ? new Date(newest.created_at).getTime() : 0;
    let cursor = '';
    let added = 0;
    for (let page = 0; page < 10; page++) {
      const d = await kick(`channels/${channel}/clips?sort=date&time=all${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`).catch(() => null);
      const list: Json[] = d?.clips ?? [];
      if (!list.length) break;
      const rows = list
        .filter((c) => c.privacy !== 'private' && sameCategory(c.category?.slug ?? null, category))
        .map((c) => ({
          id: c.id,
          title: c.title ?? '',
          thumbnail_url: c.thumbnail_url ?? null,
          video_url: c.video_url ?? c.clip_url ?? null,
          duration: c.duration ?? null,
          views: c.views ?? c.view_count ?? 0,
          creator: c.creator?.username ?? null,
          created_at: c.created_at,
        }));
      if (rows.length) {
        await sb.from('clips').upsert(rows);
        added += rows.length;
      }
      const oldest = new Date(list[list.length - 1].created_at).getTime();
      if (oldest <= since || !d?.nextCursor) break;
      cursor = d.nextCursor;
    }
    report.clips_added = added;
    return Response.json(report);
  } catch (e) {
    report.error = String(e);
    return Response.json(report, { status: 500 });
  }
});

// clip-make: חותך קליפ מההקלטה של השידור ב-Kick ושומר אותו אצלנו (Supabase Storage), כדי שלא ייעלם כשקיק מוחק את השידור.
// מצבים:
//   { mode: 'range',   mission_id }                          – לפי clip_start / clip_end שבכרטיס העצירה ("1:23:10"), מתחילת השידור
//   { mode: 'moment',  at, mission_id?, label?, before? }    – before שניות (ברירת מחדל 45) עד הרגע at (למשל !מת)
//   { mode: 'archive', clip_id }                             – עותק של קליפ שנוצר ב-Kick (אותו טווח זמן, מההקלטה, ב-720p)
//   { mode: 'undo',    category }                            – ביטול פקודה (!מת- וכו'): מוחק את הקליפ האחרון מהקטגוריה (3 דקות אחרונות)
// range ארוך: נשמרות 3 הדקות הראשונות, והטווח המלא נרשם (vod_url/vod_from/vod_to) כדי לנגן את כולו מההקלטה בקיק.
// הרשאה: x-cron-secret (טריגרים במסד) או טוקן של עורך מחובר (נבדק מול public.is_mod()).
// הקליפ: קטעי ה-HLS המקוריים (10 שניות, 720p) מועתקים כמו שהם + index.m3u8 – בלי המרה. עד 3 דקות.
// סודות: CRON_SECRET. פריסה: supabase functions deploy clip-make --no-verify-jwt
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-client-info, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });
const UA = 'Mozilla/5.0 (compatible; subathon-journey/1.0)';
const MAX_SEC = 180;
const BUCKET = 'clips';

type Json = Record<string, any>;
type Seg = { uri: string; dur: number; t0: number };

async function kick(path: string): Promise<Json> {
  const r = await fetch(`https://kick.com/api/${path}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`Kick ${path}: ${r.status}`);
  return r.json();
}

/** "1:23:10" / "23:10" / "95" → שניות */
export function parseTime(s: string | null | undefined): number | null {
  const parts = String(s ?? '').trim().split(':').map((x) => x.trim());
  if (!parts.length || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

/** "2026-11-19 14:31:51" (UTC, בלי אזור) → ms */
const kickTime = (s: string) => Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`);

/** השידור (VOD) שמכסה את הרגע t, או האחרון */
async function findStream(slug: string, t: number | null) {
  const list = (await kick(`v2/channels/${slug}/videos`)) as unknown as Json[];
  const vids = (Array.isArray(list) ? list : []).filter((v) => v?.video?.uuid && v.start_time);
  if (!vids.length) throw new Error('לא נמצאו שידורים בערוץ');
  const pick =
    t == null
      ? vids[0]
      : vids.find((v) => {
          const a = kickTime(v.start_time);
          const len = v.is_live ? Infinity : Number(v.duration) || 0;
          return t >= a - 60_000 && t <= a + len + 60_000;
        }) ?? vids[0];
  return { uuid: String(pick.video.uuid), start: kickTime(pick.start_time), live: !!pick.is_live, title: String(pick.session_title ?? '') };
}

/** רשימת הקטעים של ההקלטה ב-720p (או הכי קרוב), עם זמן התחלה מצטבר */
async function vodSegments(uuid: string): Promise<{ base: string; segs: Seg[]; total: number }> {
  const v = await kick(`v1/video/${uuid}`);
  const master = String(v.source ?? '');
  if (!master) throw new Error('ההקלטה של השידור לא זמינה');
  const mt = await (await fetch(master, { headers: { 'User-Agent': UA } })).text();
  const variants = mt.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const choice = variants.find((x) => x.startsWith('720p60')) ?? variants.find((x) => x.startsWith('720p')) ?? variants.find((x) => x.startsWith('480p')) ?? variants[0];
  if (!choice) throw new Error('לא נמצאה איכות מתאימה בהקלטה');
  const url = new URL(choice, master).toString();
  const pt = await (await fetch(url, { headers: { 'User-Agent': UA } })).text();
  const segs: Seg[] = [];
  let t = 0;
  let dur = 0;
  for (const raw of pt.split('\n')) {
    const l = raw.trim();
    if (l.startsWith('#EXTINF:')) dur = parseFloat(l.slice(8));
    else if (l && !l.startsWith('#')) {
      segs.push({ uri: new URL(l, url).toString(), dur, t0: t });
      t += dur;
    }
  }
  return { base: url, segs, total: t };
}

/** מעתיק את הקטעים שבטווח [a,b] (שניות מתחילת השידור) ל-Storage. מחזיר כתובת ציבורית של index.m3u8 ואורך */
async function copyRange(sb: SupabaseClient, folder: string, uuid: string, a: number, b: number, waitLive: boolean) {
  if (b <= a) throw new Error('טווח זמן לא תקין');
  if (b - a > MAX_SEC) b = a + MAX_SEC; // קטע ארוך: שומרים את ההתחלה (המלא מתנגן מההקלטה בקיק)
  let vod = await vodSegments(uuid);
  // שידור חי: הקטעים האחרונים מגיעים באיחור קצר – מחכים עד ~40 שניות
  for (let i = 0; waitLive && vod.total < b && i < 8; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    vod = await vodSegments(uuid);
  }
  const pick = vod.segs.filter((s) => s.t0 + s.dur > a && s.t0 < b);
  if (!pick.length) throw new Error(`הזמן ${Math.round(a)}–${Math.round(b)} שניות לא נמצא בהקלטה (אורך ההקלטה: ${Math.round(vod.total)} שניות)`);
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3', `#EXT-X-TARGETDURATION:${Math.ceil(Math.max(...pick.map((s) => s.dur)))}`, '#EXT-X-MEDIA-SEQUENCE:0', '#EXT-X-PLAYLIST-TYPE:VOD'];
  for (let i = 0; i < pick.length; i++) {
    const r = await fetch(pick[i].uri, { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error(`הורדת קטע נכשלה (${r.status})`);
    const body = new Uint8Array(await r.arrayBuffer());
    const { error } = await sb.storage.from(BUCKET).upload(`${folder}/${i}.ts`, body, { contentType: 'video/mp2t', upsert: true });
    if (error) throw new Error(`שמירה נכשלה: ${error.message}`);
    lines.push(`#EXTINF:${pick[i].dur.toFixed(3)},`, `${i}.ts`);
  }
  lines.push('#EXT-X-ENDLIST', '');
  const { error } = await sb.storage.from(BUCKET).upload(`${folder}/index.m3u8`, new TextEncoder().encode(lines.join('\n')), { contentType: 'application/vnd.apple.mpegurl', upsert: true });
  if (error) throw new Error(`שמירה נכשלה: ${error.message}`);
  const url = sb.storage.from(BUCKET).getPublicUrl(`${folder}/index.m3u8`).data.publicUrl;
  return { url, duration: Math.round(pick.reduce((n, s) => n + s.dur, 0)), from: pick[0].t0, vod: vod.base };
}

async function liveThumb(slug: string) {
  try {
    const d = (await kick(`v2/channels/${slug}/livestream`))?.data;
    const u = d?.thumbnail?.src ?? d?.thumbnail?.url ?? null;
    return typeof u === 'string' && u.startsWith('https://') ? u : null;
  } catch {
    return null;
  }
}

const LABELS: Record<string, string> = { death: 'עודד מת 💀', arrest: 'עודד נעצר 🚓', fail: 'עודד פישל ❌' };

/** מחיקת קליפ שלנו: השורה והקבצים */
async function removeClip(sb: SupabaseClient, id: string) {
  const { data: files } = await sb.storage.from(BUCKET).list(id, { limit: 200 });
  if (files?.length) await sb.storage.from(BUCKET).remove(files.map((f) => `${id}/${f.name}`));
  await sb.from('clips').delete().eq('id', id);
}

async function run(sb: SupabaseClient, input: Json) {
  const { data: s } = await sb.from('settings').select('kick_channel, current_mission_id').eq('id', 1).maybeSingle();
  const slug = String(s?.kick_channel || 'odedsvr').replace(/^.*kick\.com\//i, '').replace(/[^A-Za-z0-9_-]/g, '').toLowerCase();
  const id = `own_${crypto.randomUUID().slice(0, 12)}`;

  if (input.mode === 'range') {
    const { data: m } = await sb.from('missions').select('id, title, image_url, happened_at, clip_start, clip_end').eq('id', String(input.mission_id ?? '')).maybeSingle();
    if (!m) throw new Error('העצירה לא נמצאה');
    const a = parseTime(m.clip_start);
    const b = parseTime(m.clip_end);
    if (a == null || b == null || b <= a) throw new Error('דקת התחלה/סיום לא תקינות (למשל 1:23:10 עד 1:24:30)');
    const st = await findStream(slug, m.happened_at ? Date.parse(m.happened_at) : null);
    const out = await copyRange(sb, id, st.uuid, a, Math.min(b, a + MAX_SEC), st.live);
    // שמירה מחדש של אותה עצירה: הקליפ הקודם שלה מתחלף
    const { data: old } = await sb.from('clips').select('id').eq('mission_id', m.id).eq('kind', 'range');
    for (const o of old ?? []) await removeClip(sb, o.id);
    const row = { id, title: m.title || 'קליפ', thumbnail_url: m.image_url ?? (st.live ? await liveThumb(slug) : null), video_url: out.url, duration: out.duration, views: 0, creator: 'עודד', created_at: new Date(st.start + a * 1000).toISOString(), mission_id: m.id, source: 'own', kind: 'range', vod_url: out.vod, vod_from: Math.round(a), vod_to: Math.round(b) };
    const { error } = await sb.from('clips').insert(row);
    if (error) throw new Error(error.message);
    return row;
  }

  if (input.mode === 'moment') {
    const at = Date.parse(String(input.at ?? '')) || Date.now();
    const before = Math.min(MAX_SEC, Math.max(10, Number(input.before) || 45));
    const st = await findStream(slug, at);
    const off = (at - st.start) / 1000;
    const out = await copyRange(sb, id, st.uuid, Math.max(0, off - before), off + 3, st.live);
    // משויך לעצירה רק אם היא עוד לא הסתיימה ברגע האירוע; אחרת – קליפ עצמאי (עודד מסתובב)
    let missionId: string | null = input.mission_id ?? s?.current_mission_id ?? null;
    if (missionId) {
      const { data: m } = await sb.from('missions').select('finished_at, published').eq('id', missionId).maybeSingle();
      if (!m || m.published === false || (m.finished_at && Date.parse(m.finished_at) <= at)) missionId = null;
    }
    const category = ['death', 'arrest', 'fail'].includes(String(input.category)) ? String(input.category) : null;
    const label = input.label || (category ? LABELS[category] : 'רגע מהלייב');
    const row = { id, title: String(label).slice(0, 80), thumbnail_url: st.live ? await liveThumb(slug) : null, video_url: out.url, duration: out.duration, views: 0, creator: 'עודד', created_at: new Date(at).toISOString(), mission_id: missionId, source: 'own', kind: 'moment', category };
    const { error } = await sb.from('clips').insert(row);
    if (error) throw new Error(error.message);
    return row;
  }

  if (input.mode === 'archive') {
    const { data: c } = await sb.from('clips').select('id, video_url, duration, created_at, archived_url').eq('id', String(input.clip_id ?? '')).maybeSingle();
    if (!c) throw new Error('הקליפ לא נמצא');
    if (c.archived_url) return { id: c.id, archived_url: c.archived_url };
    // הרגע שבו הקליפ מתחיל: מהשורה הראשונה של ה-playlist של Kick (PROGRAM-DATE-TIME), או created_at פחות האורך
    let start = Date.parse(c.created_at) - (Number(c.duration) || 30) * 1000;
    try {
      const pl = await (await fetch(String(c.video_url), { headers: { 'User-Agent': UA } })).text();
      const m = pl.match(/#EXT-X-PROGRAM-DATE-TIME:(\S+)/);
      if (m) start = Date.parse(m[1]) || start;
    } catch {
      /* נשארים עם ההערכה */
    }
    const len = Math.min(MAX_SEC, Number(c.duration) || 30);
    const st = await findStream(slug, start);
    const off = (start - st.start) / 1000;
    const out = await copyRange(sb, `kick_${c.id}`, st.uuid, Math.max(0, off), off + len, st.live);
    const { error } = await sb.from('clips').update({ archived_url: out.url }).eq('id', c.id);
    if (error) throw new Error(error.message);
    return { id: c.id, archived_url: out.url };
  }

  if (input.mode === 'undo') {
    const since = new Date(Date.now() - 3 * 60_000).toISOString();
    const { data: last } = await sb.from('clips').select('id').eq('kind', 'moment').eq('category', String(input.category ?? '')).gte('created_at', since).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (last) await removeClip(sb, last.id);
    return { removed: last?.id ?? null };
  }
  throw new Error('מצב לא מוכר');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const url = Deno.env.get('SUPABASE_URL')!;
  const secret = Deno.env.get('CRON_SECRET');
  let allowed = !!secret && req.headers.get('x-cron-secret') === secret;
  if (!allowed) {
    // עורך מחובר: אותו טוקן שהאתר משתמש בו לעריכה, נבדק מול המסד
    const auth = req.headers.get('authorization') ?? '';
    if (auth.startsWith('Bearer ')) {
      const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
      const { data } = await asUser.rpc('is_mod');
      allowed = data === true;
    }
  }
  if (!allowed) return json({ error: 'רק עורכים יכולים ליצור קליפים' }, 401);

  let input: Json;
  try {
    input = await req.json();
  } catch {
    return json({ error: 'בקשה לא תקינה' }, 400);
  }
  const sb = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  // העבודה ממשיכה ברקע (טריגרים במסד לא מחכים); עורך שמבקש wait מקבל את התוצאה
  const job = run(sb, input).catch((e) => {
    console.error('clip-make', input?.mode, (e as Error).message);
    return { error: (e as Error).message };
  });
  if (input.wait) {
    const r = (await job) as Json;
    return json(r, r && 'error' in r ? 500 : 200);
  }
  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil?.(job);
  return json({ ok: true, queued: input.mode });
});

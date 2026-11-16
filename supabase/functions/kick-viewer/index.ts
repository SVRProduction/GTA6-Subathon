// kick-viewer: פעולות של צופה מחובר עם Kick (כרטיס חתום מ-kick-auth).
// ‎POST { token, action: 'story' | 'like' | 'vote', ... }
//   story: { image (JPEG base64, עד ~1.5MB), caption, mission_id?, x?, y? } → נשמר כ-pending עד אישור מוד
//   like:  { story_id } → לייק אחד לכל משתמש
//   vote:  { poll_id, option } → קול אחד לכל משתמש; הצבעה חוזרת מחליפה את הקודמת
// בודק: חתימה, חסימה (comment_bans), קצב. סודות: SESSION_SECRET. פריסה: supabase functions deploy kick-viewer --no-verify-jwt
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { verify } from '../_shared/session.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const fail = (error: string, status = 400) => Response.json({ error }, { status, headers: CORS });
const ok = (extra: Record<string, unknown> = {}) => Response.json({ ok: true, ...extra }, { headers: CORS });

/** כיתוב: בלי תווי בקרה וכיווניות מוסתרים, קישורים מנוטרלים */
export function cleanCaption(s: string) {
  return s
    .replace(/[\u0000-\u001F\u007F​-‏‪-‮⁦-⁩]/g, ' ')
    .replace(/https?:\/\/\S+/gi, '[קישור]')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 160);
}
const coord = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= -0.5 && v <= 1.5 ? v : null);
const MAX_IMAGE = 1_600_000; // בתים אחרי פענוח

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return fail('method', 405);
  const secret = Deno.env.get('SESSION_SECRET');
  if (!secret) return fail('השרת לא מוגדר (SESSION_SECRET)', 500);
  let input: Record<string, unknown>;
  try {
    input = await req.json();
  } catch {
    return fail('בקשה לא תקינה');
  }
  const who = await verify<{ uid: string; name: string; pic: string | null }>(String(input.token ?? ''), secret);
  if (!who) return fail('צריך להתחבר מחדש עם Kick', 401);

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: ban } = await sb.from('comment_bans').select('kick_user_id').eq('kick_user_id', who.uid).maybeSingle();
  if (ban) return fail('החשבון הזה חסום', 403);

  const action = input.action;

  // ── סטורי חדש ──
  if (action === 'story') {
    // קצב: אחד בכל 2 דקות, עד 6 ביום
    const dayAgo = new Date(Date.now() - 864e5).toISOString();
    const { data: recent } = await sb.from('stories').select('created_at').eq('kick_user_id', who.uid).gte('created_at', dayAgo).order('created_at', { ascending: false }).limit(7);
    if (recent?.length && Date.now() - Date.parse(recent[0].created_at) < 120_000) return fail('אפשר להעלות סטורי אחד בכל 2 דקות', 429);
    if ((recent?.length ?? 0) >= 6) return fail('הגעתם למגבלת הסטוריז היומית', 429);
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(String(input.image ?? '')), (c) => c.charCodeAt(0));
    } catch {
      return fail('התמונה לא תקינה');
    }
    // רק JPEG (הדפדפן ממיר לפני השליחה): בודקים את החתימה של הקובץ
    if (bytes.length < 200 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return fail('התמונה לא תקינה');
    if (bytes.length > MAX_IMAGE) return fail('התמונה גדולה מדי');
    const path = `${who.uid}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.jpg`;
    const up = await sb.storage.from('stories').upload(path, bytes, { contentType: 'image/jpeg' });
    if (up.error) return fail(up.error.message, 500);
    const image_url = sb.storage.from('stories').getPublicUrl(path).data.publicUrl;
    const mission = typeof input.mission_id === 'string' && /^[0-9a-f-]{36}$/i.test(input.mission_id) ? input.mission_id : null;
    const { error } = await sb.from('stories').insert({
      kick_user_id: who.uid,
      username: String(who.name).slice(0, 40),
      avatar: who.pic && /^https:\/\//.test(who.pic) ? who.pic : null,
      image_url,
      caption: cleanCaption(String(input.caption ?? '')),
      mission_id: mission,
      x: coord(input.x),
      y: coord(input.y),
      status: 'pending',
    });
    if (error) return fail(error.message, 500);
    return ok({ status: 'pending' });
  }

  // ── לייק ──
  if (action === 'like') {
    const id = String(input.story_id ?? '');
    const { data: st } = await sb.from('stories').select('id, status').eq('id', id).maybeSingle();
    if (!st || st.status !== 'approved') return fail('הסטורי לא נמצא');
    const { error } = await sb.rpc('like_story', { p_story: id, p_user: who.uid });
    if (error) return fail(error.message, 500);
    return ok();
  }

  // ── הצבעה בסקר ──
  if (action === 'vote') {
    const id = String(input.poll_id ?? '');
    const option = Number(input.option);
    const { data: p } = await sb.from('polls').select('id, options, status, ends_at').eq('id', id).maybeSingle();
    if (!p || p.status !== 'open' || Date.parse(p.ends_at) <= Date.now()) return fail('הסקר כבר נסגר');
    if (!Number.isInteger(option) || option < 0 || option >= p.options.length) return fail('אפשרות לא קיימת');
    const { error } = await sb.from('poll_votes').upsert({ poll_id: id, kick_user_id: who.uid, option, source: 'site', updated_at: new Date().toISOString() });
    if (error) return fail(error.message, 500);
    return ok();
  }

  return fail('פעולה לא מוכרת');
});

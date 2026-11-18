// kick-comment: שליחת תגובה של צופה מחובר עם Kick.
// ‎POST { token, target_type: 'stop'|'clip'|'marker'|'story', target_id, body, parent_id? }  (parent_id = תגובה לתגובה)
// בודק: כרטיס חתום (kick-auth), חסימה, קצב (אחת ל-15 שניות, עד 30 בשעה), אורך (עד 500), ושהיעד קיים.
// סודות: SESSION_SECRET. פריסה: supabase functions deploy kick-comment --no-verify-jwt
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { verify } from '../_shared/session.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const fail = (error: string, status = 400) => Response.json({ error }, { status, headers: CORS });

/** ניקוי: בלי תווי בקרה, רווחים מכווצים, קישורים מנוטרלים (נשמרים כטקסט בלבד) */
export function clean(s: string) {
  return s
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/https?:\/\/\S+/gi, '[קישור]')
    .trim()
    .slice(0, 500);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return fail('method', 405);
  const secret = Deno.env.get('SESSION_SECRET');
  if (!secret) return fail('השרת לא מוגדר (SESSION_SECRET)', 500);

  let input: { token?: string; target_type?: string; target_id?: string; body?: string; parent_id?: string };
  try {
    input = await req.json();
  } catch {
    return fail('בקשה לא תקינה');
  }
  const who = await verify<{ uid: string; name: string; pic: string | null }>(input.token ?? '', secret);
  if (!who) return fail('צריך להתחבר מחדש עם Kick', 401);
  const type = input.target_type;
  if (type !== 'stop' && type !== 'clip' && type !== 'marker' && type !== 'story') return fail('יעד לא תקין');
  const target = String(input.target_id ?? '').slice(0, 80);
  const body = clean(String(input.body ?? ''));
  if (!target) return fail('יעד לא תקין');
  if (!body) return fail('אי אפשר לשלוח תגובה ריקה');

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: ban } = await sb.from('comment_bans').select('kick_user_id').eq('kick_user_id', who.uid).maybeSingle();
  if (ban) return fail('החשבון הזה חסום מלהגיב', 403);

  // קצב
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const { data: recent } = await sb.from('comments').select('created_at').eq('kick_user_id', who.uid).gte('created_at', hourAgo).order('created_at', { ascending: false }).limit(31);
  if (recent?.length && Date.now() - Date.parse(recent[0].created_at) < 15_000) return fail('רגע, אפשר להגיב פעם ב-15 שניות', 429);
  if ((recent?.length ?? 0) >= 30) return fail('הגעתם למגבלת התגובות לשעה. נסו שוב מאוחר יותר.', 429);

  // היעד קיים?
  const table = { stop: 'missions', clip: 'clips', marker: 'markers', story: 'stories' }[type];
  // הטריילרים של Rockstar (yt-…) והקליפים הנבחרים מהערוץ ב-Kick (clip_…) לא נמצאים בטבלה
  const exists = type === 'clip' && /^(yt-[\w-]{6,20}|clip_[A-Z0-9]{20,32})$/.test(target) ? true : (await sb.from(table).select('id').eq('id', target).maybeSingle()).data;
  if (!exists) return fail('העצירה או הקליפ לא נמצאו');

  // תגובה לתגובה: רמה אחת בלבד. מגיבים לתגובה שהיא עצמה תשובה – נשמר תחת התגובה הראשית שלה
  let parent: string | null = null;
  if (input.parent_id) {
    const { data: p } = await sb.from('comments').select('id, parent_id, target_type, target_id, hidden').eq('id', String(input.parent_id).slice(0, 40)).maybeSingle();
    if (!p || p.hidden || p.target_type !== type || p.target_id !== target) return fail('התגובה שעניתם לה לא נמצאה');
    parent = p.parent_id ?? p.id;
  }

  const { error } = await sb.from('comments').insert({
    target_type: type,
    target_id: target,
    kick_user_id: who.uid,
    username: String(who.name).slice(0, 40),
    avatar: who.pic && /^https:\/\//.test(who.pic) ? who.pic : null,
    body,
    ...(parent ? { parent_id: parent } : {}),
  });
  if (error) return fail(error.message, 500);
  return Response.json({ ok: true }, { headers: CORS });
});

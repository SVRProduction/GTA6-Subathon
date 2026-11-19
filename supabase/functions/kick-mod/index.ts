// kick-mod: מוד מתחבר עם Kick ומקבל טוקן של Supabase לפעולות עריכה.
// ‎POST { token, request? }  ← כרטיס ה-Kick החתום מ-kick-auth
// request=true (רק מכפתור "בקשת גישה" באדמין): מי שלא ברשימה נכנס לתור public.mod_requests, וכל מוד יכול לאשר.
// לא-מוד מקבל 403 עם request: 'pending' | 'rejected' | null (מצב הבקשה שלו).
// בודק: חתימה, ושהמשתמש בעלים (settings.kick_channel / settings.owners) או ברשימה public.mods.
// מחזיר { token, exp, owner, name } – JWT עם role=authenticated ו-kick_name, תקף 12 שעות.
// ההרשאות במסד (public.is_mod) בודקות את השם מול הרשימה בכל בקשה, כך שהסרה מהרשימה תופסת מיד.
//
// סודות: SESSION_SECRET (כמו kick-auth), MOD_JWT_SECRET (Project Settings → JWT Keys → Legacy JWT secret) – לא SUPABASE_JWT_SECRET: Supabase חוסם סודות שמתחילים ב-SUPABASE_
// פריסה: supabase functions deploy kick-mod --no-verify-jwt
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { verify } from '../_shared/session.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const fail = (error: string, status = 400) => Response.json({ error }, { status, headers: CORS });
const TTL = 12 * 3600;

const enc = new TextEncoder();
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uJson = (o: unknown) => b64u(enc.encode(JSON.stringify(o)));

/** שם ערוץ / משתמש נקי, באותיות קטנות (Kick לא מבחין בין גדולות לקטנות) */
export const slug = (s: string | null | undefined) => String(s ?? '').trim().replace(/^.*kick\.com\//i, '').replace(/[^A-Za-z0-9_-]/g, '').toLowerCase();

/** JWT ב-HS256, כמו שה-Legacy JWT secret של Supabase מצפה */
export async function mintJwt(claims: Record<string, unknown>, secret: string) {
  const head = b64uJson({ alg: 'HS256', typ: 'JWT' });
  const body = b64uJson(claims);
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${head}.${body}`)));
  return `${head}.${body}.${b64u(sig)}`;
}

/** sub יציב בפורמט UUID מתוך מזהה ה-Kick (ל-auth.uid() אם יידרש) */
async function uuidFrom(s: string) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`kick:${s}`))).slice(0, 16);
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

const REJECT_COOLDOWN = 24 * 3600_000;
const MAX_PENDING = 100;
const notMod = (error: string, request: 'pending' | 'rejected' | null) => Response.json({ error, request }, { status: 403, headers: CORS });

/** מי שלא ברשימה: מחזיר את מצב הבקשה שלו, ואם ביקש – פותח בקשת גישה שכל מוד יכול לאשר */
// deno-lint-ignore no-explicit-any
async function notListed(sb: any, name: string, who: { uid: string; name: string; pic?: string | null }, ask: boolean) {
  const { data: req, error } = await sb.from('mod_requests').select('status, kick_user_id, decided_at').eq('kick_username', name).maybeSingle();
  // הטבלה עוד לא קיימת (supabase/update-mod-requests.sql לא הורץ): ההתנהגות הישנה
  if (error) return notMod('אין לך הרשאת מוד. בקשו מהבעלים להוסיף אתכם ברשימת המודים.', null);
  const mine = req && req.kick_user_id === String(who.uid);
  if (mine && req.status === 'pending') return notMod('בקשת הגישה שלך מחכה לאישור של מוד.', 'pending');
  const rejectedLately = mine && req.status === 'rejected' && Date.now() - Date.parse(req.decided_at ?? '') < REJECT_COOLDOWN;
  if (!ask) return notMod(rejectedLately ? 'בקשת הגישה שלך נדחתה. אפשר לבקש שוב מחר.' : 'אין לך עדיין הרשאת מוד. אפשר לבקש גישה, ומוד יאשר אותה.', rejectedLately ? 'rejected' : null);
  if (rejectedLately) return notMod('בקשת הגישה שלך נדחתה. אפשר לבקש שוב מחר.', 'rejected');
  const { data: ban } = await sb.from('comment_bans').select('kick_user_id').eq('kick_user_id', String(who.uid)).maybeSingle();
  if (ban) return notMod('החשבון הזה חסום', null);
  if (!req) {
    const { count } = await sb.from('mod_requests').select('kick_username', { count: 'exact', head: true }).eq('status', 'pending');
    if ((count ?? 0) >= MAX_PENDING) return notMod('יש כרגע יותר מדי בקשות פתוחות. נסו שוב מאוחר יותר.', null);
  }
  const { error: e2 } = await sb.from('mod_requests').upsert({
    kick_username: name,
    kick_user_id: String(who.uid),
    display_name: String(who.name).slice(0, 40),
    avatar: who.pic && /^https:\/\//.test(who.pic) ? who.pic : null,
    status: 'pending',
    requested_at: new Date().toISOString(),
    decided_by: null,
    decided_at: null,
  });
  if (e2) return fail(e2.message, 500);
  return notMod('הבקשה נשלחה. כשמוד יאשר אותה, נכנסים שוב עם Kick.', 'pending');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return fail('method', 405);
  const session = Deno.env.get('SESSION_SECRET');
  const jwtSecret = Deno.env.get('MOD_JWT_SECRET') ?? Deno.env.get('SUPABASE_JWT_SECRET');
  if (!session || !jwtSecret) return fail('השרת לא מוגדר (SESSION_SECRET / MOD_JWT_SECRET)', 500);

  let input: { token?: string; request?: boolean };
  try {
    input = await req.json();
  } catch {
    return fail('בקשה לא תקינה');
  }
  const who = await verify<{ uid: string; name: string; pic?: string | null }>(String(input.token ?? ''), session);
  if (!who?.uid || !who.name) return fail('צריך להתחבר מחדש עם Kick', 401);
  const name = slug(who.name);
  if (!name) return fail('שם משתמש לא תקין', 400);

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: s } = await sb.from('settings').select('kick_channel, owners').eq('id', 1).maybeSingle();
  const owners = new Set<string>([...((s?.owners as string[] | null) ?? ['odedsvr', 'zswolt']).map(slug), slug(s?.kick_channel) || 'odedsvr'].filter(Boolean));
  const owner = owners.has(name);

  if (!owner) {
    const { data: row } = await sb.from('mods').select('kick_username, kick_user_id').eq('kick_username', name).maybeSingle();
    if (!row) return notListed(sb, name, who, input.request === true);
    // השם כבר שויך לחשבון Kick אחר (שם שהתחלף בין משתמשים) – לא נותנים הרשאה
    if (row.kick_user_id && row.kick_user_id !== String(who.uid)) return fail('השם הזה ברשימה שייך לחשבון Kick אחר. בקשו מהבעלים להוסיף אתכם מחדש.', 403);
    await sb.from('mods').update({ kick_user_id: String(who.uid), last_login: new Date().toISOString() }).eq('kick_username', name);
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = now + TTL;
  const token = await mintJwt(
    {
      aud: 'authenticated',
      role: 'authenticated',
      iss: 'kick-mod',
      sub: await uuidFrom(String(who.uid)),
      iat: now,
      exp,
      kick_uid: String(who.uid),
      kick_name: name,
      owner,
    },
    jwtSecret,
  );
  return Response.json({ token, exp, owner, name: who.name }, { headers: CORS });
});

// kick-auth: התחברות צופים עם Kick (OAuth 2.1 + PKCE), בשביל תגובות.
// 1. ‎GET ?return=<דף באתר>          → מעביר ל-id.kick.com (ה-PKCE והדף לחזרה שמורים ב-state חתום)
// 2. ‎GET ?code=…&state=…  (מ-Kick)   → מחליף קוד בטוקן, מביא שם ותמונה, וחוזר לדף עם ‎#kick_session=<כרטיס חתום>
// הטוקן של Kick לא נשמר ולא נשלח לדפדפן. הכרטיס תקף ל-30 יום ומכיל רק מזהה, שם ותמונה.
//
// סודות: KICK_CLIENT_ID, KICK_CLIENT_SECRET, SESSION_SECRET. אופציונלי: ALLOWED_RETURN (קידומת כתובת מותרת, למשל https://svrproduction.github.io/)
// פריסה: supabase functions deploy kick-auth --no-verify-jwt
// ב-Kick (Developer → האפליקציה): Redirect URL = https://<PROJECT_REF>.supabase.co/functions/v1/kick-auth
import { randomString, sha256b64u, sign, verify } from '../_shared/session.ts';

const ID = 'https://id.kick.com';
const API = 'https://api.kick.com/public/v1';

function back(returnTo: string, hash: string) {
  return new Response(null, { status: 302, headers: { Location: `${returnTo.split('#')[0]}#${hash}` } });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const clientId = Deno.env.get('KICK_CLIENT_ID');
  const clientSecret = Deno.env.get('KICK_CLIENT_SECRET');
  const secret = Deno.env.get('SESSION_SECRET');
  if (!clientId || !clientSecret || !secret) return new Response('kick-auth: חסרים KICK_CLIENT_ID / KICK_CLIENT_SECRET / SESSION_SECRET', { status: 500 });
  // כתובת החזרה מ-Kick: הכתובת הציבורית של הפונקציה (מאחורי ה-gateway ה-host הפנימי שונה)
  const self = Deno.env.get('KICK_REDIRECT_URI') ?? `${Deno.env.get('SUPABASE_URL')}/functions/v1/kick-auth`;
  const allowed = Deno.env.get('ALLOWED_RETURN');

  // ── שלב 2: חזרה מ-Kick ──
  const code = url.searchParams.get('code');
  const stateRaw = url.searchParams.get('state');
  if (code || stateRaw || url.searchParams.get('error')) {
    const st = stateRaw ? await verify<{ v: string; r: string }>(stateRaw, secret) : null;
    if (!st) return new Response('בקשת התחברות לא תקינה או שפג תוקפה. חזרו לאתר ונסו שוב.', { status: 400 });
    if (!code) return back(st.r, 'kick_error=denied');
    try {
      const tok = await fetch(`${ID}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId, client_secret: clientSecret, redirect_uri: self, code_verifier: st.v }),
      });
      if (!tok.ok) throw new Error(`token ${tok.status}`);
      const access = (await tok.json()).access_token as string;
      const me = await fetch(`${API}/users`, { headers: { Authorization: `Bearer ${access}` } });
      if (!me.ok) throw new Error(`users ${me.status}`);
      const u = (await me.json()).data?.[0];
      if (!u?.user_id) throw new Error('no user');
      const session = await sign({ uid: String(u.user_id), name: String(u.name ?? 'צופה'), pic: u.profile_picture ?? null, exp: Math.floor(Date.now() / 1000) + 30 * 86400 }, secret);
      return back(st.r, `kick_session=${encodeURIComponent(session)}`);
    } catch (e) {
      console.error('kick-auth', e);
      return back(st.r, 'kick_error=failed');
    }
  }

  // ── שלב 1: יציאה ל-Kick ──
  const returnTo = url.searchParams.get('return') ?? '';
  let ok = false;
  try {
    const r = new URL(returnTo);
    ok = (r.protocol === 'https:' || r.hostname === 'localhost') && (!allowed || returnTo.startsWith(allowed));
  } catch {
    ok = false;
  }
  if (!ok) return new Response('כתובת חזרה לא מותרת', { status: 400 });
  const verifier = randomString(48);
  // ה-state חתום ותקף ל-10 דקות: מונע זיוף ומחזיק את ה-PKCE בלי מסד נתונים
  const state = await sign({ v: verifier, r: returnTo, n: randomString(8), exp: Math.floor(Date.now() / 1000) + 600 }, secret);
  const auth = new URL(`${ID}/oauth/authorize`);
  auth.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: self,
    scope: 'user:read',
    code_challenge: await sha256b64u(verifier),
    code_challenge_method: 'S256',
    state,
  }).toString();
  return new Response(null, { status: 302, headers: { Location: auth.toString() } });
});

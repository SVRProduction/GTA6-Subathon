// התחברות צופים עם Kick, כדי להגיב.
// ההתחברות עצמה קורית בשרת (supabase/functions/kick-auth), שמחזיר לדף כרטיס חתום ב-‎#kick_session=…
// הכרטיס נשמר בדפדפן ונשלח עם כל תגובה; השרת בודק את החתימה. הטוקן של Kick עצמו לא מגיע לכאן.
import type { Store, Viewer } from './data/types';
import { setModSession } from './data/modSession';

const KEY = 'kick-viewer';
const listeners = new Set<(v: Viewer | null) => void>();

const b64 = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

/** קורא את הכרטיס (בלי לאמת – רק כדי להציג שם ותמונה; האימות בשרת) */
function parse(token: string): Viewer | null {
  try {
    const p = JSON.parse(b64(token.split('.')[0]));
    if (!p.uid || !p.name || (p.exp && p.exp * 1000 < Date.now())) return null;
    return { token, kick_user_id: String(p.uid), username: String(p.name), avatar: p.pic ?? null };
  } catch {
    return null;
  }
}

let viewer: Viewer | null = null;
try {
  const saved = localStorage.getItem(KEY);
  viewer = saved ? (JSON.parse(saved) as Viewer) : null;
  if (viewer && viewer.token !== 'demo' && !parse(viewer.token)) viewer = null;
} catch {
  viewer = null;
}

// חזרה מההתחברות: ‎#kick_session=<token> (או ‎#kick_error=…)
const m = location.hash.match(/kick_session=([^&]+)/);
if (m) {
  const v = parse(decodeURIComponent(m[1]));
  if (v) save(v);
  history.replaceState(null, '', location.pathname + location.search + location.hash.replace(/[#&]?kick_session=[^&]+/, '').replace(/^#?$/, ''));
}
export const loginError = location.hash.match(/kick_error=([^&]+)/)?.[1] ?? null;
if (loginError) history.replaceState(null, '', location.pathname + location.search);

function save(v: Viewer | null) {
  viewer = v;
  try {
    if (v) localStorage.setItem(KEY, JSON.stringify(v));
    else localStorage.removeItem(KEY);
  } catch {
    /* חסום */
  }
  listeners.forEach((f) => f(v));
}

export const getViewer = () => viewer;
export const onViewer = (f: (v: Viewer | null) => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};

/** מעבר להתחברות עם Kick; בדמו – משתמש דמו מיידי (באדמין: הבעלים odedsvr) */
export function login(store: Store, demoName = 'צופה_דמו') {
  const url = store.kickLoginUrl(location.href.split('#')[0] + (location.hash || ''));
  if (url) {
    location.href = url;
    return;
  }
  save({ token: 'demo', kick_user_id: `demo-${demoName}`, username: demoName, avatar: null });
}

export function logout() {
  setModSession(null);
  save(null);
}

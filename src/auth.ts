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

// חזרה מההתחברות: ‎#kick_session=<token> (או ‎#kick_error=…). ה-hash המקורי של הדף (למשל ‎#phone) נשאר
const m = location.hash.match(/kick_session=([^&]+)/);
if (m) {
  const v = parse(decodeURIComponent(m[1]));
  if (v) save(v);
}
export const loginError = location.hash.match(/kick_error=([^&]+)/)?.[1] ?? null;
if (m || loginError) {
  const rest = location.hash.replace(/^#/, '').split('&').filter((x) => x && !/^kick_(session|error)=/.test(x)).join('&');
  history.replaceState(null, '', location.pathname + location.search + (rest ? `#${rest}` : ''));
}

/** הודעה לצופה כשההתחברות לא הושלמה */
export function loginErrorText(code: string | null = loginError) {
  if (code === 'expired') return 'עבר יותר מדי זמן מאז שהתחלתם להתחבר. לחצו שוב על "התחברות עם Kick" – אם כבר נרשמתם ב-Kick, זה ייקח שנייה.';
  if (code === 'denied') return 'ההתחברות בוטלה ב-Kick. אפשר לנסות שוב.';
  return 'ההתחברות עם Kick לא הצליחה. נסו שוב.';
}

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

// התחברות שהסתיימה בלשונית אחרת (למשל כש-Kick / Google פתחו לשונית חדשה): מתעדכנים גם כאן
addEventListener('storage', (e) => {
  if (e.key !== KEY) return;
  let v: Viewer | null = null;
  try {
    v = e.newValue ? (JSON.parse(e.newValue) as Viewer) : null;
  } catch {
    v = null;
  }
  if (v && v.token !== 'demo' && !parse(v.token)) v = null;
  viewer = v;
  listeners.forEach((f) => f(v));
});

export const getViewer = () => viewer;
export const onViewer = (f: (v: Viewer | null) => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};

/** החלון הראשי של האתר: הטלפון במפה רץ בתוך iframe (phone.html?inapp) */
function siteTop(): Window | null {
  try {
    if (window.top && window.top !== window && window.top.location.origin === location.origin) return window.top;
  } catch {
    /* מוטמע באתר אחר */
  }
  return null;
}

/** דפדפן בתוך אפליקציה (אינסטגרם, טיקטוק, פייסבוק, WebView באנדרואיד): Google חוסם בו התחברות */
export const inAppBrowser = () => /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|TikTok|musical_ly|BytedanceWebview|Snapchat|; wv\)/i.test(navigator.userAgent);

/** חלון קטן לפני היציאה ל-Kick מדפדפן של אפליקציה: Google לא יעבוד שם, אז מציעים לפתוח בדפדפן רגיל */
function inAppNotice(win: Window, go: () => void, pageUrl: string) {
  const doc = win.document;
  doc.getElementById('kick-inapp')?.remove();
  const box = doc.createElement('div');
  box.id = 'kick-inapp';
  box.dir = 'rtl';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:16px;background:rgba(0,0,0,.6);font:15px/1.5 system-ui,sans-serif';
  const card = doc.createElement('div');
  card.style.cssText = 'max-width:380px;width:100%;background:#10202b;color:#f4ecd8;border-radius:16px;padding:18px;display:grid;gap:10px;box-shadow:0 10px 40px rgba(0,0,0,.5)';
  const p = (text: string, bold = false) => {
    const el = doc.createElement('p');
    el.style.margin = '0';
    if (bold) el.style.fontWeight = '700';
    el.textContent = text;
    return el;
  };
  const btn = (text: string, primary: boolean, onclick: () => void) => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.style.cssText = `font:inherit;padding:10px 14px;border-radius:12px;border:0;cursor:pointer;${primary ? 'background:#e8c37a;color:#10202b;font-weight:700' : 'background:rgba(255,255,255,.12);color:inherit'}`;
    b.onclick = onclick;
    return b;
  };
  const close = () => box.remove();
  card.append(
    p('נכנסים עם Google?', true),
    p('אתם בדפדפן של אפליקציה (אינסטגרם, טיקטוק וכו׳), ו-Google לא מאפשר להתחבר מתוכו. פתחו את האתר בכרום או בספארי (בתפריט ⋮ / ⋯ ← "פתיחה בדפדפן") והתחברו משם.'),
    p('עם אימייל וסיסמה של Kick אפשר להמשיך כאן.'),
  );
  if (/Android/i.test(navigator.userAgent)) {
    const u = new URL(pageUrl);
    card.append(btn('פתיחה בכרום', true, () => (win.location.href = `intent://${u.host}${u.pathname}${u.search}${u.hash}#Intent;scheme=https;package=com.android.chrome;end`)));
  }
  const copyBtn = btn('העתקת הקישור לאתר', false, () => {
    navigator.clipboard?.writeText(pageUrl).then(
      () => (copyBtn.textContent = 'הועתק. הדביקו בדפדפן'),
      () => {},
    );
  });
  card.append(
    copyBtn,
    btn('המשך ל-Kick כאן', false, () => {
      close();
      go();
    }),
    btn('ביטול', false, close),
  );
  box.append(card);
  box.onclick = (e) => e.target === box && close();
  doc.body.append(box);
}

/** מעבר להתחברות עם Kick; בדמו – משתמש דמו מיידי (באדמין: הבעלים odedsvr) */
export function login(store: Store, demoName = 'צופה_דמו') {
  // בתוך ה-iframe של הטלפון: ההתחברות חייבת לרוץ בחלון הראשי. Google (ו-Kick) לא נפתחים בתוך iframe,
  // ולכן "המשך עם Google" נתקע שם. חוזרים לדף הראשי, וה-hash ‎#phone פותח את הטלפון שוב.
  const top = siteTop();
  const embedded = window.top !== window;
  const page = top ? top.location.href.split('#')[0] + (top.location.hash || '#phone') : location.href;
  const url = store.kickLoginUrl(page);
  if (url) {
    const go = () => {
      if (top) top.location.href = url;
      else if (embedded) window.open(url, '_blank', 'noopener');
      else location.href = url;
    };
    if (inAppBrowser()) inAppNotice(top ?? window, go, page);
    else go();
    return;
  }
  save({ token: 'demo', kick_user_id: `demo-${demoName}`, username: demoName, avatar: null });
}

export function logout() {
  setModSession(null);
  save(null);
}

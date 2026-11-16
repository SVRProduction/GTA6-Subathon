// מצב מוד בדפדפן: הטוקן שהונפק ע"י kick-mod (או הדמו), שם ה-Kick, והאם בעלים.
// משותף לכל העמודים (מפה, אדמין, טלפון). שינוי כאן משודר ב-'mod-change'.
export interface ModSession {
  token: string;
  /** פג תוקף, בשניות */
  exp: number;
  name: string;
  owner: boolean;
}

const KEY = 'mod-session';
/** הבעלים שמוגדרים מראש: תמיד מודים, ורק הם מנהלים את רשימת המודים (בנוסף לבעל הערוץ) */
export const DEFAULT_OWNERS = ['odedsvr', 'zswolt'];

/** שם משתמש של Kick נקי ובאותיות קטנות (Kick לא מבחין בין גדולות לקטנות) */
export const kickName = (s: string | null | undefined) => String(s ?? '').trim().replace(/^@/, '').replace(/^.*kick\.com\//i, '').replace(/[^A-Za-z0-9_-]/g, '').toLowerCase();

let cached: ModSession | null = null;
try {
  const raw = localStorage.getItem(KEY);
  cached = raw ? (JSON.parse(raw) as ModSession) : null;
} catch {
  cached = null;
}

export function getModSession(): ModSession | null {
  if (cached && cached.exp * 1000 > Date.now()) return cached;
  return null;
}

export function setModSession(s: ModSession | null) {
  cached = s;
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* חסום */
  }
  dispatchEvent(new CustomEvent('mod-change', { detail: s }));
}

// שינוי בלשונית אחרת (התחברות באדמין → המפה מתעדכנת)
addEventListener('storage', (e) => {
  if (e.key !== KEY) return;
  try {
    cached = e.newValue ? (JSON.parse(e.newValue) as ModSession) : null;
  } catch {
    cached = null;
  }
  dispatchEvent(new CustomEvent('mod-change', { detail: cached }));
});

export const onModChange = (f: (s: ModSession | null) => void) => {
  const h = () => f(getModSession());
  addEventListener('mod-change', h);
  return () => removeEventListener('mod-change', h);
};

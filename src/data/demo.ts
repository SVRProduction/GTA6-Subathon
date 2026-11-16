import { DEFAULT_SETTINGS, kickSlug, type Clip, type Comment, type CounterEvent, type Data, type LiveData, type Mission, type Store } from './types';

const KEY = 'journey-demo-v8';
const MAX_INLINE_FILE = 2 * 1024 * 1024;

// 70 עצירות דמו. בלי מיקום: הן מתמקמות לבד לאורך השביל (הכבישים) של המפה, מהדרום צפונה
const DEMO_N = 70;
const MILESTONES: Record<number, [string, string, string]> = {
  0: ['נוחתים באיים', 'משימת הפתיחה: מכירים את הדמויות על האי הדרומי', 'טוב, אז איך נוהגים פה?'],
  8: ['חוצים את הגשר', 'המרדף הראשון, על הגשר אל האי הגדול', 'זה לא באשמתי, הוא נכנס בי'],
  16: ['נכנסים לעיר', 'הכביש המהיר מגיע לשכונות הדרומיות', ''],
  24: ['השוד הגדול הראשון', 'תכנון, ביצוע ובריחה ברחובות מרכז העיר', 'יש לנו בדיוק שתי דקות. אחת וחצי.'],
  32: ['הבאג הכי מצחיק עד עכשיו', 'מכונית שעפה לשמיים ליד האגם', ''],
  40: ['יוצאים צפונה', 'עוזבים את העיר לכיוון שדה התעופה', ''],
  48: ['הבגידה', 'טוויסט בעלילה שאף אחד לא ציפה לו', 'ידעתי שאסור לסמוך עליו'],
  56: ['מקיפים את ההר', 'הכביש הצר שמעל הצוקים, בחוף הצפוני', ''],
  64: ['הלילה הארוך', 'משימה של שלוש שעות ברצף בעיירה שמתחת להר', 'עוד ניסיון אחד ואני הולך לישון'],
};
const chapterOf = (i: number) => (i < 16 ? 'האיים' : i < 36 ? 'העיר' : i < 54 ? 'הצפון' : 'ההר');

function seed(): Data {
  const start = Date.now() - 80 * 36e5; // 70 עצירות × 1.1 שעות – האחרונה קצת לפני עכשיו (לא בעתיד)
  const missions: Mission[] = Array.from({ length: DEMO_N }, (_, i) => {
    const ms = MILESTONES[i];
    const last = i === DEMO_N - 1;
    return {
      id: `demo-${i}`,
      order_index: i,
      title: ms ? ms[0] : last ? 'משימה נוכחית' : `משימה ${i + 1}`,
      summary: ms ? ms[1] : last ? 'כאן אנחנו נמצאים עכשיו בלייב' : 'עוד משימה בדרך',
      body: ms ? 'את הריקאפ המלא של הקטע כותבים בעמוד הניהול: מה קרה, למה זה חשוב לעלילה, ומה צריך לדעת כדי להמשיך לצפות.' : '',
      kind: i % 11 === 5 ? 'moment' : 'mission',
      is_milestone: !!ms,
      happened_at: new Date(start + i * 1.1 * 36e5).toISOString(),
      stream_day: 1 + Math.floor(i / 24),
      recap_url: ms ? 'https://kick.com' : null,
      download_url: null,
      image_url: null,
      map_x: null,
      map_y: null,
      chapter: chapterOf(i),
      quote: ms && ms[2] ? ms[2] : null,
      quote_by: ms && ms[2] ? 'הסטרימר' : null,
    };
  });
  return {
    missions,
    settings: { ...DEFAULT_SETTINGS, started_at: new Date(start).toISOString(), is_live: true },
  };
}

function read(): Data {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw) as Data;
      d.settings = { ...DEFAULT_SETTINGS, ...d.settings };
      const blank = { map_x: null, map_y: null, chapter: null, quote: null, quote_by: null };
      d.missions = d.missions.map((m) => Object.assign({}, blank, m));
      return d;
    }
  } catch {
    /* localStorage חסום – ממשיכים עם נתוני הדוגמה */
  }
  return seed();
}

// ── לייב בדמו: שידור שרץ כבר שלושה ימים (עם הפסקות שינה), ספירות לכל משימה, וקליפים אמיתיים מהערוץ ──
const LIVE_KEY = `${KEY}-live`;
function readCounters(d: Data): CounterEvent[] {
  try {
    const raw = localStorage.getItem(LIVE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* חסום */
  }
  // זריעה קבועה: כמה מיתות וחתולים לכל משימה
  const out: CounterEvent[] = [];
  d.missions.forEach((m, i) => {
    const deaths = (i * 7 + 3) % 5 === 0 ? 3 : (i * 13) % 4 === 0 ? 1 : (i * 5) % 7 === 0 ? 2 : 0;
    const cats = (i * 11) % 9 === 0 ? 1 : 0;
    for (let k = 0; k < deaths; k++) out.push({ counter: 'deaths', delta: 1, mission_id: m.id, created_at: m.happened_at ?? new Date().toISOString() });
    for (let k = 0; k < cats; k++) out.push({ counter: 'cats', delta: 1, mission_id: m.id, created_at: m.happened_at ?? new Date().toISOString() });
  });
  return out;
}
function demoSegments(d: Data) {
  const start = Date.parse(d.settings.started_at ?? new Date(Date.now() - 3 * 864e5).toISOString());
  const now = Date.now();
  const segs = [];
  // כל יום: 18 שעות משחק, 6 שעות הפסקה; היום הנוכחי עדיין רץ
  for (let t = start; t < now; t += 24 * 36e5) {
    const end = Math.min(t + 18 * 36e5, now - 60_000);
    if (end > t) segs.push({ started_at: new Date(t).toISOString(), ended_at: new Date(end).toISOString() });
  }
  return segs;
}
let clipCache: { slug: string; clips: Clip[] } | null = null;
/** קליפים אמיתיים מהערוץ, ישר מהדפדפן (בדמו: מכל הקטגוריות, כי עוד אין קליפים מהמשחק) */
async function fetchClips(slug: string): Promise<Clip[]> {
  if (clipCache?.slug === slug) return clipCache.clips;
  try {
    const r = await fetch(`https://kick.com/api/v2/channels/${slug}/clips?sort=date&time=all`, { headers: { Accept: 'application/json' } });
    const j = await r.json();
    const clips: Clip[] = (j.clips ?? []).map((c: Record<string, any>) => ({
      id: c.id,
      title: c.title ?? '',
      thumbnail_url: c.thumbnail_url ?? null,
      video_url: c.video_url ?? c.clip_url ?? null,
      duration: c.duration ?? null,
      views: c.views ?? c.view_count ?? 0,
      creator: c.creator?.username ?? null,
      created_at: c.created_at,
    }));
    clipCache = { slug, clips };
    return clips;
  } catch {
    return [];
  }
}

// ── תגובות בדמו ──
const COMMENTS_KEY = `${KEY}-comments`;
const DEMO_FANS = [['עומרי_77', 'אחי איך פספסת את הפנייה הזאת 😂'], ['NoaPlays', 'הקטע הכי טוב בסאבתון עד עכשיו'], ['dan.gg', 'הצ׳אט ידע לפניך'], ['Lior_kick', 'עוד ניסיון אחד וזה עובר, מבטיח'], ['ShaharTV', 'המוזיקה ברקע פה מושלמת']];
function readComments(d: Data): Comment[] {
  try {
    const raw = localStorage.getItem(COMMENTS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* חסום */
  }
  // כמה תגובות דמו על המיילסטונים
  const out: Comment[] = [];
  d.missions.forEach((m, i) => {
    if (!m.is_milestone) return;
    const n = 1 + (i % 3);
    for (let k = 0; k < n; k++) {
      const [user, body] = DEMO_FANS[(i + k) % DEMO_FANS.length];
      out.push({ id: `demo-c-${i}-${k}`, target_type: 'stop', target_id: m.id, kick_user_id: `demo-${user}`, username: user, avatar: null, body, created_at: new Date(Date.parse(m.happened_at ?? new Date().toISOString()) + (k + 1) * 9 * 60_000).toISOString(), hidden: false });
    }
  });
  return out;
}

export function createDemoStore(): Store {
  const listeners = new Set<(d: Data) => void>();
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel(KEY) : null;
  const emit = () => {
    const d = read();
    listeners.forEach((l) => l(d));
  };
  channel?.addEventListener('message', (e) => e.data !== 'live' && emit());

  const write = (d: Data) => {
    d.missions.sort((a, b) => a.order_index - b.order_index);
    try {
      localStorage.setItem(KEY, JSON.stringify(d));
    } catch {
      throw new Error('אין מקום בזיכרון הדפדפן (מצב דמו). נסה קובץ קטן יותר או קישור.');
    }
    channel?.postMessage(1);
    emit();
  };

  const liveListeners = new Set<(d: LiveData) => void>();
  async function loadLive(): Promise<LiveData> {
    const d = read();
    const live = !document.documentElement.dataset.demoOffline;
    return {
      status: { is_live: live, on_category: live, category: d.settings.kick_category, title: 'סאבתון GTA 6 – יום 3', viewers: 2140, checked_at: new Date().toISOString() },
      segments: demoSegments(d),
      counters: readCounters(d),
      recent: [...readCounters(d)].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 80),
      clips: await fetchClips(kickSlug(d.settings.kick_channel || 'odedsvr')),
      demoClips: true,
    };
  }
  const emitLive = () => loadLive().then((l) => liveListeners.forEach((f) => f(l)));
  channel?.addEventListener('message', (e) => e.data === 'live' && emitLive());

  const commentListeners = new Set<(c: Comment[], all: boolean) => void>();
  const writeComments = (list: Comment[]) => {
    try {
      localStorage.setItem(COMMENTS_KEY, JSON.stringify(list));
    } catch {
      /* חסום */
    }
    channel?.postMessage('comments');
    emitComments();
  };
  function emitComments() {
    const all = readComments(read());
    commentListeners.forEach((f) => (f as any)(all));
  }
  channel?.addEventListener('message', (e) => e.data === 'comments' && emitComments());
  let lastPost = 0;

  return {
    mode: 'demo',
    async loadComments(includeHidden = false) {
      const all = readComments(read());
      return includeHidden ? all : all.filter((c) => !c.hidden);
    },
    subscribeComments(cb, includeHidden = false) {
      const f = (all: Comment[]) => cb(includeHidden ? all : all.filter((c) => !c.hidden));
      commentListeners.add(f as any);
      return () => commentListeners.delete(f as any);
    },
    async postComment(viewer, target, targetId, body) {
      const text = body.trim().slice(0, 500);
      if (!text) throw new Error('אי אפשר לשלוח תגובה ריקה');
      if (Date.now() - lastPost < 15_000) throw new Error('רגע, אפשר להגיב פעם ב-15 שניות');
      lastPost = Date.now();
      const all = readComments(read());
      all.push({ id: crypto.randomUUID(), target_type: target, target_id: targetId, kick_user_id: viewer.kick_user_id, username: viewer.username, avatar: viewer.avatar, body: text, created_at: new Date().toISOString(), hidden: false });
      writeComments(all);
    },
    async moderateComment(id, action) {
      let all = readComments(read());
      if (action === 'delete') all = all.filter((c) => c.id !== id);
      else all = all.map((c) => (c.id === id ? { ...c, hidden: action === 'hide' } : c));
      writeComments(all);
    },
    async banUser(kickUserId) {
      writeComments(readComments(read()).map((c) => (c.kick_user_id === kickUserId ? { ...c, hidden: true } : c)));
    },
    kickLoginUrl() {
      return null;
    },
    loadLive,
    subscribeLive(cb) {
      liveListeners.add(cb);
      const t = window.setInterval(emitLive, 60_000);
      return () => {
        liveListeners.delete(cb);
        clearInterval(t);
      };
    },
    async bump(counter, delta, missionId) {
      const d = read();
      const list = readCounters(d);
      list.push({ counter, delta, mission_id: missionId, created_at: new Date().toISOString() });
      try {
        localStorage.setItem(LIVE_KEY, JSON.stringify(list));
      } catch {
        /* חסום */
      }
      channel?.postMessage('live');
      emitLive();
    },
    async load() {
      return read();
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    async saveMission(m) {
      const d = read();
      const i = d.missions.findIndex((x) => x.id === m.id);
      if (i >= 0) d.missions[i] = m;
      else d.missions.push(m);
      write(d);
    },
    async deleteMission(id) {
      const d = read();
      d.missions = d.missions.filter((m) => m.id !== id);
      if (d.settings.current_mission_id === id) d.settings.current_mission_id = null;
      write(d);
    },
    async swap(a, b) {
      const d = read();
      const x = d.missions.find((m) => m.id === a.id);
      const y = d.missions.find((m) => m.id === b.id);
      if (!x || !y) return;
      [x.order_index, y.order_index] = [y.order_index, x.order_index];
      write(d);
    },
    async saveSettings(s) {
      const d = read();
      d.settings = s;
      write(d);
    },
    upload(file) {
      if (file.size > MAX_INLINE_FILE)
        return Promise.reject(new Error('במצב דמו אפשר להעלות קבצים עד 2MB. אחרי חיבור Supabase המגבלה היא 50MB.'));
      return new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.onerror = () => rej(new Error('קריאת הקובץ נכשלה'));
        r.readAsDataURL(file);
      });
    },
    async isAuthed() {
      return true;
    },
    async signIn() {},
    async signOut() {},
  };
}

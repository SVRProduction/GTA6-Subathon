import { DEFAULT_SETTINGS, kickSlug, type Clip, type Comment, type CounterEvent, type Data, type Extras, type LiveData, type Marker, type Mission, type Poll, type Store, type Story } from './types';

const KEY = 'journey-demo-v9';
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

// ── מרקרים, סטוריז וסקרים בדמו ──
// v2: איפוס המרקרים לכל מי שכבר ביקר (תחילת הסאבתון)
const EXTRAS_KEY = `${KEY}-extras-v2`;
const B = import.meta.env.BASE_URL;
interface DemoExtras extends Extras {
  /** pollId → kick_user_id → אפשרות */
  ballots: Record<string, Record<string, number>>;
  /** storyId → kick_user_ids שעשו לייק */
  likers: Record<string, string[]>;
}
function seedExtras(d: Data): DemoExtras {
  const at = (i: number, min = 5) => new Date(Date.parse(d.missions[Math.min(i, d.missions.length - 1)]?.happened_at ?? new Date().toISOString()) + min * 60_000).toISOString();
  const mid = (i: number) => d.missions[Math.min(i, d.missions.length - 1)]?.id ?? null;
  const mk = (id: string, type: Marker['type'], x: number, y: number, title: string, i: number, extra: Partial<Marker> = {}): Marker => ({ id, type, x, y, title, body: '', emoji: null, image_url: null, mission_id: mid(i), created_at: at(i), ...extra });
  // הסאבתון התחיל: בלי מרקרים מהדמו. כל מרקר מתווסף במצב עריכה
  const markers: Marker[] = [];
  const now = Date.now();
  const st = (id: string, user: string, img: string, caption: string, i: number, hoursAgo: number, likes: number, status: Story['status'] = 'approved'): Story => ({
    id, kick_user_id: `demo-${user}`, username: user, avatar: null, image_url: `${B}demo/${img}`, caption, mission_id: mid(i), x: null, y: null, status, likes,
    created_at: new Date(now - hoursAgo * 36e5).toISOString(), expires_at: new Date(now - hoursAgo * 36e5 + 48 * 36e5).toISOString(),
  });
  const stories: Story[] = [
    st('ds-1', 'NoaPlays', 'story-1.jpg', 'השקיעה מהגשר בדיוק כשעודד נפל 😂', 4, 30, 41),
    st('ds-2', 'dan.gg', 'story-2.jpg', 'צילמתי את הרגע שהצ׳אט ניצח בסקר', 52, 6, 88),
    st('ds-3', 'עומרי_77', 'story-3.jpg', 'האי הצפוני מלמעלה, מטורף', 60, 2, 23),
    st('ds-4', 'Lior_kick', 'story-4.jpg', 'מי עוד חושב שהוא צריך לחזור לעיר?', 66, 0.5, 9, 'pending'),
  ];
  const polls: Poll[] = [
    { id: 'dp-1', question: 'לאן נוסעים עכשיו?', options: ['חוזרים לעיר', 'ממשיכים להר', 'לים, ליאכטה'], x: 0.3, y: 0.24, status: 'open', ends_at: new Date(now + 9 * 60_000).toISOString(), winner: null, created_at: new Date(now - 3 * 60_000).toISOString(), votes: [214, 388, 131] },
  ];
  return { markers, stories, polls, ballots: {}, likers: {} };
}
function readExtras(d: Data): DemoExtras {
  try {
    const raw = localStorage.getItem(EXTRAS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* חסום */
  }
  return seedExtras(d);
}
/** תמונה של סטורי בדמו: מוקטנת ל-JPEG קטן (נכנס ל-localStorage) */
async function shrink(file: File, max = 720): Promise<string> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.78);
}

export function createDemoStore(): Store {
  const listeners = new Set<(d: Data) => void>();
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel(KEY) : null;
  const emit = () => {
    const d = read();
    listeners.forEach((l) => l(d));
  };
  channel?.addEventListener('message', (e) => e.data !== 'live' && e.data !== 'comments' && e.data !== 'extras' && emit());

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

  // ── מרקרים / סטוריז / סקרים ──
  const extraListeners = new Set<(e: DemoExtras) => void>();
  const emitExtras = () => {
    const e = readExtras(read());
    extraListeners.forEach((f) => f(e));
  };
  const writeExtras = (e: DemoExtras) => {
    try {
      localStorage.setItem(EXTRAS_KEY, JSON.stringify(e));
    } catch {
      throw new Error('אין מקום בזיכרון הדפדפן (מצב דמו). נסו תמונה קטנה יותר.');
    }
    channel?.postMessage('extras');
    emitExtras();
  };
  channel?.addEventListener('message', (e) => e.data === 'extras' && emitExtras());
  const view = (e: DemoExtras, mod: boolean): Extras => ({ markers: e.markers, stories: mod ? e.stories : e.stories.filter((s) => s.status === 'approved'), polls: e.polls });
  /** סקר שעבר הזמן שלו: נסגר, נקבע מנצח, ואם יש לו מיקום – נוצר מרקר "החלטה" */
  function settle(e: DemoExtras, p: Poll) {
    if (p.status === 'closed') return;
    p.status = 'closed';
    p.ends_at = new Date(Math.min(Date.parse(p.ends_at), Date.now())).toISOString();
    const best = Math.max(...p.votes);
    p.winner = best > 0 ? p.votes.indexOf(best) : null;
    if (p.winner != null && p.x != null && p.y != null) {
      const total = p.votes.reduce((a, b) => a + b, 0) || 1;
      const d = read();
      e.markers.push({ id: crypto.randomUUID(), type: 'decision', x: p.x, y: p.y, title: `הצ׳אט החליט: ${p.options[p.winner]}`, body: `סקר: "${p.question}" – "${p.options[p.winner]}" ניצח עם ${Math.round((best / total) * 100)}% מהקולות.`, emoji: null, image_url: null, mission_id: d.missions[d.missions.length - 1]?.id ?? null, created_at: new Date().toISOString() });
    }
  }
  // סגירה אוטומטית של סקרים שהזמן שלהם נגמר (בשרת עושה את זה kick-sync)
  window.setInterval(() => {
    const e = readExtras(read());
    const due = e.polls.filter((p) => p.status === 'open' && Date.parse(p.ends_at) <= Date.now());
    if (!due.length) return;
    due.forEach((p) => settle(e, p));
    writeExtras(e);
  }, 5000);
  let lastStory = 0;

  return {
    mode: 'demo',
    async loadExtras(mod = false) {
      return view(readExtras(read()), mod);
    },
    subscribeExtras(cb, mod = false) {
      const f = (e: DemoExtras) => cb(view(e, mod));
      extraListeners.add(f);
      return () => extraListeners.delete(f);
    },
    async saveMarker(m) {
      const e = readExtras(read());
      const i = e.markers.findIndex((x) => x.id === m.id);
      if (i >= 0) e.markers[i] = m;
      else e.markers.push(m);
      writeExtras(e);
    },
    async deleteMarker(id) {
      const e = readExtras(read());
      e.markers = e.markers.filter((m) => m.id !== id);
      writeExtras(e);
    },
    async submitStory(viewer, draft) {
      if (!draft.image?.type.startsWith('image/')) throw new Error('צריך לבחור תמונה');
      if (Date.now() - lastStory < 60_000) throw new Error('אפשר להעלות סטורי אחד בדקה');
      const image_url = await shrink(draft.image);
      lastStory = Date.now();
      const e = readExtras(read());
      e.stories.push({ id: crypto.randomUUID(), kick_user_id: viewer.kick_user_id, username: viewer.username, avatar: viewer.avatar, image_url, caption: draft.caption.trim().slice(0, 160), mission_id: draft.mission_id, x: draft.x, y: draft.y, status: 'pending', likes: 0, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 48 * 36e5).toISOString() });
      writeExtras(e);
    },
    async likeStory(viewer, id) {
      const e = readExtras(read());
      const s = e.stories.find((x) => x.id === id);
      if (!s) return;
      const who = (e.likers[id] ??= []);
      if (who.includes(viewer.kick_user_id)) return;
      who.push(viewer.kick_user_id);
      s.likes++;
      writeExtras(e);
    },
    async moderateStory(id, action) {
      const e = readExtras(read());
      if (action === 'delete') e.stories = e.stories.filter((s) => s.id !== id);
      else e.stories = e.stories.map((s) => (s.id === id ? { ...s, status: action === 'approve' ? 'approved' : 'rejected' } : s));
      writeExtras(e);
    },
    async createPoll(p) {
      const opts = p.options.map((o) => o.trim()).filter(Boolean).slice(0, 4);
      if (!p.question.trim() || opts.length < 2) throw new Error('צריך שאלה ולפחות 2 אפשרויות');
      const e = readExtras(read());
      // סקר אחד פתוח בכל פעם: הקודם נסגר
      e.polls.filter((x) => x.status === 'open').forEach((x) => settle(e, x));
      e.polls.push({ id: crypto.randomUUID(), question: p.question.trim(), options: opts, x: p.x, y: p.y, status: 'open', ends_at: new Date(Date.now() + Math.max(1, p.minutes) * 60_000).toISOString(), winner: null, created_at: new Date().toISOString(), votes: opts.map(() => 0) });
      writeExtras(e);
    },
    async closePoll(id) {
      const e = readExtras(read());
      const p = e.polls.find((x) => x.id === id);
      if (p) settle(e, p);
      writeExtras(e);
    },
    async deletePoll(id) {
      const e = readExtras(read());
      e.polls = e.polls.filter((x) => x.id !== id);
      writeExtras(e);
    },
    async vote(viewer, pollId, option) {
      const e = readExtras(read());
      const p = e.polls.find((x) => x.id === pollId);
      if (!p || p.status !== 'open' || Date.parse(p.ends_at) <= Date.now()) throw new Error('הסקר כבר נסגר');
      if (option < 0 || option >= p.options.length) throw new Error('אפשרות לא קיימת');
      const b = (e.ballots[pollId] ??= {});
      const prev = b[viewer.kick_user_id];
      if (prev === option) return;
      if (prev != null) p.votes[prev] = Math.max(0, p.votes[prev] - 1);
      b[viewer.kick_user_id] = option;
      p.votes[option]++;
      writeExtras(e);
    },
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

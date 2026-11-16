export type Kind = 'mission' | 'moment';

export interface Mission {
  id: string;
  order_index: number;
  title: string;
  summary: string;
  body: string;
  kind: Kind;
  is_milestone: boolean;
  happened_at: string | null;
  stream_day: number | null;
  recap_url: string | null;
  download_url: string | null;
  image_url: string | null;
  /** מיקום על תמונת המפה, 0–1 (null = מיקום אוטומטי) */
  map_x: number | null;
  map_y: number | null;
  /** פרק בעלילה – מקבץ את העצירות בפס הפרקים */
  chapter: string | null;
  quote: string | null;
  quote_by: string | null;
}

export interface Settings {
  title: string;
  kick_channel: string;
  started_at: string | null;
  current_mission_id: string | null;
  is_live: boolean;
  /** תמונת המפה שהועלתה (null = מפת הדמה) */
  map_image_url: string | null;
  /** כמה קרוב המצלמה במסע (1 = כל המפה ברוחב המסך) */
  map_zoom: number;
  /** הקטגוריה ב-Kick שנספרת כזמן משחק ושממנה נלקחים קליפים */
  kick_category: string;
}

/** הסטטוס האחרון שנבדק מול Kick (כל 2 דקות) */
export interface LiveStatus {
  is_live: boolean;
  on_category: boolean;
  category: string | null;
  title: string | null;
  viewers: number | null;
  checked_at: string | null;
}

/** מקטע זמן שבו שיחק בקטגוריה */
export interface Segment {
  started_at: string;
  ended_at: string;
}

export type CounterName = 'deaths' | 'cats';
export interface CounterEvent {
  counter: CounterName;
  delta: number;
  mission_id: string | null;
  created_at: string;
}

export interface Clip {
  id: string;
  title: string;
  thumbnail_url: string | null;
  video_url: string | null;
  duration: number | null;
  views: number;
  creator: string | null;
  created_at: string;
}

/** תגובה של צופה (מחובר עם Kick) על עצירה או על קליפ */
export type CommentTarget = 'stop' | 'clip';
export interface Comment {
  id: string;
  target_type: CommentTarget;
  target_id: string;
  kick_user_id: string;
  username: string;
  avatar: string | null;
  body: string;
  created_at: string;
  hidden?: boolean;
}
/** מי שמחובר עם Kick (נשמר בדפדפן; הכרטיס חתום בשרת) */
export interface Viewer {
  token: string;
  kick_user_id: string;
  username: string;
  avatar: string | null;
}

export interface LiveData {
  status: LiveStatus | null;
  segments: Segment[];
  counters: CounterEvent[];
  clips: Clip[];
  /** בדמו: הקליפים הם מהערוץ האמיתי, מכל הקטגוריות (כי עוד אין קליפים מהמשחק) */
  demoClips?: boolean;
}

export interface Data {
  missions: Mission[];
  settings: Settings;
}

export interface Store {
  mode: 'demo' | 'supabase';
  load(): Promise<Data>;
  /** קורא ל-cb בכל פעם שהנתונים השתנו (גם ממכשיר אחר) */
  subscribe(cb: (d: Data) => void): () => void;
  saveMission(m: Mission): Promise<void>;
  deleteMission(id: string): Promise<void>;
  /** מחליף מיקום בין שתי נקודות */
  swap(a: Mission, b: Mission): Promise<void>;
  saveSettings(s: Settings): Promise<void>;
  upload(file: File): Promise<string>;
  isAuthed(): Promise<boolean>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  /** לייב, זמן משחק, ספירות וקליפים */
  loadLive(): Promise<LiveData>;
  subscribeLive(cb: (d: LiveData) => void): () => void;
  /** +1 / -1 למונה, משויך לעצירה הנוכחית */
  bump(counter: CounterName, delta: 1 | -1, missionId: string | null): Promise<void>;
  /** תגובות: כולם קוראים; כותבים רק מחוברים עם Kick (דרך הפונקציה kick-comment) */
  loadComments(includeHidden?: boolean): Promise<Comment[]>;
  subscribeComments(cb: (c: Comment[]) => void, includeHidden?: boolean): () => void;
  postComment(viewer: Viewer, target: CommentTarget, targetId: string, body: string): Promise<void>;
  /** אדמין: הסתרה/החזרה, מחיקה, חסימת משתמש */
  moderateComment(id: string, action: 'hide' | 'show' | 'delete'): Promise<void>;
  banUser(kickUserId: string, username: string): Promise<void>;
  /** כתובת ההתחברות עם Kick (null = לא מוגדר; בדמו מתחברים כמשתמש דמו) */
  kickLoginUrl(returnTo: string): string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  title: 'סאבתון GTA 6',
  kick_channel: 'odedsvr',
  started_at: null,
  current_mission_id: null,
  is_live: false,
  map_image_url: null,
  map_zoom: 3,
  kick_category: 'grand-theft-auto-vi',
};

export function newMission(order_index: number): Mission {
  return {
    id: crypto.randomUUID(),
    order_index,
    title: '',
    summary: '',
    body: '',
    kind: 'mission',
    is_milestone: false,
    happened_at: new Date().toISOString(),
    stream_day: null,
    recap_url: null,
    download_url: null,
    image_url: null,
    map_x: null,
    map_y: null,
    chapter: null,
    quote: null,
    quote_by: null,
  };
}

/** האינדקס של "אתה כאן": המשימה שסומנה כנוכחית, או האחרונה */
export function currentIndex(d: Data): number {
  const i = d.missions.findIndex((m) => m.id === d.settings.current_mission_id);
  return i >= 0 ? i : d.missions.length - 1;
}

/** כתובת הערוץ ב-Kick מתוך מה שהוקלד (שם או קישור) */
export const kickSlug = (s: string) => s.trim().replace(/^.*kick\.com\//, '').replace(/[^\w-]/g, '').toLowerCase() || 'odedsvr';

/** הסטטוס עדכני? (אם הבדיקות נעצרו – לא מציגים "בלייב" שנתקע) */
export const statusFresh = (s: LiveStatus | null, now = Date.now()) => !!s?.checked_at && now - Date.parse(s.checked_at) < 6 * 60_000;

/** זמן משחק כולל במילישניות, עד רגע מסוים (ברירת מחדל: עכשיו). המקטע האחרון "מתקתק" אם עדיין משחק */
export function playMs(d: LiveData, until = Date.now()) {
  let ms = 0;
  const live = d.status?.on_category && statusFresh(d.status, until);
  d.segments.forEach((g, i) => {
    const a = Date.parse(g.started_at);
    let b = Date.parse(g.ended_at);
    if (live && i === d.segments.length - 1) b = Math.max(b, Math.min(until, b + 6 * 60_000));
    if (a < until) ms += Math.max(0, Math.min(b, until) - a);
  });
  return ms;
}

/** סכום מונה, כולל או לעצירה אחת */
export const countOf = (d: LiveData, c: CounterName, missionId?: string) =>
  Math.max(0, d.counters.reduce((n, e) => n + (e.counter === c && (missionId == null || e.mission_id === missionId) ? e.delta : 0), 0));

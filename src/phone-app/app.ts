// גרסה 4 · Stories – האתר כאפליקציה לטלפון: בית עם סטוריז, מפה, פיד קליפים ומספרים.
// המפה והמספרים הם הדפים הקיימים (index.html?embed / phone-stats.html) בתוך הטאבים, כך שהמנוע לא משוכפל.
import { initPush } from './push';
import { ChartColumnBig, Clapperboard, ExternalLink, Heart, House, Map as MapIco, MapPin, MessageCircle, Play, Share2, Volume2, VolumeX, X, createElement, type IconNode } from 'lucide';
import { getViewer, login, loginError, loginErrorText, onViewer } from '../auth';
import { playClip, stopClipThumb } from '../clips';
import { commentCount, commentsBox, initComments } from '../comments';
import { createStore } from '../data/store';
import { COUNTERS, countOf, currentIndex, kickSlug, playMs, statusFresh, type Clip, type Data, type LikeTarget, type LiveData, type Mission } from '../data/types';
import { fill, h, safeUrl } from '../dom';
import { videoEmbed } from '../journey/content';
import { makeTrail, placeAll, type Pt } from '../journey/route';
import { fmtPlay } from '../live';

const store = createStore();
const B = import.meta.env.BASE_URL;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;

const ICONS: Record<string, IconNode> = { House, Map: MapIco, Clapperboard, ChartColumnBig };
function ico(node: IconNode, size = 22) {
  const el = createElement(node);
  el.setAttribute('width', String(size));
  el.setAttribute('height', String(size));
  el.setAttribute('stroke-width', '2');
  el.setAttribute('aria-hidden', 'true');
  return el;
}
document.querySelectorAll<HTMLElement>('[data-ico]').forEach((s) => s.append(ico(ICONS[s.dataset.ico!])));

// ── מצב ──
let data: Data | null = null;
let live: LiveData | null = null;
let pos: Pt[] = []; // מיקום כל עצירה על המפה (0–1)
const mapImg = new Image();
mapImg.crossOrigin = 'anonymous';
let trailRaw: Array<[number, number]> | null = null;

let toastTimer = 0;
function toast(t: string) {
  const el = $('#toast');
  el.textContent = t;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 3200);
}

const num = (n: number) => n.toLocaleString('he-IL');

// ── לייקים: כל מי שמחובר עם Kick. מה שאהבו יותר עולה למעלה (כמו פיד של טיקטוק) ──
let likes: Record<string, number> = {};
let mine = new Set<string>();
const likeKey = (t: LikeTarget, id: string) => `${t}:${id}`;
const likesOf = (t: LikeTarget, id: string) => likes[likeKey(t, id)] ?? 0;
/** ציון לסידור: לייקים, ובונוס קטן לחדש שדועך תוך יום-יומיים */
const score = (t: LikeTarget, id: string, iso: string | null) => {
  const age = Date.now() - Date.parse(iso ?? '');
  return likesOf(t, id) + (Number.isFinite(age) ? 4 * Math.exp(-Math.max(0, age) / (36 * 3600_000)) : 0);
};
async function refreshLikes() {
  likes = await store.loadLikes().catch(() => likes);
  const v = getViewer();
  mine = new Set(v ? await store.myLikes(v).catch(() => [...mine]) : []);
  document.querySelectorAll<HTMLElement>('[data-like]').forEach(paintLike);
}
function paintLike(b: HTMLElement) {
  const [t, ...rest] = b.dataset.like!.split(':');
  const id = rest.join(':');
  const on = mine.has(likeKey(t as LikeTarget, id));
  b.classList.toggle('is-liked', on);
  b.setAttribute('aria-pressed', String(on));
  const n = likesOf(t as LikeTarget, id);
  const span = b.querySelector('span');
  if (span) span.textContent = n ? num(n) : b.classList.contains('pill') ? 'לייק' : '';
}
function likeBtn(t: LikeTarget, id: string, cls: string, size = 22) {
  const b = h('button', { className: `${cls} like`, type: 'button', ariaLabel: 'לייק' }, ico(Heart, size), h('span', {}, ''));
  b.dataset.like = likeKey(t, id);
  b.onclick = async (e) => {
    e.stopPropagation();
    const v = getViewer();
    if (!v) {
      // לא מחובר: ישר להתחברות עם Kick (חוזרים לאותו מקום)
      login(store);
      return;
    }
    const k = likeKey(t, id);
    const was = mine.has(k);
    // מיד על המסך, ואז מהשרת
    if (was) mine.delete(k);
    else mine.add(k);
    likes[k] = Math.max(0, likesOf(t, id) + (was ? -1 : 1));
    document.querySelectorAll<HTMLElement>(`[data-like="${CSS.escape(k)}"]`).forEach(paintLike);
    try {
      const r = await store.toggleLike(v, t, id);
      likes[k] = r.n;
      if (r.liked) mine.add(k);
      else mine.delete(k);
    } catch (err) {
      if (was) mine.add(k);
      else mine.delete(k);
      likes[k] = Math.max(0, likesOf(t, id) + (was ? 1 : -1));
      const msg = (err as Error).message;
      // השרת עוד לא עודכן (supabase/update-likes-counters.sql + פריסת kick-viewer)
      toast(/לא מוכרת|toggle_like|like_totals|function/i.test(msg) ? 'הלייקים נפתחים ממש בקרוב ❤️' : msg);
      if (/להתחבר מחדש/.test(msg)) login(store);
    }
    document.querySelectorAll<HTMLElement>(`[data-like="${CSS.escape(k)}"]`).forEach(paintLike);
  };
  paintLike(b);
  return b;
}
onViewer(() => void refreshLikes());

// ── קליפים כלליים של GTA (הטריילרים הרשמיים של Rockstar ביוטיוב), אחרי הקליפים מהלייב ──
const GTA_CLIPS: Clip[] = [
  ['VQRLujxTm3c', 'Grand Theft Auto VI · טריילר 2', '2025-05-06T15:00:00Z'],
  ['QdBZY2fkU-0', 'Grand Theft Auto VI · טריילר 1', '2023-12-05T00:00:00Z'],
  ['N-xHcvug3WI', 'GTA V · סרטון הגיימפליי הרשמי', '2013-07-09T00:00:00Z'],
  ['QkkoHAzjnUs', 'GTA V · הטריילר', '2012-11-14T00:00:00Z'],
].map(([id, title, at]) => ({ id: `yt-${id}`, title, thumbnail_url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, video_url: `youtube:${id}`, duration: null, views: 0, creator: 'Rockstar Games', created_at: at }));
// ── קליפים נבחרים מהערוץ של עודד (מכל המשחקים). רשימה ידנית: כאן מוסיפים/מורידים לפי ה-id מ-Kick ──
const CHANNEL_PICKS = [
  'clip_01KSZ43CTQQ94BN1E17F6PBN67', // דה לגנדרי דו פותחים בוסטר גיימס
  'clip_01JANV81GGEGY0ZEWG7QRATM10', // בושות
  'clip_01JANV7ZGH653CWYNKVPGCHB3Y', // איזה ביזוי
  'clip_01JADEDQBD9HFRHYMWRNNST1VP', // המסך שלי
  'clip_01JAJSYN64286MMSXS9PGA9RSZ', // תודה רבה עודד
  'clip_01KM4MHBDP67T8WBDSX56Z48JK', // עודד חושף איך יקרא לילד שלו
  'clip_01KNM7V83JKQ2Y4WE4RYYCSVQ0', // אשתו של עודד
];
let channelClips: Clip[] = [];
/** הקליפים נמשכים ישר מ-Kick (כדי שהקישור לווידאו יהיה טרי) */
async function loadChannelClips(slug: string) {
  try {
    const r = await fetch(`https://kick.com/api/v2/channels/${slug}/clips?sort=view&time=all`, { headers: { Accept: 'application/json' } });
    const j = await r.json();
    const byId = new Map<string, Record<string, any>>((j.clips ?? []).map((c: Record<string, any>) => [c.id, c]));
    channelClips = CHANNEL_PICKS.map((id) => byId.get(id))
      .filter((c): c is Record<string, any> => !!c && !!(c.video_url ?? c.clip_url))
      .map((c) => ({ id: c.id, title: c.title ?? '', thumbnail_url: c.thumbnail_url ?? null, video_url: c.video_url ?? c.clip_url, duration: c.duration ?? null, views: c.views ?? c.view_count ?? 0, creator: c.creator?.username ?? null, created_at: c.created_at }));
    if (tab === 'clips') renderClips();
    if (story.hidden) renderHome();
  } catch {
    /* Kick לא ענה – נשארים עם מה שיש */
  }
}
const isPick = (c: Clip) => channelClips.some((x) => x.id === c.id);
/** כל הקליפים בפיד: מהלייב (GTA 6), נבחרים מהערוץ, ואז הטריילרים של Rockstar – לפי לייקים וטריות */
function allClips(): Clip[] {
  const lv = (live?.clips ?? []).map((c, k) => ({ c, s: score('clip', c.id, c.created_at) + 1 - k * 0.01 }));
  const seen = new Set(lv.map((x) => x.c.id));
  const ch = channelClips.filter((c) => !seen.has(c.id)).map((c, k) => ({ c, s: likesOf('clip', c.id) - 0.2 - k * 0.01 }));
  const yt = GTA_CLIPS.map((c, k) => ({ c, s: likesOf('clip', c.id) - 0.5 - k * 0.01 }));
  // הטריילרים של GTA משולבים בתוך הפיד: אחרי הקליפ הראשון ואז אחד כל 3 קליפים (בסוף הרשימה הם נקברו מתחת לקליפים מהלייב)
  const base = [...lv.sort((a, b) => b.s - a.s), ...ch.sort((a, b) => b.s - a.s)];
  const ytQ = yt.sort((a, b) => b.s - a.s);
  const out: typeof base = [];
  base.forEach((x, i) => {
    out.push(x);
    if ((i === 0 || i % 3 === 0) && ytQ.length) out.push(ytQ.shift()!);
  });
  return [...out, ...ytQ].map((x) => x.c);
}
const isLive = () => !!data && !!live && (statusFresh(live.status) ? !!live.status?.is_live : data.settings.is_live);
const onGame = () => !!live && statusFresh(live.status) && !!live.status?.on_category;
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const ago = (iso: string | null) => {
  if (!iso) return '';
  const m = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (m < 60) return `לפני ${m} דק'`;
  if (m < 1440) return `לפני ${Math.round(m / 60)} שע'`;
  const d = Math.round(m / 1440);
  return d === 1 ? 'אתמול' : `לפני ${d} ימים`;
};

// ── צילום המפה במקום של עצירה (רקע לסטורי ולכרטיסים) ──
function computePositions() {
  if (!data || !mapImg.naturalWidth) return;
  const trail = trailRaw ? makeTrail(trailRaw, mapImg.naturalWidth, mapImg.naturalHeight) : null;
  pos = placeAll(data.missions, trail);
}
// כל צילום נשמר פעם אחת (כתמונה) – בלי ליצור קנבסים חדשים בכל רענון של הבית (זיכרון בטלפון)
const snapCache = new Map<string, { src: string; px?: string; py?: string }>();
function snapshot(i: number, w: number, hgt: number, span = 0.2): HTMLElement {
  const key = `${i}:${w}:${hgt}:${span}:${mapImg.naturalWidth}`;
  const hit = snapCache.get(key);
  if (hit) {
    const im = h('img', { className: 'snap', src: hit.src, alt: '' });
    if (hit.px) (im.dataset.px = hit.px), (im.dataset.py = hit.py);
    return im;
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = hgt;
  c.className = 'snap';
  const p = pos[i];
  const g = c.getContext('2d')!;
  g.fillStyle = '#0d3a5c';
  g.fillRect(0, 0, w, hgt);
  if (p && mapImg.naturalWidth) {
    const W = mapImg.naturalWidth;
    const H = mapImg.naturalHeight;
    const sw = Math.min(W, W * span);
    const sh = Math.min(H, (sw * hgt) / w);
    // לא יוצאים מגבולות המפה (אחרת יש פס ריק); הסיכה זזה בהתאם
    const sx = Math.max(0, Math.min(W - sw, p.x * W - sw / 2));
    const sy = Math.max(0, Math.min(H - sh, p.y * H - sh / 2));
    g.drawImage(mapImg, sx, sy, sw, sh, 0, 0, w, hgt);
    c.dataset.px = String(((p.x * W - sx) / sw) * 100);
    c.dataset.py = String(((p.y * H - sy) / sh) * 100);
  }
  if (mapImg.naturalWidth) {
    try {
      snapCache.set(key, { src: c.toDataURL('image/jpeg', 0.82), px: c.dataset.px, py: c.dataset.py });
    } catch {
      /* בלי CORS – פשוט לא שומרים */
    }
  }
  return c;
}
/** עטיפה עם סיכה פועמת במקום של העצירה (אם הרקע הוא המפה) */
function withPin(bg: HTMLElement) {
  const pin = h('span', { className: 'st-pin', ariaHidden: 'true' });
  if (bg.dataset.px) {
    pin.style.left = `${bg.dataset.px}%`;
    pin.style.top = `${bg.dataset.py}%`;
  } else pin.hidden = true;
  return [bg, pin];
}
/** רקע של עצירה: התמונה מהקטע אם יש, אחרת התמונה של קליפ מאותה עצירה, אחרת המפה במקום שלה */
function stopBg(i: number, w: number, hgt: number, span?: number): HTMLElement {
  const m = data!.missions[i];
  const img = safeUrl(m?.image_url) ?? stopClipThumb(i, data!.missions, live);
  return img ? h('img', { className: 'snap', src: img, alt: '' }) : snapshot(i, w, hgt, span);
}

// ── ניווט בין טאבים (ב-hash, כדי שאפשר לשלוח קישור) ──
type Tab = 'home' | 'map' | 'clips' | 'stats';
let tab: Tab = 'home';
const frames: Partial<Record<Tab, HTMLIFrameElement>> = {};
function frame(t: 'map' | 'stats', hash = '') {
  // בתוך הטלפון שבאתר: לא טוענים עוד עותק של המפה (כפול זיכרון = קריסה בטלפון) – סוגרים את הטלפון ועוברים למפה של האתר
  if (t === 'map' && new URLSearchParams(location.search).has('inapp') && window.parent !== window) {
    window.parent.postMessage({ type: 'oded:map', hash }, location.origin);
    history.replaceState(null, '', '#home');
    show('home');
    return;
  }
  const view = $(`#view-${t}`);
  let f = frames[t];
  const demo = new URLSearchParams(location.search).has('demo') ? '&demo' : '';
  const src = t === 'map' ? `${B}index.html?embed${demo}${hash}` : `${B}phone-stats.html?embed&app${demo}${hash}`;
  if (!f) {
    f = h('iframe', { className: 'frame', src, title: t === 'map' ? 'המפה' : 'המספרים', allow: 'autoplay; fullscreen' }) as HTMLIFrameElement;
    frames[t] = f;
    view.append(f);
  } else if (hash) {
    // אותו דף, רק מזיזים את המפה (בלי טעינה מחדש)
    try {
      f.contentWindow!.location.hash = hash;
    } catch {
      f.src = src;
    }
  }
}
function show(t: Tab, opts: { stop?: number; clip?: string } = {}) {
  tab = t;
  document.querySelectorAll<HTMLElement>('[data-view]').forEach((v) => (v.hidden = v.dataset.view !== t));
  document.querySelectorAll<HTMLElement>('[data-tab]').forEach((a) => a.toggleAttribute('aria-current', a.dataset.tab === t));
  document.body.dataset.tab = t;
  if (t === 'map') frame('map', opts.stop != null ? `#m-${opts.stop + 1}` : '');
  if (t === 'stats') frame('stats');
  if (t === 'clips') renderClips(opts.clip);
  else pauseFeed();
  if (t === 'home') $('#view-home').scrollTop = $('#view-home').scrollTop; // נשאר איפה שהיה
}
function route() {
  const hsh = location.hash.slice(1);
  const m = hsh.match(/^m-(\d+)$/);
  const s = hsh.match(/^story-(\d+)$/);
  const c = hsh.match(/^clip-(.+)$/);
  if (m) show('map', { stop: +m[1] - 1 });
  else if (c) show('clips', { clip: decodeURIComponent(c[1]) });
  else if (s) {
    show('home');
    if (data) openStoryAt(+s[1] - 1);
  } else if (hsh === 'map' || hsh === 'clips' || hsh === 'stats') show(hsh);
  else show('home');
}
addEventListener('hashchange', route);

// ══════════════ סטוריז ══════════════
interface Slide {
  stop: number;
  label: string;
}
interface Group {
  key: string;
  title: string;
  ring: number; // העצירה שמציירת את הטבעת
  slides: Slide[];
  isNew?: boolean;
}
const SEEN_KEY = 'stories-seen';
let seen = new Set<string>();
try {
  seen = new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]'));
} catch {
  /* חסום */
}
const markSeen = (k: string) => {
  seen.add(k);
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-300)));
  } catch {
    /* חסום */
  }
};
let freshIds = new Set<string>(); // עצירות שנוספו בזמן שהדף פתוח

function groups(): Group[] {
  if (!data) return [];
  const ms = data.missions;
  const out: Group[] = [];
  // "היום": כל מה שקרה היום (או ב-24 השעות האחרונות)
  const now = new Date();
  let today = ms.map((m, i) => ({ m, i })).filter((x) => x.m.happened_at && sameDay(new Date(x.m.happened_at), now));
  if (!today.length) today = ms.map((m, i) => ({ m, i })).filter((x) => x.m.happened_at && Date.now() - Date.parse(x.m.happened_at) < 864e5);
  if (today.length) {
    const sl = today.slice(-12);
    out.push({ key: `today-${now.toDateString()}-${sl.length}`, title: 'היום', ring: sl[sl.length - 1].i, slides: sl.map((x) => ({ stop: x.i, label: 'היום' })) });
  }
  // מיילסטונים: מה שאהבו יותר קודם, ובשוויון – החדש קודם
  ms.map((m, i) => ({ m, i }))
    .filter((x) => x.m.is_milestone)
    .reverse()
    .sort((a, b) => score('stop', b.m.id, b.m.happened_at) - score('stop', a.m.id, a.m.happened_at))
    .forEach((x) => out.push({ key: `ms-${x.m.id}`, title: x.m.title, ring: x.i, slides: [{ stop: x.i, label: `מיילסטון ${x.i + 1}` }], isNew: freshIds.has(x.m.id) }));
  return out;
}

const story = $('[data-story]');
let sg = 0; // קבוצה
let ss = 0; // שקופית
let gs: Group[] = [];
let timer = 0;
let started = 0;
let elapsed = 0;
let paused = false;
const DUR = 7000;

function openStory(gi: number) {
  gs = groups();
  if (!gs[gi]) return;
  sg = gi;
  ss = 0;
  story.hidden = false;
  document.body.classList.add('is-story');
  renderSlide();
  requestAnimationFrame(() => story.classList.add('is-open'));
}
function openStoryAt(stop: number) {
  gs = groups();
  const gi = gs.findIndex((g) => g.slides.some((s) => s.stop === stop) && g.key.startsWith('ms-'));
  if (gi >= 0) openStory(gi);
  else show('map', { stop });
}
function closeStory() {
  cancelAnimationFrame(timer);
  story.classList.remove('is-open');
  story.querySelectorAll('video').forEach((v) => v.pause());
  document.body.classList.remove('is-story');
  setTimeout(() => {
    story.hidden = true;
    story.replaceChildren();
  }, reduce ? 0 : 260);
  if (location.hash.startsWith('#story-')) history.replaceState(null, '', '#home');
  renderHome();
}
function step(dir: 1 | -1) {
  const g = gs[sg];
  if (dir === 1) {
    if (ss < g.slides.length - 1) ss++;
    else if (sg < gs.length - 1) {
      markSeen(g.key);
      sg++;
      ss = 0;
    } else {
      markSeen(g.key);
      return closeStory();
    }
  } else if (ss > 0) ss--;
  else if (sg > 0) {
    sg--;
    ss = 0;
  } else elapsed = 0;
  renderSlide();
}
function tick() {
  const bar = story.querySelector<HTMLElement>('.st-prog .is-cur i');
  if (!paused) {
    const now = performance.now();
    elapsed += now - started;
    started = now;
  } else started = performance.now();
  if (bar) bar.style.transform = `scaleX(${Math.min(1, elapsed / DUR)})`;
  if (elapsed >= DUR) return step(1);
  timer = requestAnimationFrame(tick);
}

function renderSlide() {
  if (!data) return;
  cancelAnimationFrame(timer);
  const g = gs[sg];
  const sl = g.slides[ss];
  const i = sl.stop;
  const m: Mission = data.missions[i];
  history.replaceState(null, '', `#story-${i + 1}`);
  const url = safeUrl(m.recap_url);
  const nC = commentCount('stop', m.id);
  const counts = COUNTERS.map((c) => ({ c, n: live ? countOf(live, c.key, m.id) : 0 })).filter((x) => x.n);
  const close = h('button', { className: 'st-close', type: 'button', ariaLabel: 'סגירה' }, ico(X, 26));
  close.onclick = closeStory;
  const actions = h(
    'div',
    { className: 'st-actions' },
    url ? h('button', { className: 'pill pill--solid', type: 'button', onclick: () => watch(m) }, ico(Play, 18), 'לצפייה בקטע') : null,
    likeBtn('stop', m.id, 'pill', 18),
    h('button', { className: 'pill', type: 'button', onclick: () => openComments('stop', m.id, m.title) }, ico(MessageCircle, 18), nC ? `${nC}` : 'תגובות'),
    h('button', { className: 'pill pill--icon', type: 'button', ariaLabel: 'במפה', onclick: () => { closeStory(); location.hash = `#m-${i + 1}`; } }, ico(MapPin, 18)),
  );
  // את הלחיצות "קדימה/אחורה" תופסים שני אזורים שקופים מעל התמונה (בעברית: שמאל = קדימה)
  const back = h('button', { className: 'st-zone st-zone--back', type: 'button', ariaLabel: 'הקודם' });
  const fwd = h('button', { className: 'st-zone st-zone--fwd', type: 'button', ariaLabel: 'הבא' });
  back.onclick = () => step(-1);
  fwd.onclick = () => step(1);
  fill(
    story,
    h('div', { className: 'st-bg' }, ...withPin(stopBg(i, 900, 1600, 0.3))),
    h('div', { className: 'st-shade' }),
    h('div', { className: 'st-prog', ariaHidden: 'true' }, ...g.slides.map((_, k) => h('span', { className: k < ss ? 'is-done' : k === ss ? 'is-cur' : '' }, h('i')))),
    h('div', { className: 'st-head' }, h('span', { className: 'st-ring' }, h('b', {}, String(i + 1))), h('div', {}, h('strong', {}, g.title === 'היום' ? 'היום בסאבתון' : sl.label), h('small', {}, [m.stream_day ? `יום ${m.stream_day}` : '', ago(m.happened_at)].filter(Boolean).join('  |  '))), close),
    back,
    fwd,
    h(
      'div',
      { className: 'st-body' },
      m.chapter ? h('p', { className: 'st-chip' }, m.chapter) : null,
      h('h2', { className: 'st-title' }, m.title || `עצירה ${i + 1}`),
      m.summary ? h('p', { className: 'st-sum' }, m.summary) : null,
      m.quote ? h('blockquote', { className: 'st-quote' }, `“${m.quote}”`, m.quote_by ? h('cite', {}, m.quote_by) : null) : null,
      counts.length ? h('p', { className: 'st-stats' }, counts.map((x) => `${x.c.emoji} ${x.n}`).join('   ')) : null,
      actions,
    ),
  );
  elapsed = 0;
  started = performance.now();
  paused = false;
  if (!reduce) timer = requestAnimationFrame(tick);
  else story.querySelector<HTMLElement>('.st-prog .is-cur i')?.style.setProperty('transform', 'scaleX(1)');
}

// מחוות: החזקה עוצרת, החלקה למטה סוגרת, חצים ו-Esc במקלדת
{
  let y0 = 0;
  let x0 = 0;
  let dy = 0;
  let down = false;
  story.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('.st-actions, .st-close')) return;
    down = true;
    y0 = e.clientY;
    x0 = e.clientX;
    dy = 0;
    paused = true;
  });
  story.addEventListener('pointermove', (e) => {
    if (!down) return;
    dy = Math.max(0, e.clientY - y0);
    if (dy > 6 && Math.abs(e.clientX - x0) < dy) story.style.transform = `translateY(${dy}px) scale(${1 - dy / 2400})`;
  });
  const up = () => {
    if (!down) return;
    down = false;
    paused = false;
    story.style.transform = '';
    if (dy > 110) closeStory();
  };
  story.addEventListener('pointerup', up);
  story.addEventListener('pointercancel', up);
  // לחיצה אחרי החלקה לא נחשבת "הבא"
  story.addEventListener('click', (e) => {
    if (dy > 12) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);
  addEventListener('keydown', (e) => {
    if (story.hidden || document.body.classList.contains('is-sheet')) return;
    if (e.key === 'Escape') closeStory();
    if (e.key === 'ArrowLeft') step(1);
    if (e.key === 'ArrowRight') step(-1);
  });
}

// ══════════════ גיליון תחתון (תגובות / נגן) ══════════════
const sheet = $('[data-sheet]');
let closeSheet: (() => void) | null = null;
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('is-sheet')) {
    e.stopImmediatePropagation();
    closeSheet?.();
  }
}, true);
function openSheet(title: string, body: HTMLElement, opts: { tall?: boolean } = {}) {
  paused = true;
  document.body.classList.add('is-sheet');
  const close = h('button', { className: 'sheet__close', type: 'button', ariaLabel: 'סגירה' }, ico(X, 22));
  const panel = h('div', { className: `sheet ${opts.tall ? 'sheet--tall' : ''}`, role: 'dialog', ariaModal: 'true', ariaLabel: title }, h('div', { className: 'sheet__grip', ariaHidden: 'true' }), h('div', { className: 'sheet__head' }, h('h3', {}, title), close), h('div', { className: 'sheet__body' }, body));
  const dim = h('div', { className: 'sheet__dim' });
  fill(sheet, dim, panel);
  sheet.hidden = false;
  requestAnimationFrame(() => sheet.classList.add('is-open'));
  const done = () => {
    sheet.classList.remove('is-open');
    document.body.classList.remove('is-sheet');
    paused = false;
    started = performance.now();
    setTimeout(() => {
      sheet.hidden = true;
      sheet.replaceChildren();
    }, reduce ? 0 : 240);
  };
  close.onclick = done;
  dim.onclick = done;
  closeSheet = done;
  // החלקה למטה מהידית או מהכותרת
  let y0 = -1;
  const head = panel.querySelector<HTMLElement>('.sheet__head')!;
  for (const el of [panel.querySelector<HTMLElement>('.sheet__grip')!, head]) {
    el.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return; // כפתור הסגירה
      y0 = e.clientY;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (y0 < 0) return;
      panel.style.transform = `translateY(${Math.max(0, e.clientY - y0)}px)`;
    });
    el.addEventListener('pointerup', (e) => {
      const d = e.clientY - y0;
      y0 = -1;
      panel.style.transform = '';
      if (d > 90) done();
    });
  }
  setTimeout(() => close.focus({ preventScroll: true }), 50);
}
function openComments(type: 'stop' | 'clip', id: string, title: string) {
  openSheet(title ? `תגובות: ${title}` : 'תגובות', commentsBox(store, type, id, { toast, title: false }), { tall: true });
}
function watch(m: Mission) {
  const url = safeUrl(m.recap_url);
  if (!url) return;
  const embed = videoEmbed(url);
  if (!embed) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  openSheet(m.title, h('div', { className: 'player' }, embed));
}
function watchLive() {
  if (!data) return;
  const ch = kickSlug(data.settings.kick_channel);
  openSheet('הלייב', h('div', { className: 'player-wrap' }, h('div', { className: 'player' }, h('iframe', { src: `https://player.kick.com/${ch}`, allowFullscreen: true, title: 'הלייב', allow: 'autoplay; fullscreen' })), h('a', { className: 'pill', href: `https://kick.com/${ch}`, target: '_blank', rel: 'noopener' }, ico(ExternalLink, 18), 'לפתוח ב-Kick')));
}
async function share(url: string, title: string) {
  try {
    if (navigator.share) await navigator.share({ title, url });
    else {
      await navigator.clipboard.writeText(url);
      toast('הקישור הועתק');
    }
  } catch {
    /* בוטל */
  }
}

// ══════════════ התקנה כאפליקציה ══════════════
// בתוך הטלפון שבאתר (‎?inapp) הכפתור של האתר מטפל בזה
const inapp = new URLSearchParams(location.search).has('inapp');
if (inapp) document.documentElement.classList.add('is-inapp');
const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
const installBtn = $<HTMLButtonElement>('[data-install]');
installBtn.hidden = inapp || standalone;
// עמוד הסבר פשוט (עם כפתור "להתקין עכשיו" כשהדפדפן מאפשר)
installBtn.onclick = () => (location.href = `${B}install.html`);
// 🔔 התראות על סטורי חדש ומשימה שנגמרה (בתוך הטלפון שבאתר – לא; שם זו לא אפליקציה)
if (!inapp) initPush($<HTMLButtonElement>('[data-push]'), { toast, installUrl: `${B}install.html` });

// ══════════════ בית ══════════════
const home = $('#view-home');
function renderHome() {
  if (!data) return;
  const d = data;
  const ms = d.missions;
  const cur = currentIndex(d);
  const gl = groups();
  const keep = home.querySelector<HTMLElement>('.rings')?.scrollLeft ?? 0;

  const rings = h(
    'div',
    { className: 'rings', role: 'list', ariaLabel: 'סטוריז' },
    ...gl.map((g, gi) => {
      const b = h(
        'button',
        { className: `ring ${seen.has(g.key) ? 'is-seen' : ''} ${g.isNew ? 'is-new' : ''} ${g.title === 'היום' ? 'is-today' : ''}`, type: 'button', role: 'listitem', ariaLabel: `סטורי: ${g.title}` },
        h('span', { className: 'ring__pic' }, stopBg(g.ring, 200, 200, 0.14)),
        h('span', { className: 'ring__name' }, g.title),
      );
      b.onclick = () => openStory(gi);
      return b;
    }),
  );
  const m = ms[cur];
  const liveNow = isLive();
  const s = live?.status;
  const liveCard = liveNow
    ? h(
        'button',
        { className: 'card card--live', type: 'button' },
        h('span', { className: 'live-dot', ariaHidden: 'true' }),
        h('div', { className: 'card--live__txt' }, h('strong', {}, onGame() ? 'משחק GTA 6 עכשיו' : 'בלייב עכשיו'), h('small', {}, [s?.title, statusFresh(s ?? null) && s?.viewers ? `${num(s.viewers)} צופים` : ''].filter(Boolean).join('  |  '))),
        h('span', { className: 'card--live__go' }, 'לצפייה'),
      )
    : h('a', { className: 'card card--off', href: `https://kick.com/${kickSlug(d.settings.kick_channel)}`, target: '_blank', rel: 'noopener' }, h('div', {}, h('strong', {}, 'לא בלייב כרגע'), h('small', {}, 'עוקבים ב-Kick כדי לקבל התראה כשמתחילים')), ico(ExternalLink, 20));
  if (liveNow) liveCard.addEventListener('click', watchLive);

  const nowCard = m
    ? h(
        'article',
        { className: 'card card--now' },
        h('div', { className: 'card--now__map' }, ...withPin(stopBg(cur, 900, 500, 0.26))),
        h(
          'div',
          { className: 'card--now__body' },
          h('p', { className: 'eyebrow' }, 'איפה אנחנו עכשיו'),
          h('h2', {}, m.title || `עצירה ${cur + 1}`),
          h('p', { className: 'muted' }, [`עצירה ${cur + 1}`, m.chapter, m.stream_day ? `יום ${m.stream_day}` : ''].filter(Boolean).join('  |  ')),
          h(
            'div',
            { className: 'row' },
            h('a', { className: 'pill pill--solid', href: `#m-${cur + 1}` }, ico(MapPin, 18), 'במפה'),
            h('button', { className: 'pill', type: 'button', onclick: () => openComments('stop', m.id, m.title) }, ico(MessageCircle, 18), commentCount('stop', m.id) ? `${commentCount('stop', m.id)} תגובות` : 'להגיב'),
          ),
        ),
      )
    : null;

  const l = live;
  const quick = h(
    'a',
    { className: 'quick', href: '#stats', ariaLabel: 'לכל המספרים' },
    h('div', { className: 'quick__item quick__item--play' }, h('b', {}, l ? fmtPlay(playMs(l)) : '–'), h('span', {}, 'שעות משחק')),
    h('div', { className: 'quick__item' }, h('b', {}, l ? num(countOf(l, 'deaths')) : '–'), h('span', {}, '💀 עודד מת')),
    h('div', { className: 'quick__item' }, h('b', {}, l ? num(countOf(l, 'arrests')) : '–'), h('span', {}, '🚔 עודד נעצר')),
  );

  const clips = allClips().slice(0, 8);
  const clipRow = clips.length
    ? h(
        'section',
        { className: 'block' },
        h('div', { className: 'block__head' }, h('h3', {}, 'הקליפים הכי אהובים'), h('a', { href: '#clips' }, 'הכול')),
        h(
          'div',
          { className: 'mini-clips' },
          ...clips.map((c) =>
            h(
              'a',
              { className: 'mini-clip', href: `#clip-${encodeURIComponent(c.id)}` },
              c.thumbnail_url ? h('img', { src: c.thumbnail_url, alt: '', loading: 'lazy' }) : null,
              h('span', { className: 'mini-clip__t' }, c.title || 'קליפ'),
            ),
          ),
        ),
      )
    : null;

  const recent = ms
    .map((x, i) => ({ x, i }))
    .slice(-6)
    .reverse();
  const recentList = h(
    'section',
    { className: 'block' },
    h('div', { className: 'block__head' }, h('h3', {}, 'העצירות האחרונות'), h('a', { href: '#map' }, 'למפה')),
    h(
      'ol',
      { className: 'stops' },
      ...recent.map(({ x, i }) =>
        h(
          'li',
          {},
          h(
            'a',
            { href: x.is_milestone ? `#story-${i + 1}` : `#m-${i + 1}`, className: `stop-row ${i === cur ? 'is-now' : ''} ${freshIds.has(x.id) ? 'is-fresh' : ''}` },
            h('span', { className: `stop-row__no ${x.is_milestone ? 'is-ms' : ''}` }, String(i + 1)),
            h('span', { className: 'stop-row__txt' }, h('strong', {}, x.title || `עצירה ${i + 1}`), h('small', {}, i === cur ? 'כאן אנחנו עכשיו' : [x.is_milestone ? 'מיילסטון' : '', ago(x.happened_at)].filter(Boolean).join('  |  '))),
            commentCount('stop', x.id) ? h('span', { className: 'stop-row__c' }, ico(MessageCircle, 14), String(commentCount('stop', x.id))) : null,
          ),
        ),
      ),
    ),
  );

  fill(
    home,
    h('h1', { className: 'hello' }, d.settings.title || 'סאבתון GTA 6'),
    rings,
    liveCard,
    nowCard ??
      h(
        'article',
        { className: 'card card--start' },
        h('p', { className: 'eyebrow' }, 'המסע עוד לא התחיל'),
        h('h2', {}, 'נוחתים ב-Vice City ב-19.11'),
        h('p', { className: 'muted' }, 'מהרגע שהמשחק נפתח, כל משימה של עודד נכנסת למפה ולסטוריז. בינתיים: הטריילרים בקליפים.'),
        h('div', { className: 'row' }, h('a', { className: 'pill pill--solid', href: '#clips' }, ico(Play, 18), 'לטריילרים'), h('a', { className: 'pill', href: `https://kick.com/${kickSlug(d.settings.kick_channel)}`, target: '_blank', rel: 'noopener' }, 'לעקוב ב-Kick')),
      ),
    quick,
    clipRow,
    ms.length ? recentList : null,
    h('p', { className: 'foot' }, 'אתר מעריצים לא רשמי. אינו קשור ל-Rockstar Games.'),
  );
  home.querySelector<HTMLElement>('.rings')!.scrollLeft = keep;
  // הבר העליון: נקודת "בלייב"
  const lb = $<HTMLButtonElement>('[data-live]');
  lb.hidden = !liveNow;
  lb.textContent = 'בלייב';
  lb.onclick = watchLive;
}

// ══════════════ פיד קליפים ══════════════
const feedView = $('#view-clips');
let feedStops: Array<() => void> = [];
let muted = true;
let feedIO: IntersectionObserver | null = null;
let feedKey = '';
function pauseFeed() {
  feedStops.forEach((f) => f());
  feedStops = [];
  feedView.querySelectorAll('.reel__media video').forEach((v) => v.remove());
}
function renderClips(focusId?: string) {
  const clips = allClips();
  const key = clips.map((c) => c.id).join();
  if (key === feedKey && feedView.firstChild && !focusId) {
    observe();
    return;
  }
  feedKey = key;
  pauseFeed();
  feedIO?.disconnect();
  if (!clips.length) {
    fill(feedView, h('div', { className: 'empty' }, h('p', {}, 'עוד אין קליפים מ-GTA 6. עושים קליפ בלייב והוא מופיע כאן תוך כמה דקות.')));
    return;
  }
  const items = clips.map((c, k) => reel(c, k));
  fill(feedView, h('div', { className: 'feed' }, live?.demoClips ? h('p', { className: 'feed__note' }, 'תצוגה מקדימה: קליפים מהערוץ מכל המשחקים') : null, ...items));
  observe();
  if (focusId) {
    const el = feedView.querySelector<HTMLElement>(`[data-clip="${CSS.escape(focusId)}"]`);
    el?.scrollIntoView({ block: 'start' });
  }
}
function observe() {
  feedIO?.disconnect();
  feedIO = new IntersectionObserver(
    (es) => {
      for (const e of es) {
        const el = e.target as HTMLElement;
        if (e.isIntersecting && e.intersectionRatio > 0.6) startReel(el);
        else stopReel(el);
      }
    },
    { root: feedView, threshold: [0, 0.6, 1] },
  );
  feedView.querySelectorAll('.reel').forEach((r) => feedIO!.observe(r));
}
const reelStops = new WeakMap<HTMLElement, () => void>();
function startReel(el: HTMLElement) {
  if (tab !== 'clips' || reelStops.has(el)) return;
  const c = allClips().find((x) => x.id === el.dataset.clip);
  if (!c) return;
  const media = el.querySelector<HTMLElement>('.reel__media')!;
  const holder = h('div', { className: 'reel__video' });
  media.append(holder);
  // טריילר ביוטיוב: נגן מוטמע (מתחיל מושתק, כמו כל הפיד)
  const yt = c.video_url?.startsWith('youtube:') ? c.video_url.slice(8) : null;
  if (yt) {
    holder.append(h('iframe', { className: 'reel__yt', src: `https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&mute=${muted ? 1 : 0}&playsinline=1&loop=1&playlist=${yt}&rel=0&modestbranding=1&controls=0`, allow: 'autoplay; encrypted-media; fullscreen', title: c.title }));
    const s = () => {
      holder.remove();
      reelStops.delete(el);
    };
    reelStops.set(el, s);
    feedStops.push(s);
    return;
  }
  const stop = playClip(holder, c);
  const v = holder.querySelector('video')!;
  v.muted = muted;
  v.loop = true;
  v.controls = false;
  v.playsInline = true;
  v.play().catch(() => {});
  const s = () => {
    stop();
    holder.remove();
    reelStops.delete(el);
  };
  reelStops.set(el, s);
  feedStops.push(s);
}
function stopReel(el: HTMLElement) {
  reelStops.get(el)?.();
}
function reel(c: Clip, k: number) {
  const n = commentCount('clip', c.id);
  const muteBtn = h('button', { className: 'reel__btn reel__mute', type: 'button', ariaLabel: muted ? 'הפעלת קול' : 'השתקה' }, ico(muted ? VolumeX : Volume2, 24));
  const media = h('div', { className: 'reel__media' }, c.thumbnail_url ? h('img', { className: 'reel__bg', src: c.thumbnail_url, alt: '', loading: k < 2 ? 'eager' : 'lazy' }) : null, c.thumbnail_url ? h('img', { className: 'reel__poster', src: c.thumbnail_url, alt: '', loading: k < 2 ? 'eager' : 'lazy' }) : null);
  const toggleMute = () => {
    muted = !muted;
    feedView.querySelectorAll('video').forEach((v) => (v.muted = muted));
    feedView.querySelectorAll('.reel__mute').forEach((b) => {
      b.replaceChildren(ico(muted ? VolumeX : Volume2, 24));
      b.setAttribute('aria-label', muted ? 'הפעלת קול' : 'השתקה');
    });
  };
  muteBtn.onclick = toggleMute;
  media.onclick = toggleMute;
  const stopIdx = data ? data.missions.reduce((b, m, i) => (m.happened_at && Date.parse(m.happened_at) <= Date.parse(c.created_at) ? i : b), -1) : -1;
  const art = h(
    'article',
    { className: 'reel' },
    media,
    h(
      'div',
      { className: 'reel__side' },
      likeBtn('clip', c.id, 'reel__btn', 24),
      h('button', { className: 'reel__btn', type: 'button', ariaLabel: 'תגובות', onclick: () => openComments('clip', c.id, c.title) }, ico(MessageCircle, 24), h('span', {}, n ? String(n) : '')),
      h('button', { className: 'reel__btn', type: 'button', ariaLabel: 'שיתוף', onclick: () => share(`${location.origin}${location.pathname}#clip-${encodeURIComponent(c.id)}`, c.title) }, ico(Share2, 24)),
      stopIdx >= 0 && !live?.demoClips ? h('a', { className: 'reel__btn', href: `#m-${stopIdx + 1}`, ariaLabel: `לעצירה ${stopIdx + 1}` }, ico(MapPin, 24)) : null,
      muteBtn,
    ),
    h('div', { className: 'reel__info' }, h('strong', {}, c.title || 'קליפ'), h('small', {}, c.id.startsWith('yt-') ? 'הטריילר הרשמי של Rockstar Games' : isPick(c) ? `מהערוץ של עודד  |  ${num(c.views)} צפיות` : [c.creator ? `קליפ של ${c.creator}` : '', `${num(c.views)} צפיות`, ago(c.created_at)].filter(Boolean).join('  |  '))),
  );
  art.dataset.clip = c.id;
  return art;
}

// ══════════════ טעינה ══════════════

fetch(`${B}trail.json`)
  .then((r) => (r.ok ? r.json() : null))
  .then((t) => (trailRaw = t))
  .catch(() => {})
  .finally(() => {
    mapImg.onload = () => {
      computePositions();
      renderHome();
    };
    // מפה קלה (2400px): לצילומים הקטנים בטלפון היא חדה מספיק, ובחצי זיכרון
    mapImg.src = `${B}map-lite.webp`;
  });

store
  .load()
  .then((d) => {
    data = d;
    void loadChannelClips(kickSlug(d.settings.kick_channel) || 'odedsvr');
    computePositions();
    renderHome();
    route();
    store.subscribe((nd) => {
      const known = new Set(data!.missions.map((m) => m.id));
      const added = nd.missions.filter((m) => !known.has(m.id));
      data = nd;
      computePositions();
      if (added.length) {
        added.forEach((m) => freshIds.add(m.id));
        const a = added[added.length - 1];
        toast(a.is_milestone ? `מיילסטון חדש: ${a.title}` : `עצירה חדשה: ${a.title}`);
      }
      if (story.hidden) renderHome();
    });
    store.loadLive().then((l) => {
      live = l;
      renderHome();
      if (tab === 'clips') renderClips();
    });
    store.subscribeLive((l) => {
      live = l;
      if (story.hidden) renderHome();
      if (tab === 'clips') renderClips();
    });
    initComments(store, () => {
      if (story.hidden && !document.body.classList.contains('is-sheet')) renderHome();
    });
  })
  .catch((e) => {
    console.error(e);
    fill(home, h('p', { className: 'empty' }, 'הנתונים לא נטענו. נסו לרענן.'));
  });

if (loginError) setTimeout(() => toast(loginErrorText()), 600);

// לייקים: בהתחלה ואז כל דקה (הסידור מתעדכן בבנייה הבאה של הבית)
refreshLikes().then(() => story.hidden && renderHome());
setInterval(() => void refreshLikes(), 60_000);

// זמן המשחק מתקתק
setInterval(() => {
  const b = home.querySelector('.quick__item--play b');
  if (b && live) b.textContent = fmtPlay(playMs(live));
}, 15_000);


// PWA: אפשר להתקין לבית; Service Worker שומר את מעטפת האפליקציה
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register(`${B}sw.js`, { scope: B }).catch(() => {});

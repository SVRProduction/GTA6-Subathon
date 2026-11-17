// גרסה 4 · Stories – האתר כאפליקציה לטלפון: בית עם סטוריז, מפה, פיד קליפים ומספרים.
// המפה והמספרים הם הדפים הקיימים (index.html?embed / phone-stats.html) בתוך הטאבים, כך שהמנוע לא משוכפל.
import { ChartColumnBig, Clapperboard, ExternalLink, House, Map as MapIco, MapPin, MessageCircle, Play, Share2, Volume2, VolumeX, X, createElement, type IconNode } from 'lucide';
import { loginError } from '../auth';
import { playClip } from '../clips';
import { commentCount, commentsBox, initComments } from '../comments';
import { createStore } from '../data/store';
import { countOf, currentIndex, kickSlug, playMs, statusFresh, type Clip, type Data, type LiveData, type Mission } from '../data/types';
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
const isLive = () => !!data && !!live && (statusFresh(live.status) ? !!live.status?.is_live : data.settings.is_live);
const onGame = () => !!live && statusFresh(live.status) && !!live.status?.on_category;
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const ago = (iso: string | null) => {
  if (!iso) return '';
  const m = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (m < 60) return `לפני ${m} דק'`;
  if (m < 1440) return `לפני ${Math.round(m / 60)} שע'`;
  return `לפני ${Math.round(m / 1440)} ימים`;
};

// ── צילום המפה במקום של עצירה (רקע לסטורי ולכרטיסים) ──
function computePositions() {
  if (!data || !mapImg.naturalWidth) return;
  const trail = trailRaw ? makeTrail(trailRaw, mapImg.naturalWidth, mapImg.naturalHeight) : null;
  pos = placeAll(data.missions, trail);
}
function snapshot(i: number, w: number, hgt: number, span = 0.2): HTMLCanvasElement {
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
/** רקע של עצירה: התמונה מהקטע אם יש, אחרת המפה במקום שלה */
function stopBg(i: number, w: number, hgt: number, span?: number): HTMLElement {
  const m = data!.missions[i];
  const img = safeUrl(m?.image_url);
  return img ? h('img', { className: 'snap', src: img, alt: '' }) : snapshot(i, w, hgt, span);
}

// ── ניווט בין טאבים (ב-hash, כדי שאפשר לשלוח קישור) ──
type Tab = 'home' | 'map' | 'clips' | 'stats';
let tab: Tab = 'home';
const frames: Partial<Record<Tab, HTMLIFrameElement>> = {};
function frame(t: 'map' | 'stats', hash = '') {
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
  // מיילסטונים, החדש קודם
  ms.map((m, i) => ({ m, i }))
    .filter((x) => x.m.is_milestone)
    .reverse()
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
  const deaths = live ? countOf(live, 'deaths', m.id) : 0;
  const cats = live ? countOf(live, 'cats', m.id) : 0;
  const close = h('button', { className: 'st-close', type: 'button', ariaLabel: 'סגירה' }, ico(X, 26));
  close.onclick = closeStory;
  const actions = h(
    'div',
    { className: 'st-actions' },
    url ? h('button', { className: 'pill pill--solid', type: 'button', onclick: () => watch(m) }, ico(Play, 18), 'לצפייה בקטע') : null,
    h('button', { className: 'pill', type: 'button', onclick: () => openComments('stop', m.id, m.title) }, ico(MessageCircle, 18), nC ? `${nC} תגובות` : 'תגובות'),
    h('button', { className: 'pill pill--icon', type: 'button', ariaLabel: 'במפה', onclick: () => { closeStory(); location.hash = `#m-${i + 1}`; } }, ico(MapPin, 18)),
    h('button', { className: 'pill pill--icon', type: 'button', ariaLabel: 'שיתוף', onclick: () => share(`${location.origin}${location.pathname}#story-${i + 1}`, m.title) }, ico(Share2, 18)),
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
      deaths || cats ? h('p', { className: 'st-stats' }, deaths ? `💀 ${deaths}` : '', cats ? `  🐈 ${cats}` : '') : null,
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
let deferredInstall: (Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }) | null = null;
const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);
const installBtn = $<HTMLButtonElement>('[data-install]');
installBtn.hidden = inapp || standalone || !ios;
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e as typeof deferredInstall;
  installBtn.hidden = inapp || standalone;
});
addEventListener('appinstalled', () => {
  installBtn.hidden = true;
  toast('הותקן. הסאבתון מחכה במסך הבית.');
});
installBtn.onclick = async () => {
  if (deferredInstall) {
    await deferredInstall.prompt();
    const { outcome } = await deferredInstall.userChoice;
    if (outcome === 'accepted') installBtn.hidden = true;
    deferredInstall = null;
    return;
  }
  openSheet(
    'התקנה באייפון',
    h('ol', { className: 'ios-steps' }, h('li', {}, 'לוחצים על כפתור השיתוף של Safari (הריבוע עם החץ).'), h('li', {}, 'בוחרים "הוספה למסך הבית".'), h('li', {}, 'לוחצים "הוספה". הסאבתון יופיע במסך הבית ויפתח כמו אפליקציה.')),
  );
};

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
          h('p', { className: 'eyebrow' }, 'אנחנו עכשיו ב'),
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
    h('div', { className: 'quick__item' }, h('b', {}, l ? num(countOf(l, 'deaths')) : '–'), h('span', {}, '💀 מיתות')),
    h('div', { className: 'quick__item' }, h('b', {}, l ? num(countOf(l, 'cats')) : '–'), h('span', {}, '🐈 חתולים')),
  );

  const clips = (l?.clips ?? []).slice(0, 8);
  const clipRow = clips.length
    ? h(
        'section',
        { className: 'block' },
        h('div', { className: 'block__head' }, h('h3', {}, 'קליפים אחרונים'), h('a', { href: '#clips' }, 'הכול')),
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
    nowCard,
    quick,
    clipRow,
    recentList,
    h('p', { className: 'foot' }, 'אתר מעריצים לא רשמי. אינו קשור ל-Rockstar Games.'),
  );
  home.querySelector<HTMLElement>('.rings')!.scrollLeft = keep;
  // הבר העליון: נקודת "בלייב"
  const lb = $<HTMLButtonElement>('[data-live]');
  lb.hidden = !liveNow;
  lb.textContent = onGame() ? 'GTA 6 בלייב' : 'בלייב';
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
  const clips = live?.clips ?? [];
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
  const c = (live?.clips ?? []).find((x) => x.id === el.dataset.clip);
  if (!c) return;
  const media = el.querySelector<HTMLElement>('.reel__media')!;
  const holder = h('div', { className: 'reel__video' });
  media.append(holder);
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
      h('button', { className: 'reel__btn', type: 'button', ariaLabel: 'תגובות', onclick: () => openComments('clip', c.id, c.title) }, ico(MessageCircle, 24), h('span', {}, n ? String(n) : '')),
      h('button', { className: 'reel__btn', type: 'button', ariaLabel: 'שיתוף', onclick: () => share(`${location.origin}${location.pathname}#clip-${encodeURIComponent(c.id)}`, c.title) }, ico(Share2, 24)),
      stopIdx >= 0 && !live?.demoClips ? h('a', { className: 'reel__btn', href: `#m-${stopIdx + 1}`, ariaLabel: `לעצירה ${stopIdx + 1}` }, ico(MapPin, 24)) : null,
      muteBtn,
    ),
    h('div', { className: 'reel__info' }, h('strong', {}, c.title || 'קליפ'), h('small', {}, [c.creator ? `קליפ של ${c.creator}` : '', `${num(c.views)} צפיות`, ago(c.created_at)].filter(Boolean).join('  |  '))),
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
    mapImg.src = `${B}map.webp`;
  });

store
  .load()
  .then((d) => {
    data = d;
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

if (loginError) setTimeout(() => toast('ההתחברות עם Kick לא הצליחה. נסו שוב.'), 600);

// זמן המשחק מתקתק
setInterval(() => {
  const b = home.querySelector('.quick__item--play b');
  if (b && live) b.textContent = fmtPlay(playMs(live));
}, 15_000);


// PWA: אפשר להתקין לבית; Service Worker שומר את מעטפת האפליקציה
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register(`${B}sw.js`, { scope: B }).catch(() => {});

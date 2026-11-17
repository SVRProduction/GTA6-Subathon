import { createStore } from './data/store';
import { currentIndex, type Data, type Mission } from './data/types';
import { fill, h, safeUrl } from './dom';
import { ico } from './icons';
import { kindLabel, metaText, stopBody, stopNo } from './journey/content';
import { buildCurve, makeTrail, placeAll, type Curve } from './journey/route';
import { enableSheetDrag } from './journey/sheet';
import { createWorld } from './journey/world';
import { createWater, type Water } from './journey/water';
import { createLife, type Life } from './journey/life';
import { createLive, fmtHours } from './live';
import { clipCard, clipsView, clipStop, playClip } from './clips';
import { commentCount, commentsBox, initComments } from './comments';
import { loginError } from './auth';
import { createMissionHud, legend } from './mission';
import { createControl } from './control';
import { countOf, kickSlug, playMs, type Clip, type LiveData } from './data/types';

const store = createStore();
const q = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

const stage = q('[data-stage]');
const pinsEl = q('[data-pins]');
const sky = q('[data-sky]');
const opening = q('[data-opening]');
const horizon = q('[data-horizon]');
const hud = q('[data-hud]');
const panel = q('[data-panel]');
const panelBody = q('[data-panel-body]');
const rail = q('[data-rail]');
const locator = q('[data-locator]');
const timeline = q('[data-progress]');
const logEl = q('[data-log]');

const DEFAULT_MAP = `${import.meta.env.BASE_URL}map.webp`;
const flat = new URLSearchParams(location.search).has('2d');
// ‎?embed: המפה בתוך טאב "מפה" של אפליקציית הטלפון – בלי מסך פתיחה, בלי כפתור הטלפון, מתחילים בעצירה הנוכחית
const embed = new URLSearchParams(location.search).has('embed');
if (embed) document.documentElement.classList.add('is-embed');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
document.body.classList.toggle('flat', flat);
document.documentElement.classList.toggle('flat-root', flat);

let data: Data;
let cur = -1;
let curve: Curve | null = null;
let pins: HTMLButtonElement[] = [];
let active = -1; // העצירה שהפאנל שלה פתוח
let focus = -1; // אינדקס שברי שהגלילה מכוונת אליו
let shown = -1; // מה שמוצג בפועל (מתקרב ל-focus בהחלקה)
let panelShift = 0;
let tiltShown = 0;
let travelTo: number | null = null; // עצירה שנבחרה בלחיצה, בזמן שהמצלמה בדרך אליה
let userClosed = false; // הצופה סגר את הפאנל – לא פותחים אותו שוב לבד

// ── Toast ──
let toastTimer = 0;
function toast(text: string) {
  const t = q('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove('show'), 4000);
}

// ── אייקונים בכפתורים הקבועים ──
// עננים רכים שמרחפים מעל המפה, כל אחד עם צל על הקרקע. נוצרים כשמגיעה רשימת התמונות (map.json)
interface Cloud { el: HTMLImageElement; shadow: HTMLImageElement; x: number; y: number; alt: number; size: number; speed: number }
let clouds: Cloud[] = [];
function makeClouds(urls: string[]) {
  const n = matchMedia('(max-width: 760px)').matches ? 3 : 6;
  clouds = Array.from({ length: n }, (_, i) => {
    const mk = (cls: string) => {
      const el = h('img', { class: cls, alt: '', src: urls[i % urls.length], draggable: false }) as HTMLImageElement;
      el.decoding = 'async';
      return el;
    };
    const shadow = mk('cloud-shadow');
    const el = mk('cloud');
    sky.append(shadow, el);
    // מיקום במפה (0–1, עם שוליים), גובה מעל הקרקע ורוחב – ביחס לרוחב המפה; מהירות הרוח ביחידות מפה לשנייה
    return { el, shadow, x: ((i * 0.37 + 0.11) % 1.5) - 0.25, y: ((i * 0.53 + 0.07) % 1.1) - 0.05, alt: 0.05 + (i % 3) * 0.018, size: 0.2 + (i % 4) * 0.045, speed: 0.0028 + (i % 3) * 0.0011 };
  });
}

// ── העולם ──
let onMapReady: (() => void) | null = null;
const world = createWorld(stage, () => {
  rebuild();
  stage.classList.add('is-ready');
  onMapReady?.();
  onMapReady = null;
});

const svgNS = 'http://www.w3.org/2000/svg';
const mkPath = (cls: string, normalized = false) => {
  const p = document.createElementNS(svgNS, 'path');
  p.classList.add(cls);
  if (normalized) p.setAttribute('pathLength', '1');
  return p;
};
const trailBase = mkPath('trail-base');
const routeAhead = mkPath('route-ahead');
const routeCasing = mkPath('route-casing', true);
const routeDone = mkPath('route-done', true);
world.svg.append(trailBase, routeAhead, routeCasing, routeDone);
// השביל הראשי של המפה המקורית (משורטט על הכבישים); למפה שהועלתה אין שביל
let trailRaw: Array<[number, number]> | null = null;
let useTrail = false;
let trailPending = true; // עד שיודעים אם יש שביל, לא בונים מסלול (כדי שלא יקפוץ)

// מפת מיקום קטנה: אותה תמונה מוקטנת + המסלול + מלבן התצוגה
const locImg = h('img', { alt: '' });
const locSvg = document.createElementNS(svgNS, 'svg');
const locRoute = document.createElementNS(svgNS, 'path');
const locView = document.createElementNS(svgNS, 'rect');
locRoute.classList.add('loc-route');
locView.classList.add('loc-view');
locSvg.append(locRoute, locView);
locSvg.setAttribute('preserveAspectRatio', 'xMidYMid slice'); // המפה הקטנה עגולה: ממלאים את העיגול
locator.append(locImg, locSvg);

// ── בנייה מחדש כשהנתונים או המפה משתנים ──
function rebuild() {
  if (!data) return;
  const { w, h: hh } = world.size();
  if (w <= 1 || trailPending) return;
  const ms = data.missions;
  cur = currentIndex(data);
  const trail = useTrail && trailRaw ? makeTrail(trailRaw, w, hh) : null;
  curve = buildCurve(placeAll(ms, trail), w, hh, trail);
  trailBase.setAttribute('d', trail ? trail.path : '');
  liveTrail = trail;
  life?.setTrail(trail);

  const sNow = cur >= 0 ? curve.stopS[cur] : 0;
  const done = curve.path(0, sNow || 0.01);
  routeDone.setAttribute('d', done);
  routeCasing.setAttribute('d', done);
  routeAhead.setAttribute('d', curve.path(sNow, curve.total));

  locSvg.setAttribute('viewBox', `0 0 ${w} ${hh}`);
  locRoute.setAttribute('d', curve.path(0, curve.total));
  locator.style.aspectRatio = `${w} / ${hh}`;

  pins = ms.map((m, i) => {
    const state = i < cur ? 'past' : i === cur ? 'now' : 'future';
    const img = safeUrl(m.image_url);
    const disc = h('span', { class: 'pin__disc' });
    if (img) disc.style.backgroundImage = `url("${img.replace(/"/g, '%22')}")`;
    else if (m.is_milestone) disc.textContent = String(i + 1);
    const meta = metaText(m);
    const card = h(
      'span',
      { class: 'pin__card' },
      h('span', { class: 'pin__kind' }, `${kindLabel(m)} ${stopNo(i)}`),
      h('span', { class: 'pin__title' }, m.title),
      m.summary ? h('span', { class: 'pin__teaser' }, m.summary) : null,
      meta ? h('span', { class: 'pin__meta' }, meta) : null,
    );
    return h(
      'button',
      {
        type: 'button',
        class: `pin pin--${state} ${m.is_milestone ? 'pin--ms' : 'pin--dot'} ${clipsByStop.has(i) ? 'pin--clip' : ''}`,
        ariaLabel: `${kindLabel(m)} ${i + 1}: ${m.title}`,
        onclick: () => {
          // מצב עריכה (מודים): לחיצה על עצירה פותחת ישר את טופס העריכה – שמירה, הזזה ומחיקה
          if (control.isEditing()) return control.editStop(data.missions[i]);
          goTo(i);
          openPanel(i);
        },
      },
      disc,
      m.is_milestone ? h('span', { class: 'pin__tip' }) : null,
      card,
    );
  });
  fill(pinsEl, ...pins, h('span', { class: 'player', ariaHidden: 'true' }, h('i'), h('b')), h('span', { class: 'ahead-tag' }, 'ההמשך עוד לא נכתב'));

  renderHud();
  renderLog();
  layout();
  frame(true);
}

function renderHud() {
  const ms = data.missions;
  cur = currentIndex(data);
  const chapters: Array<{ name: string; first: number }> = [];
  ms.forEach((m, i) => {
    const name = m.chapter || (m.stream_day ? `יום ${m.stream_day}` : 'המסע');
    if (!chapters.length || chapters[chapters.length - 1].name !== name) chapters.push({ name, first: i });
  });
  fill(rail, ...chapters.map((c) => h('li', {}, h('button', { type: 'button', onclick: () => goTo(c.first) }, c.name))));
  rail.dataset.firsts = chapters.map((c) => c.first).join(',');
  rail.hidden = chapters.length < 2;

  timeline.querySelectorAll('.timeline__tick').forEach((t) => t.remove());
  // אין נקודת סיום: העצירה האחרונה לא בקצה הפס, ותמיד נשאר מקום להמשך
  const n = Math.max(ms.length, 1);
  // "פרופיל" לאורך התחתית: גובה לכל עצירה לפי החשיבות שלה (מיילסטון הכי גבוה)
  // גובה לכל עצירה לפי חשיבות, מוחלק (ממוצע נע) – גבעות רכות ולא שיניים, גם עם 70 עצירות
  const raw = ms.map((m) => (m.is_milestone ? 40 : m.kind === 'moment' ? 22 : 14));
  const R = Math.max(1, Math.round(ms.length / 30));
  const hs = raw.map((_, i) => {
    let t = 0;
    let c = 0;
    for (let k = -R; k <= R; k++) {
      const v = raw[i + k];
      if (v === undefined) continue;
      const wgt = R + 1 - Math.abs(k);
      t += v * wgt;
      c += wgt;
    }
    return t / c;
  });
  const xs = ms.map((_, i) => (i / n) * 1000);
  let d = `M0 ${60 - (hs[0] ?? 10)}`;
  for (let i = 1; i < ms.length; i++) {
    const mx = (xs[i - 1] + xs[i]) / 2;
    d += ` C${mx} ${60 - hs[i - 1]} ${mx} ${60 - hs[i]} ${xs[i]} ${60 - hs[i]}`;
  }
  q('[data-profile-line]').setAttribute('d', d);
  const lastX = xs[xs.length - 1] ?? 0;
  const lastY = 60 - (hs[hs.length - 1] ?? 10);
  q('[data-profile-fill]').setAttribute('d', `${d} L${lastX} 60 L0 60 Z`);
  q('[data-profile-ahead]').setAttribute('d', `M${lastX} ${lastY} L1000 ${lastY}`);
  ms.forEach((m, i) => {
    if (!m.is_milestone && i !== cur) return;
    const t = h('button', { type: 'button', class: `timeline__tick ${i === cur ? 'is-now' : ''}`, title: m.title, ariaLabel: m.title, onclick: () => goTo(i) });
    t.style.insetInlineStart = `${(i / n) * 100}%`;
    timeline.append(t);
  });

  const s = data.settings;
  const title = s.title || 'סאבתון GTA 6';
  q('#journey-title').textContent = title;
  document.title = `${title}, המסע על המפה`;
  liveUi.setData(data);
  kickChannel = liveUi.isLive() ? kickSlug(s.kick_channel) : '';
}
let kickChannel = '';

// ── לייב: תג, זמן משחק, מונים, קליפים ──
const liveUi = createLive(stage, {
  onWatch: () => {
    if (cur >= 0) {
      goTo(cur);
      openPanel(cur);
    }
  },
});
let liveData: LiveData | null = null;
const mission = createMissionHud(stage, { reduce });
/** קליפים לפי עצירה (העצירה שהייתה פעילה כשצולמו) */
let clipsByStop = new Map<number, Clip[]>();
function onLive(l: LiveData) {
  liveData = l;
  liveUi.setLive(l);
  mission.setLive(l);
  control.setLive();
  if (data) {
    kickChannel = liveUi.isLive() ? kickSlug(data.settings.kick_channel) : '';
    clipsByStop = new Map();
    // בדמו הקליפים הם מכל המשחקים ומימים אחרים, אז לא משייכים אותם לעצירות (זה היה מטעה)
    for (const c of l.demoClips ? [] : l.clips) {
      const i = clipStop(c, data.missions);
      if (i >= 0) clipsByStop.set(i, [...(clipsByStop.get(i) ?? []), c]);
    }
    pins.forEach((p, i) => p.classList.toggle('pin--clip', clipsByStop.has(i)));
  }
  if (active === -3) openClips(true);
  // פאנל של עצירה שכבר פתוח: מוסיפים את הנתונים והקליפים, בלי לקפוץ לראש הפאנל ובלי לעצור קליפ שמתנגן
  else if (active >= 0 && !panelBody.querySelector('.is-playing, iframe') && ![...panelBody.querySelectorAll('textarea')].some((t) => t.value.trim())) {
    const keep = panelBody.scrollTop;
    openPanel(active, true, true);
    panelBody.scrollTop = keep;
  }
}

function openClips(refresh = false) {
  active = -3;
  userClosed = true;
  const keep = refresh ? panelBody.scrollTop : 0;
  // בזמן שמנגנים קליפ – לא מרעננים את הרשימה מתחת לצופה
  if (refresh && panelBody.querySelector('.is-playing')) return;
  const l = liveData;
  fill(
    panelBody,
    ...clipsView(l?.clips ?? [], data, {
      demo: !!l?.demoClips,
      channel: kickSlug(data.settings.kick_channel),
      onStop: (i) => {
        goTo(i);
        openPanel(i);
      },
      comments: clipComments,
    }),
  );
  panelBody.classList.remove('has-media');
  panel.hidden = false;
  panelBody.scrollTop = keep;
  requestAnimationFrame(() => panel.setAttribute('data-open', ''));
  q<HTMLButtonElement>('[data-panel-prev]').disabled = true;
  q<HTMLButtonElement>('[data-panel-next]').disabled = true;
  pins.forEach((p) => p.classList.remove('pin--active'));
}

/** תגובות על קליפ: כפתור "💬 N" שפותח את השרשור מתחת לקליפ */
function clipComments(c: Clip) {
  const wrap = h('div', { class: 'clip__talk' });
  const n = commentCount('clip', c.id);
  const btn = h('button', { class: 'btn btn--quiet clip__talk-btn', type: 'button', ariaExpanded: 'false' }, n ? `💬 ${n} תגובות` : '💬 להגיב');
  btn.onclick = () => {
    const open = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', String(open));
    wrap.querySelector('.cmts')?.remove();
    if (open) wrap.append(commentsBox(store, 'clip', c.id, { toast, title: false }));
  };
  wrap.append(btn);
  return wrap;
}

/** שורת הנתונים של עצירה: מוות, חתולים, וכמה שעות שיחק עד אליה */
function stopStats(i: number) {
  const m = data.missions[i];
  if (!liveData || !m) return null;
  const d = countOf(liveData, 'deaths', m.id);
  const c = countOf(liveData, 'cats', m.id);
  const until = m.happened_at ? Date.parse(m.happened_at) : Date.now();
  const hrs = playMs(liveData, i === cur ? Date.now() : until);
  const parts = [
    hrs > 60_000 ? h('span', {}, `⏱ ${fmtHours(hrs)} משחק עד כאן`) : null,
    h('span', {}, `💀 ${d}`),
    h('span', {}, `🐈 ${c}`),
  ];
  return h('p', { class: 'stop__stats', ariaLabel: `${d} מיתות ו-${c} חתולים במשימה הזאת` }, ...parts);
}
function stopClips(i: number) {
  const list = clipsByStop.get(i);
  if (!list?.length) return null;
  let stopPlaying: (() => void) | null = null;
  return h(
    'section',
    { class: 'stop__clips' },
    h('h3', { class: 'stamp' }, list.length === 1 ? 'קליפ מכאן' : `${list.length} קליפים מכאן`),
    h(
      'div',
      { class: 'clips clips--row' },
      ...list.slice(0, 6).map((c) =>
        clipCard(c, {
          onPlay: (cl, el) => {
            stopPlaying?.();
            el.classList.add('is-playing');
            stopPlaying = playClip(el, cl);
          },
        }),
      ),
    ),
  );
}

function renderLog() {
  fill(
    logEl,
    ...data.missions.map((m, i) => {
      const meta = [kindLabel(m), metaText(m)].filter(Boolean).join(', ');
      return h(
        'li',
        { class: `stop ${m.is_milestone ? 'stop--ms' : ''} ${i === cur ? 'stop--now' : ''}`, id: `log-${i + 1}` },
        h(
          'details',
          {},
          h(
            'summary',
            { class: 'log__row' },
            h('span', { class: 'log__no' }, stopNo(i)),
            h('span', { class: 'log__name' }, h('strong', {}, m.title), h('span', {}, i === cur ? 'כאן אנחנו עכשיו' : meta)),
            h('span', { class: 'log__chev' }, ico.prev()),
          ),
          h(
            'div',
            { class: 'log__detail' },
            m.summary ? h('p', { class: 'stop__body' }, m.summary) : null,
            ...stopBody(m, i, toast, { embed: false }),
            flat ? null : h('button', { class: 'btn btn--quiet', type: 'button', onclick: () => { goTo(i); openPanel(i); } }, ico.pin(), 'הצגה על המפה'),
          ),
        ),
      );
    }),
  );
}

// צילום של המיקום על המפה – כשעוד אין תמונה מהקטע, כדי שהפאנל לא יהיה ריק
const snapImg = new Image();
snapImg.crossOrigin = 'anonymous';
// התמונה נטענת אחרי שהפאנל כבר נפתח (כניסה מקישור ישיר): מרעננים אותו כדי שתמונת המיקום תופיע
snapImg.onload = () => {
  if (active >= 0 && curve) openPanel(active, true, true);
};
function mapSnapshot(i: number): HTMLElement | null {
  if (!curve || !snapImg.complete || !snapImg.naturalWidth) return null;
  const p = curve.stops[i];
  if (!p) return null;
  const { w: W, h: H } = world.size();
  const kx = snapImg.naturalWidth / W;
  const ky = snapImg.naturalHeight / H;
  const cw = 640;
  const ch = 360;
  const span = Math.min(W, H) * 0.16; // כמה מהמפה רואים
  const sw = span * kx;
  const sh = ((span * ch) / cw) * ky;
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const g = c.getContext('2d')!;
  g.fillStyle = getComputedStyle(document.body).getPropertyValue('--sea') || '#1386a0';
  g.fillRect(0, 0, cw, ch);
  g.drawImage(snapImg, p.x * kx - sw / 2, p.y * ky - sh / 2, sw, sh, 0, 0, cw, ch);
  // סיכה במרכז
  g.beginPath();
  g.arc(cw / 2, ch / 2, 22, 0, Math.PI * 2);
  g.fillStyle = 'rgba(200, 69, 44, 0.25)';
  g.fill();
  g.beginPath();
  g.arc(cw / 2, ch / 2, 9, 0, Math.PI * 2);
  g.fillStyle = '#c8452c';
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = '#1e1b16';
  g.stroke();
  c.setAttribute('role', 'img');
  c.setAttribute('aria-label', 'המיקום על המפה');
  return c;
}

function livePlayer(ch: string) {
  const box = h('div', { class: 'stop__live' });
  fill(
    box,
    h('p', { class: 'stamp' }, 'עכשיו בלייב'),
    h('button', {
      class: 'btn',
      type: 'button',
      onclick: () => fill(box, h('iframe', { src: `https://player.kick.com/${ch}`, allowFullscreen: true, title: 'הלייב', allow: 'autoplay; fullscreen' })),
    }, ico.play(), 'נגן את הלייב כאן'),
    h('a', { class: 'btn btn--quiet', href: `https://kick.com/${ch}`, target: '_blank', rel: 'noopener' }, 'לפתוח ב‑Kick'),
  );
  return box;
}

/** "כל העצירות": רשימה בתוך הפאנל, לחיצה קופצת לעצירה */
function openList() {
  active = -2;
  userClosed = true; // לא להחליף את הרשימה לבד בזמן גלילה
  fill(
    panelBody,
    h('p', { class: 'stop__meta stamp' }, `${data.missions.length} עצירות עד עכשיו`),
    h('h2', { class: 'stop__title', id: 'panel-title' }, 'כל העצירות'),
    h(
      'ol',
      { class: 'list' },
      ...data.missions.map((m, i) =>
        h(
          'li',
          {},
          h(
            'button',
            { type: 'button', class: `list__row ${m.is_milestone ? 'is-ms' : ''} ${i === cur ? 'is-now' : ''}`, onclick: () => { goTo(i); openPanel(i); } },
            h('span', { class: 'list__no' }, String(i + 1)),
            h('span', { class: 'list__name' }, h('strong', {}, m.title), h('span', {}, i === cur ? 'כאן אנחנו עכשיו' : [kindLabel(m), metaText(m)].filter(Boolean).join(' · '))),
          ),
        ),
      ),
    ),
  );
  panelBody.classList.remove('has-media');
  panel.hidden = false;
  panelBody.scrollTop = 0;
  requestAnimationFrame(() => panel.setAttribute('data-open', ''));
  q<HTMLButtonElement>('[data-panel-prev]').disabled = true;
  q<HTMLButtonElement>('[data-panel-next]').disabled = true;
  pins.forEach((p) => p.classList.remove('pin--active'));
}
// ── Mission Control: סרגל, חלונות קופצים, מרקרים, טלפון, סקרים, עריכה ──
const control = createControl({
  // עצירה שנמחקה בזמן שהתפריט שלה פתוח – סוגרים אותו
  onStopDeleted: () => closePanel(),
  store,
  stage,
  world,
  toast,
  data: () => data ?? null,
  live: () => liveData,
  goStop: (i) => goTo(i),
  openStop: (i) => {
    goTo(i);
    openPanel(i);
  },
  stopPoint: (i) => curve?.stops[i] ?? null,
  flyTo: (x, y) => {
    // הטיסה לנקודה חופשית: העצירה הקרובה ביותר אליה
    if (!curve || !data) return;
    const { w, h: hh } = world.size();
    let best = 0;
    let bd = Infinity;
    curve.stops.forEach((p, k) => {
      const dd = Math.hypot(p.x - x * w, p.y - y * hh);
      if (dd < bd) ((bd = dd), (best = k));
    });
    userClosed = true;
    closePanel();
    goTo(best);
  },
  mapImage: snapImg,
  clipComments,
});
// בתוך הטלפון (‎?embed): כפתור "כל העצירות"
const listBtn = q<HTMLButtonElement>('[data-list]');
if (listBtn) {
  listBtn.hidden = !embed;
  listBtn.onclick = () => openList();
}
// תגובות: נטענות פעם אחת; עצירה עם תגובות מקבלת סימן קטן בסיכה
initComments(store, (list) => {
  control.setComments(list);
  if (!data) return;
  const talked = new Set(list.filter((c) => c.target_type === 'stop').map((c) => c.target_id));
  pins.forEach((p, i) => p.classList.toggle('pin--talk', talked.has(data.missions[i]?.id)));
});
if (loginError) setTimeout(() => toast('ההתחברות עם Kick לא הצליחה. נסו שוב.'), 600);

// ── פאנל הצד: פתיחה וסגירה באותו מסלול, וניתן לעצור באמצע ──
let menuTab: 'story' | 'clips' | 'talk' = 'story';
/**
 * תפריט עצירה. בגלילה (auto) – כרטיס צד קטן; בלחיצה על סיכה – תפריט במסך מלא עם לשוניות ומקרא.
 * refresh = רענון נתונים של מה שכבר פתוח (שומר מצב ולשונית)
 */
function openPanel(i: number, auto = false, refresh = false) {
  if (!auto) userClosed = false;
  const m = data.missions[i];
  if (!m) return;
  if (flat) {
    const row = q<HTMLDetailsElement>(`#log-${i + 1} details`);
    if (row) row.open = true;
    q(`#log-${i + 1}`)?.scrollIntoView({ block: 'start' });
    return;
  }
  if (!refresh) {
    panel.classList.toggle('is-menu', !auto);
    if (active !== i) menuTab = 'story';
  }
  active = i;
  const [media, ...rest] = stopBody(m, i, toast, { embed: true, snapshot: mapSnapshot(i) });
  const clips = stopClips(i);
  const nClips = clipsByStop.get(i)?.length ?? 0;
  const nTalk = commentCount('stop', m.id);
  const pane = (key: typeof menuTab, ...kids: Array<Node | string | null | false | undefined>) => {
    const el = h('div', { class: `mtab-pane ${menuTab === key ? 'is-on' : ''}`, id: `mtab-${key}` }, ...kids);
    el.setAttribute('role', 'tabpanel');
    el.dataset.tab = key;
    return el;
  };
  const tab = (key: typeof menuTab, label: string, n = 0) => {
    const b = h('button', { type: 'button', class: 'mtab' }, label, n ? h('span', { class: 'mtab__n' }, String(n)) : null);
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(menuTab === key));
    b.setAttribute('aria-controls', `mtab-${key}`);
    b.onclick = () => {
      menuTab = key;
      panelBody.querySelectorAll<HTMLElement>('.mtab').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      panelBody.querySelectorAll<HTMLElement>('.mtab-pane').forEach((x) => x.classList.toggle('is-on', x.dataset.tab === key));
    };
    return b;
  };
  fill(
    panelBody,
    h(
      'header',
      { class: 'mhead' },
      h('p', { class: 'stop__meta stamp' }, [kindLabel(m), metaText(m)].filter(Boolean).join('  |  ')),
      h('h2', { class: 'stop__title', id: 'panel-title' }, m.title),
      stopStats(i),
      control.isMod()
        ? (() => {
            const b = h('button', { type: 'button', class: 'btn btn--small mod-edit' }, 'עריכת העצירה');
            b.onclick = () => control.editStop(m);
            return b;
          })()
        : null,
      (() => {
        const t = h('div', { class: 'mtabs', ariaLabel: 'תפריט העצירה' }, tab('story', 'סיפור'), tab('clips', 'קליפים', nClips), tab('talk', 'תגובות', nTalk));
        t.setAttribute('role', 'tablist');
        return t;
      })(),
    ),
    pane('story', media, m.body && m.summary ? h('p', { class: 'stop__teaser' }, m.summary) : null, ...rest, i === cur && kickChannel ? livePlayer(kickChannel) : null),
    pane('clips', clips ?? h('p', { class: 'mempty' }, 'עוד אין קליפים מהקטע הזה. קליפ שנעשה בלייב בזמן המשימה יופיע כאן לבד.')),
    pane('talk', commentsBox(store, 'stop', m.id, { toast, title: false })),
    legend(),
  );
  panelBody.classList.toggle('has-media', !!media);
  panel.hidden = false;
  if (!refresh) panelBody.scrollTop = 0;
  requestAnimationFrame(() => panel.setAttribute('data-open', ''));
  q<HTMLButtonElement>('[data-panel-prev]').disabled = i === 0;
  q<HTMLButtonElement>('[data-panel-next]').disabled = i === data.missions.length - 1;
  pins.forEach((p, k) => p.classList.toggle('pin--active', k === i));
  if (!auto) {
    history.replaceState(null, '', `#m-${i + 1}`);
    q<HTMLButtonElement>('[data-panel-close]').focus({ preventScroll: true });
  }
}
function closePanel() {
  if (active === -1) return;
  panel.removeAttribute('data-open');
  panel.classList.remove('is-menu');
  active = -1;
  pins.forEach((p) => p.classList.remove('pin--active'));
  history.replaceState(null, '', location.pathname + location.search);
}
panel.addEventListener('transitionend', (e) => {
  if (e.target === panel && !panel.hasAttribute('data-open')) {
    panel.hidden = true;
    fill(panelBody); // עוצר וידאו
  }
});
q('[data-panel-close]').onclick = () => {
  userClosed = true;
  closePanel();
};
q('[data-panel-prev]').onclick = () => {
  const i = Math.max(0, active - 1);
  goTo(i);
  openPanel(i);
};
q('[data-panel-next]').onclick = () => {
  const i = Math.min(data.missions.length - 1, active + 1);
  goTo(i);
  openPanel(i);
};
enableSheetDrag(panel, [q('[data-grip]'), panelBody], () => {
  userClosed = true;
  closePanel();
});
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (cinema) {
    stopCinema();
    return;
  }
  if (active !== -1) {
    userClosed = true;
    closePanel();
  }
  else if (world.exploring()) explore(false);
});

// ── גרירה חופשית ──
function explore(on: boolean) {
  world.explore(on);
  document.documentElement.classList.toggle('no-scroll', on);
  if (!on) frame(true);
}
q('[data-explore]').onclick = () => explore(true);
q('[data-explore-close]').onclick = () => explore(false);

// ── גלילה ← מצלמה: האתר לא נגלל; גלילה למעלה מקדמת במסע, גלילה למטה חוזרת ──
const PX_WHEEL = 300; // כמה פיקסלים של גלגלת לכל עצירה
const PX_TOUCH = 140; // כמה פיקסלים של גרירה לכל עצירה
const project = (v: number, d = 0.998) => ((v / 1000) * d) / (1 - d);
const maxF = () => (data ? data.missions.length - 1 + 0.6 : 0);
const clampF = (f: number) => Math.min(maxF(), Math.max(-1, f));
/** העצירה הקרובה שאפשר "לנחות" עליה (כולל הפתיחה וסוף הקו) */
function snapF(f: number) {
  const top = maxF();
  if (f > top - 0.3) return top;
  return Math.max(-1, Math.round(f));
}
function layout() {}

function goTo(i: number) {
  if (flat || !data) return;
  focus = clampF(i);
  travelTo = Math.abs(focus - shown) > 1.5 && i >= 0 ? focus : null;
  if (reduce) shown = focus;
}

const inPanel = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('.panel');
let snapTimer = 0;
addEventListener(
  'wheel',
  (e) => {
    if (flat || !data || world.exploring() || inPanel(e.target)) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? innerHeight : 1;
    focus = clampF(focus - (e.deltaY * unit) / PX_WHEEL);
    clearTimeout(snapTimer);
    snapTimer = window.setTimeout(() => (focus = snapF(focus)), 220);
  },
  { passive: false },
);

// מגע: גוררים את המפה למטה כדי להתקדם (רואים את מה שמעל), למעלה כדי לחזור
let touch: { id: number; y0: number; f0: number; moved: boolean; hist: Array<{ y: number; t: number }> } | null = null;
stage.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' || flat || world.exploring() || inPanel(e.target)) return;
  touch = { id: e.pointerId, y0: e.clientY, f0: focus, moved: false, hist: [{ y: e.clientY, t: performance.now() }] };
});
stage.addEventListener('pointermove', (e) => {
  if (!touch || e.pointerId !== touch.id) return;
  const dy = e.clientY - touch.y0;
  if (!touch.moved && Math.abs(dy) < 8) return; // סף קטן כדי שלחיצה על סיכה תישאר לחיצה
  if (!touch.moved) stage.setPointerCapture(e.pointerId);
  touch.moved = true;
  focus = clampF(touch.f0 + dy / PX_TOUCH);
  shown = focus; // מעקב 1:1 אחרי האצבע
  touch.hist.push({ y: e.clientY, t: performance.now() });
  if (touch.hist.length > 6) touch.hist.shift();
});
const endTouch = (e: PointerEvent) => {
  if (!touch || e.pointerId !== touch.id) return;
  if (touch.moved) {
    const now = performance.now();
    const r = touch.hist.filter((p) => now - p.t < 100);
    const v = r.length > 1 ? ((r[r.length - 1].y - r[0].y) / Math.max(1, r[r.length - 1].t - r[0].t)) * 1000 : 0;
    // נוחתים על העצירה הקרובה לנקודה שהמומנטום מנבא
    focus = snapF(clampF(focus + project(v) / PX_TOUCH));
  }
  touch = null;
};
stage.addEventListener('pointerup', endTouch);
stage.addEventListener('pointercancel', endTouch);

addEventListener('keydown', (e) => {
  if (flat || !data || world.exploring() || (e.target as HTMLElement).closest('input, textarea, select')) return;
  const here = Math.round(Math.max(-1, Math.min(data.missions.length - 1, focus)));
  const map: Record<string, number | undefined> = {
    ArrowUp: here + 1,
    PageUp: here + 1,
    ' ': here + 1,
    ArrowDown: here - 1,
    PageDown: here - 1,
    // מימין לשמאל: שמאלה = קדימה במסע
    ArrowLeft: here + 1,
    ArrowRight: here - 1,
    Home: -1,
    End: cur,
  };
  const to = map[e.key];
  if (to === undefined || inPanel(e.target)) return;
  e.preventDefault();
  goTo(to);
});

// קיצורים: C קליפים, S סטטיסטיקות, M / Esc חזרה למפה, K מצב קולנוע
addEventListener('keydown', (e) => {
  if (flat || !data || e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest('input, textarea, select')) return;
  const k = e.key.toLowerCase();
  if (k === 'k' || k === 'ל') (cinema ? stopCinema() : startCinema());
  else if (k === 'm' || k === 'צ') {
    if (cinema) stopCinema();
    if (active !== -1) {
      userClosed = true;
      closePanel();
    }
    if (world.exploring()) explore(false);
  } else return;
  e.preventDefault();
});

// ── מצב קולנוע: בלי HUD, טיסה איטית לאורך כל המסלול עד "עכשיו" ──
let cinema = false;
let cinemaRaf = 0;
function startCinema() {
  if (!data || world.exploring()) return;
  cinema = true;
  userClosed = true;
  closePanel();
  stage.classList.add('is-cinema');
  focus = shown = -1;
  let t0 = performance.now();
  const speed = reduce ? 4 : 0.55; // עצירות לשנייה
  const step = (now: number) => {
    if (!cinema) return;
    const dt = Math.min(0.1, (now - t0) / 1000);
    t0 = now;
    focus = Math.min(cur, focus + dt * speed);
    if (focus >= cur && Math.abs(shown - cur) < 0.02) {
      window.setTimeout(stopCinema, 2500);
      return;
    }
    cinemaRaf = requestAnimationFrame(step);
  };
  cinemaRaf = requestAnimationFrame(step);
  toast('מצב קולנוע: Esc או K ליציאה');
}
function stopCinema() {
  if (!cinema) return;
  cinema = false;
  cancelAnimationFrame(cinemaRaf);
  stage.classList.remove('is-cinema');
  focus = snapF(focus);
}
q('[data-cinema]').onclick = startCinema;
// כל מגע/גלילה עוצרים את הטיסה
addEventListener('wheel', () => cinema && stopCinema(), { passive: true });
stage.addEventListener('pointerdown', () => cinema && stopCinema());

function onScroll() {}
addEventListener('resize', () => frame(true));

let last = performance.now();
function frame(force = false) {
  if (!curve || !data) return;
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  const { w: vw, h: vh } = world.view();
  const wantShift = active >= 0 && vw > 760 ? panel.offsetWidth / 2 + 16 : 0;
  // הטיה (מבט רחפן): גדלה עם הכניסה למסע; שטוח במבט הפתיחה, בגרירה חופשית ובהפחתת תנועה
  const kNow = Math.min(1, Math.max(0, shown + 1));
  const easeT = kNow * kNow * (3 - 2 * kNow);
  const tripTilt = vw <= 760 ? 30 : 40;
  const wantTilt = reduce || world.exploring() ? 0 : tripTilt * easeT;
  const settling = Math.abs(wantShift - panelShift) > 0.5 || Math.abs(wantTilt - tiltShown) > 0.05;
  if (!force && Math.abs(focus - shown) < 0.0004 && !world.exploring() && !settling) return;
  const k1 = force || reduce ? 1 : 1 - Math.exp(-dt * 6);
  shown += (focus - shown) * k1;
  panelShift += (wantShift - panelShift) * (force || reduce ? 1 : 1 - Math.exp(-dt * 8));
  tiltShown += (wantTilt - tiltShown) * (force || reduce ? 1 : 1 - Math.exp(-dt * 7));
  world.setTilt(tiltShown);
  horizon.style.opacity = String(Math.min(1, tiltShown / 35));

  const n = data.missions.length;
  const { w, h: hh } = world.size();
  // זום המסע: לפי ההגדרה, אבל תמיד ממלא את רוחב המסך
  const tripZ = Math.max(world.fitZ() * Math.max(1, data.settings.map_zoom || 3), vw / w);
  // מבט הפתיחה: כל המפה, בשטח שהכרטיס של הפתיחה לא מכסה (לידו בדסקטופ, מעליו בטלפון)
  const mobile = vw <= 760;
  // מבט הפתיחה: כל המפה בשטח שכרטיס הפתיחה לא מכסה (לידו בדסקטופ, מעליו בטלפון); הים ממלא את השאר
  const op = opening.getBoundingClientRect();
  const free = mobile ? { x0: 0, x1: vw, y0: 0, y1: Math.max(vh * 0.45, op.top - 8) } : { x0: op.right + 16, x1: vw, y0: 0, y1: vh };
  const overZ = Math.min((free.x1 - free.x0) / w, (free.y1 - free.y0) / hh) * 0.94;
  const overX = w / 2 - ((free.x0 + free.x1) / 2 - vw / 2) / overZ;
  const overY = hh / 2 - ((free.y0 + free.y1) / 2 - vh / 2) / overZ;
  // פתיחה: ממבט על כל המפה אל המצלמה שעוקבת אחרי המסלול
  const k = Math.min(1, Math.max(0, shown + 1));
  const ease = k * k * (3 - 2 * k);
  const p = curve.atSmooth(curve.sOf(Math.max(0, shown)));
  // במסע: אם המפה צרה מהמסך היא נשארת ממורכזת, אחרת המצלמה לא יוצאת מגבולות המפה
  // מותר לחרוג מעט מקצה המפה (160px מסך), כדי שסיכה בקצה לא תידחק מתחת לפקדים
  const slack = (160 + panelShift) / tripZ;
  const keep = (v: number, size: number, screen: number) =>
    size * tripZ <= screen ? size / 2 : Math.min(size - screen / 2 / tripZ + slack, Math.max(screen / 2 / tripZ - slack, v));
  // הפאנל צמוד לימין: מזיזים את המצלמה כך שהסיכה תהיה במרכז השטח שנשאר משמאלו
  // (כשהמפה בדיוק ברוחב המסך היא לא זזה הצידה – חוץ מכשהפאנל פתוח וצריך לפנות לו מקום)
  const tx = panelShift > 1 ? Math.min(w - vw / 2 / tripZ + slack, Math.max(vw / 2 / tripZ - slack, p.x + panelShift / tripZ)) : keep(p.x, w, vw);
  // בטלפון הסיכה הפעילה יושבת גבוה יותר, כדי שהכרטיס שמתחתיה לא יסתיר את הפקדים
  // בטלפון הסיכה הפעילה יושבת גבוה יותר (מקום לכרטיס מתחתיה); כשהמפה מוטה בדסקטופ – נמוך יותר, כדי לראות את ההמשך לפנים
  const lift = mobile ? vh * 0.2 : -vh * 0.12 * Math.min(1.3, tiltShown / 40);
  const ty = keep(p.y + lift / tripZ, hh, vh);
  const z = overZ + (tripZ - overZ) * ease;
  world.setCamera({ x: overX + (tx - overX) * ease, y: overY + (ty - overY) * ease, z });
  world.apply();

  // הפתיחה נעלמת כשנכנסים למסלול, וה-HUD מופיע
  hud.classList.toggle('is-on', k > 0.55);
  stage.classList.toggle('is-overview', k < 0.5);
  opening.style.opacity = String(Math.max(0, 1 - k * 2.2));
  opening.style.visibility = k > 0.45 ? 'hidden' : '';

  // המסלול נמתח עם הגלילה עד העצירה הנוכחית
  const sNow = cur >= 0 ? curve.stopS[cur] : 0;
  const reveal = sNow > 0 ? Math.min(1, Math.max(0, curve.sOf(Math.max(0, shown)) / sNow)) : 1;
  const off = String(1 - Math.max(reveal * k, 0.0001));
  routeDone.style.strokeDashoffset = off;
  routeCasing.style.strokeDashoffset = off;

  const near = Math.round(shown);
  pins.forEach((pin, i) => {
    const s = world.project(curve!.stops[i]);
    // רחוק = קטן יותר (עומק), קרוב = קצת גדול
    const depth = Math.pow(Math.min(1.25, Math.max(0.55, s.s)), 0.8);
    pin.style.transform = `translate3d(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px, 0) scale(${depth.toFixed(3)})`;
    pin.style.zIndex = String(Math.round(s.y));
    pin.classList.toggle('pin--near', !world.exploring() && i === near && Math.abs(shown - i) < 0.45 && k >= 1);
    pin.classList.toggle('pin--flip', s.x < vw * 0.42);
    pin.hidden = s.x < -80 || s.y < -80 || s.x > vw + 80 || s.y > vh + 80;
  });
  // כמו ביומן מסע: בדסקטופ הפאנל צמוד לצד ומתעדכן לבד לעצירה הקרובה
  if (!mobile && !world.exploring()) {
    const target = Math.max(0, Math.min(n - 1, near));
    // בדרך לעצירה שנבחרה בלחיצה – לא מחליפים את הפאנל בכל עצירה שעוברים
    if (travelTo !== null && Math.abs(shown - travelTo) < 0.3) travelTo = null;
    if (k >= 0.97 && !userClosed && travelTo === null && target !== active) openPanel(target, true);
    else if (k < 0.6 && active >= 0) closePanel();
  }
  control.place();
  const tag = pinsEl.querySelector<HTMLElement>('.ahead-tag');
  if (tag) {
    // התווית מתחילה בסוף הקו ופונה החוצה, כדי לא לכסות את הסיכה האחרונה
    const e = world.project(curve.end);
    const lastPt = world.project(curve.stops[n - 1] ?? curve.end);
    const dx = e.x - lastPt.x;
    const dy = e.y - lastPt.y;
    const ax = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? '-100%' : '0%') : '-50%';
    const ay = Math.abs(dx) > Math.abs(dy) ? '-50%' : dy < 0 ? '-100%' : '0%';
    tag.style.transform = `translate3d(${e.x.toFixed(1)}px, ${e.y.toFixed(1)}px, 0) translate(${ax}, ${ay})`;
  }
  const me = pinsEl.querySelector<HTMLElement>('.player');
  // בלי עצירות אין איפה לעמוד – אחרת הסמן נתקע בפינה השמאלית העליונה
  if (me) me.style.display = cur >= 0 && curve.stops[cur] ? '' : 'none';
  if (me && cur >= 0 && curve.stops[cur]) {
    const s = world.project(curve.stops[cur]);
    me.style.transform = `translate3d(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px, 0)`;
  }

  // HUD
  const idx = Math.max(0, Math.min(n - 1, near));
  const m = data.missions[idx];
  q('[data-odo-day]').textContent = `יום ${m?.stream_day ?? 1}`;
  q('[data-odo-stop]').textContent = `משימה ${n ? idx + 1 : 0}`;
  q('[data-odo-ms]').textContent = `${data.missions.slice(0, idx + 1).filter((x) => x.is_milestone).length} מיילסטונים`;
  const pct = Math.max(0, Math.min(1, shown / Math.max(n, 1)));
  q('[data-progress-now]').style.insetInlineStart = `${pct * 100}%`;
  const firsts = (rail.dataset.firsts || '').split(',').map(Number);
  let ch = 0;
  firsts.forEach((f, j) => {
    if (idx >= f) ch = j;
  });
  rail.querySelectorAll('button').forEach((b, j) => b.toggleAttribute('aria-current', j === ch));

  const c = world.camera();
  locView.setAttribute('x', String(c.x - vw / 2 / c.z));
  locView.setAttribute('y', String(c.y - vh / 2 / c.z));
  locView.setAttribute('width', String(vw / c.z));
  locView.setAttribute('height', String(vh / c.z));
}

// מים ועננים: זזים כל הזמן (גם כשהמפה עומדת), חוץ מבהפחתת תנועה או כשהלשונית ברקע
let water: Water | null = null;
let life: Life | null = null;
let liveTrail: ReturnType<typeof makeTrail> | null = null;
const lite = matchMedia('(max-width: 760px), (pointer: coarse)').matches;
const t0 = performance.now();
let lastAmbient = t0;
let tick = 0;
function ambient(now: number) {
  const dt = Math.min((now - lastAmbient) / 1000, 0.1);
  lastAmbient = now;
  const { w, h: hh } = world.size();
  if (w <= 1) return;
  const { w: vw, h: vh } = world.view();
  const cam = world.camera();
  const time = reduce ? 0 : (now - t0) / 1000;
  // בטלפון המים מצוירים ב-30 פריימים לשנייה, אלא אם המפה עצמה זזה
  if (water && (!lite || tick++ % 2 === 0 || Math.abs(focus - shown) > 0.001 || world.exploring())) water.render(cam, world.tilt(), world.persp(), vw, vh, w, hh, time);
  life?.update(dt, !reduce);
  const pinNow = active >= 0 && curve ? world.project(curve.stops[active]) : null;
  for (const c of clouds) {
    if (!reduce) {
      c.x += c.speed * dt;
      if (c.x > 1.3) c.x = -0.3;
    }
    const g = { x: c.x * w, y: c.y * hh };
    const top = world.project(g, c.alt * w); // הענן עצמו, בגובה
    const sh = world.project({ x: g.x + c.alt * w * 0.5, y: g.y + c.alt * w * 0.35 }); // הצל על הקרקע, מוסט לפי השמש
    const cw = c.size * w * cam.z;
    const off = top.x < -cw || top.x > vw + cw || top.y < -cw || top.y > vh + cw;
    c.el.hidden = c.shadow.hidden = off;
    if (off) continue;
    c.el.style.transform = `translate3d(${top.x.toFixed(1)}px, ${top.y.toFixed(1)}px, 0) translate(-50%, -50%) scale(${((cw * top.s) / 640).toFixed(4)})`;
    c.shadow.style.transform = `translate3d(${sh.x.toFixed(1)}px, ${sh.y.toFixed(1)}px, 0) translate(-50%, -50%) scale(${((cw * sh.s) / 640).toFixed(4)}, ${((cw * sh.s * Math.cos((world.tilt() * Math.PI) / 180)) / 640).toFixed(4)})`;
    // ענן שעובר מעל העצירה הפתוחה מתבהר, כדי לא להסתיר אותה
    const d = pinNow ? Math.hypot(top.x - pinNow.x, top.y - pinNow.y) : 1e9;
    c.el.style.opacity = String(0.25 + 0.6 * Math.min(1, Math.max(0, (d - cw * 0.35) / (cw * 0.5))));
  }
}
(function loop() {
  requestAnimationFrame(loop);
  if (document.hidden) return;
  frame();
  if (!flat) ambient(performance.now());
})();

q('[data-jump-now]').onclick = () => goTo(cur);
q('[data-start]').onclick = () => goTo(0);

// ── התחלה ──
type HdSet = { tiles: string[]; grid: number; w: number };
let padMeta: { pad: string; mx: number; my: number; hd?: Record<string, HdSet>; sea?: string; edge?: string; clouds?: string[] } | null = null;
// רמת ה-HD המלאה רק במחשב (מסך רחב, עכבר); בטלפון רמה אחת פחות, כדי לא להכביד על הזיכרון
const wantHd = matchMedia('(min-width: 900px) and (pointer: fine)').matches;
fetch(`${import.meta.env.BASE_URL}map.json`)
  .then((r) => (r.ok ? r.json() : null))
  .then((j) => {
    padMeta = j;
    if (data) setMap();
    return j?.trail ? fetch(`${import.meta.env.BASE_URL}${j.trail}`).then((r) => r.json()) : null;
  })
  .then((t) => {
    trailRaw = t;
  })
  .catch(() => {})
  .finally(() => {
    trailPending = false;
    rebuild();
    frame(true);
    if (active >= 0 && curve) openPanel(active, true, true); // קישור ישיר: הפאנל נפתח לפני שהמסלול נבנה
  });
function setMap() {
  const custom = safeUrl(data.settings.map_image_url);
  const url = custom || DEFAULT_MAP;
  world.setImage(url);
  if (snapImg.getAttribute('src') !== url) snapImg.src = url;
  // ים מסביב: למפה המקורית יש קובץ מוכן; למפה שהועלתה – צבע הים מסביב
  world.setPad(!custom && padMeta ? `${import.meta.env.BASE_URL}${padMeta.pad}` : null, padMeta?.mx, padMeta?.my);
  const B = import.meta.env.BASE_URL;
  const levels = !custom && padMeta?.hd ? [padMeta.hd.lite, wantHd ? padMeta.hd.full : null].filter((x): x is HdSet => !!x) : [];
  world.setHd(levels.map((x) => ({ ...x, tiles: x.tiles.map((u) => `${B}${u}`) })));
  // מים ועננים: רק למפה המקורית (יש לה מסכת ים)
  if (!custom && padMeta?.sea && !water && !flat) water = createWater(world.tiltLayer, `${B}${padMeta.sea}`, lite);
  world.setEdge(!custom && padMeta?.edge ? `${B}${padMeta.edge}` : null);
  water?.show(!custom);
  if (!custom && padMeta?.sea && !life && !flat) {
    life = createLife(sky, world, `${B}${padMeta.sea}`, lite);
    life.setTrail(liveTrail);
  }
  life?.show(!custom);
  if (!custom && padMeta?.clouds && !clouds.length && !flat) makeClouds(padMeta.clouds.map((u) => `${B}${u}`));
  sky.hidden = !!custom;
  const hadTrail = useTrail;
  useTrail = !custom;
  if (hadTrail !== useTrail) rebuild();
  locImg.src = url;
}

store
  .load()
  .then((d) => {
    data = d;
    layout();
    renderHud();
    renderLog();
    onScroll();
    const hash = location.hash.match(/^#m-(\d+)$/);
    if (hash && data.missions[+hash[1] - 1]) {
      const i = +hash[1] - 1;
      const open = () => {
        goTo(i);
        openPanel(i);
      };
      if (flat) open();
      else onMapReady = open;
    } else if (embed && !flat) onMapReady = () => goTo(currentIndex(data));
    // באפליקציה: מעבר לעצירה אחרת בלי טעינה מחדש (‎#m-N)
    if (embed)
      addEventListener('hashchange', () => {
        const m = location.hash.match(/^#m-(\d+)$/);
        const i = m ? +m[1] - 1 : -1;
        if (data.missions[i]) {
          goTo(i);
          openPanel(i);
        }
      });
    setMap();
    control.setData(data);
    store.loadLive().then(onLive).catch(console.error);
    store.subscribeLive(onLive);
    store.subscribe((next) => {
      const known = new Set(data.missions.map((x) => x.id));
      const added = next.missions.filter((x: Mission) => !known.has(x.id));
      const before = data.missions[currentIndex(data)];
      data = next;
      setMap();
      rebuild();
      control.setData(next);
      if (added.length) {
        const n = added[added.length - 1];
        const done = before && before.id !== n.id ? before.title : null;
        mission.banner(done, n.title);
      }
    });
  })
  .catch((e) => {
    console.error(e);
    q('#journey-title').textContent = 'המסע לא נטען';
    toast('לא הצלחנו לטעון את הנתונים. נסו לרענן את הדף');
  });

// אפליקציה (PWA): מעטפת שעובדת גם בקליטה חלשה
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => {});

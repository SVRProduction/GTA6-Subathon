// phone.html – "הטלפון" כעמוד עצמאי שאפשר להתקין כאפליקציה (PWA).
// אותו רכיב בדיוק כמו הפופאפ במפה (src/control/phone.ts): סטוריז, העלאת סטורי, צ׳אט וסקר.
// מה שקשור למפה (פתיחת עצירה, מיקום של סקר) מוביל לעמוד המפה.
import { initComments } from './comments';
import { createPhone } from './control/phone';
import { svg } from './control/icons';
import { createStoryViewer } from './control/stories';
import { createStore } from './data/store';
import type { Comment, Data } from './data/types';
import { h, safeUrl } from './dom';
import { buildCurve, makeTrail, placeAll } from './journey/route';

const store = createStore();
const stage = document.querySelector<HTMLElement>('[data-stage]')!;
const BASE = import.meta.env.BASE_URL;
const MAP = `${BASE}map-original.webp`;

let toastTimer = 0;
function toast(text: string) {
  const t = document.getElementById('toast')!;
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove('show'), 4000);
}

const toMap = (hash = '') => (location.href = `${BASE}${hash}`);

// ── כותרת: חזרה למפה + התקנה ──
let deferred: (Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }) | null = null;
const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);
const install = h('button', { class: 'pp-install', hidden: true }, svg('download', 18), h('span', {}, 'להתקין'));
const mapLink = h('a', { class: 'pp-map', href: BASE, ariaLabel: 'למפה' }, svg('map', 18), h('span', {}, 'המפה'));
const head = h('div', { class: 'pp-head' }, install, mapLink);

addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e as typeof deferred;
  install.hidden = standalone;
});
addEventListener('appinstalled', () => {
  install.hidden = true;
  toast('הותקן. הטלפון מחכה לך במסך הבית.');
});
// באייפון אין חלון התקנה – מסבירים איך מוסיפים למסך הבית
if (ios && !standalone) install.hidden = false;
install.onclick = async () => {
  if (deferred) {
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === 'accepted') install.hidden = true;
    deferred = null;
    return;
  }
  showIosHelp();
};
function showIosHelp() {
  const sheet = h(
    'div',
    { class: 'pp-ios', role: 'dialog', ariaModal: 'true', ariaLabel: 'התקנה באייפון' },
    h(
      'div',
      { class: 'pp-ios__card' },
      h('strong', {}, 'להתקין את הטלפון באייפון'),
      h('ol', {}, h('li', {}, 'לוחצים על כפתור השיתוף של Safari (הריבוע עם החץ, למטה).'), h('li', {}, 'בוחרים "הוספה למסך הבית".'), h('li', {}, 'לוחצים "הוספה". האייקון של הסאבתון מופיע במסך הבית ונפתח כמו אפליקציה.')),
      (() => { const b = h('button', { class: 'btn btn--primary' }, 'הבנתי'); b.type = 'button'; b.onclick = () => sheet.remove(); return b; })(),
    ),
  );
  sheet.addEventListener('click', (e) => e.target === sheet && sheet.remove());
  document.body.append(sheet);
  sheet.querySelector<HTMLButtonElement>('button')!.focus();
}

// ── רקע לסטורי רשמי: תמונת העצירה, או חיתוך המפה סביב המקום שלה ──
const mapImg = new Image();
mapImg.crossOrigin = 'anonymous';
mapImg.src = MAP;
let trailRaw: Array<[number, number]> | null = null;
fetch(`${BASE}trail.json`)
  .then((r) => (r.ok ? r.json() : null))
  .then((t) => (trailRaw = t))
  .catch(() => {});
let data: Data | null = null;
let points: Array<{ x: number; y: number }> = [];
function computePoints() {
  if (!data || !mapImg.naturalWidth) return;
  const W = mapImg.naturalWidth;
  const H = mapImg.naturalHeight;
  const trail = !data.settings.map_image_url && trailRaw ? makeTrail(trailRaw, W, H) : null;
  points = buildCurve(placeAll(data.missions, trail), W, H, trail).stops;
}
mapImg.onload = computePoints;

function stopBg(i: number): HTMLElement | null {
  const m = data?.missions[i];
  const img = safeUrl(m?.image_url);
  if (img) return h('img', { class: 'st-img', src: img, alt: m?.title ?? '' });
  computePoints();
  const p = points[i];
  if (!p || !mapImg.naturalWidth) return null;
  const w = 900;
  const hh = 1600;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = hh;
  const g = c.getContext('2d')!;
  const sw = Math.min(mapImg.naturalWidth, mapImg.naturalHeight) * 0.16;
  const sh = (sw * hh) / w;
  g.fillStyle = '#0b2f4a';
  g.fillRect(0, 0, w, hh);
  g.drawImage(mapImg, p.x - sw / 2, p.y - sh / 2, sw, sh, 0, 0, w, hh);
  c.className = 'st-img';
  c.setAttribute('role', 'img');
  c.setAttribute('aria-label', `המקום של ${m?.title ?? 'העצירה'} על המפה`);
  return h('div', { class: 'st-crop' }, c, h('span', { class: 'st-pin', ariaHidden: 'true' }));
}

// ── הטלפון ──
const viewer = createStoryViewer({ store, toast, stopBg, goStop: (i) => toMap(`#m-${i + 1}`) });
const phone = createPhone({
  stage,
  store,
  toast,
  page: true,
  headExtra: head,
  openStories: (list, i) => viewer.open(list, i),
  openStop: (i) => toMap(`#m-${i + 1}`),
  openTarget: (c: Comment) => {
    if (c.target_type === 'stop' && data) {
      const i = data.missions.findIndex((m) => m.id === c.target_id);
      return toMap(i >= 0 ? `#m-${i + 1}` : '');
    }
    toMap(c.target_type === 'clip' ? '#clips' : '');
  },
  locatePoll: () => toMap('#poll'),
});

const TABS = ['stories', 'upload', 'chat', 'poll'] as const;
const fromHash = TABS.find((t) => location.hash === `#${t}`);
phone.open(fromHash ?? 'stories');

store
  .load()
  .then((d) => {
    data = d;
    computePoints();
    phone.setData(d);
    store.subscribe((nd) => {
      data = nd;
      computePoints();
      phone.setData(nd);
    });
  })
  .catch(() => toast('הנתונים לא נטענו. נסו לרענן.'));
store.loadExtras(false).then((e) => phone.setExtras(e)).catch(console.error);
store.subscribeExtras((e) => phone.setExtras(e), false);
initComments(store, (list) => phone.setComments(list));

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register(`${BASE}sw.js`, { scope: BASE }).catch(() => {});

// קישור לשונית (‎#poll וכו') גם כשהעמוד כבר פתוח
addEventListener('hashchange', () => {
  const t = TABS.find((x) => location.hash === `#${x}`);
  if (t) phone.open(t);
});

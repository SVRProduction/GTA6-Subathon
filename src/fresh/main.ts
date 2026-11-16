// "הדרך" – אתר הצופים של סאבתון GTA 6.
// חשוב: auth נטען ראשון, כי הוא מנקה את ‎#kick_session=… מהכתובת לפני שהנתב קורא אותה.
import { getViewer, loginError, logout, onViewer } from '../auth';
import { h } from '../dom';
import { createClips } from './clips';
import { createDash, createLivePill } from './dash';
import { createMap } from './map';
import { createRoad } from './road';
import { closeSheet, mountSheet, openClip, openStop, sheetKey } from './sheet';
import { boot, on, state, store } from './state';
import { bdi, ico, toast } from './ui';

type Tab = 'road' | 'clips' | 'map';
const TABS: Array<{ id: Tab; label: string; icon: () => SVGElement }> = [
  { id: 'road', label: 'הדרך', icon: ico.road },
  { id: 'clips', label: 'קליפים', icon: ico.clips },
  { id: 'map', label: 'מפה', icon: ico.map },
];

const app = document.getElementById('app')!;

// ── כותרת ──
const titleEl = h('span', { class: 'brand__t' });
const brand = h('a', { class: 'brand', href: '#/road' },
  h('span', { class: 'shield', ariaHidden: 'true' }, h('span', { class: 'shield__top' }, 'GTA'), h('span', { class: 'shield__n' }, 'VI')),
  h('span', { class: 'brand__txt' }, titleEl, h('span', { class: 'brand__sub' }, 'הדרך של ', bdi('odedsvr'))),
);
const who = h('div', { class: 'who' });
function drawWho() {
  const v = getViewer();
  if (!v) {
    who.replaceChildren();
    return;
  }
  who.replaceChildren(
    h('span', { class: 'who__name', title: `מחובר בתור ${v.username}` }, bdi(v.username)),
    h('button', { type: 'button', class: 'who__out', ariaLabel: 'התנתקות', title: 'התנתקות', onclick: () => { logout(); toast('התנתקת'); } }, ico.logout()),
  );
}
drawWho();
onViewer(drawWho);

const nav = h('nav', { class: 'tabs', ariaLabel: 'ניווט ראשי' });
const tabLinks = new Map<Tab, HTMLAnchorElement>();
for (const t of TABS) {
  const a = h('a', { class: 'tabs__a', href: `#/${t.id}` }, t.icon(), h('span', {}, t.label));
  tabLinks.set(t.id, a);
  nav.append(a);
}
const header = h('header', { class: 'top' }, h('div', { class: 'top__in' }, brand, nav, h('div', { class: 'top__end' }, createLivePill(), who)));

// ── תצוגות ──
const dash = createDash();
const road = createRoad();
const clips = createClips();
const map = createMap();
const views: Record<Tab, HTMLElement> = {
  road: h('div', { class: 'view view--road' }, h('aside', { class: 'side' }, dash), road),
  clips: h('div', { class: 'view view--clips' }, clips),
  map: h('div', { class: 'view view--map' }, map.el),
};
const main = h('main', { class: 'main', id: 'main' }, ...Object.values(views));
app.append(header, main);

// ── ניתוב (רק hash, כי GitHub Pages בתת-תיקייה) ──
let tab: Tab = 'road';
let pushedModal = false;

function parse() {
  const raw = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const [path, query] = raw.split('?');
  const [a, ...rest] = path.split('/');
  const id = rest.join('/');
  const q = new URLSearchParams(query ?? '');
  if (a === 'stop' && id) return { modal: { kind: 'stop' as const, id } };
  if (a === 'clip' && id) return { modal: { kind: 'clip' as const, id } };
  if (a === 'clips' || a === 'map' || a === 'road') return { tab: a as Tab, q };
  return { tab: 'road' as Tab, q };
}

function setTab(t: Tab, q?: URLSearchParams) {
  const changed = t !== tab;
  tab = t;
  for (const [k, v] of Object.entries(views)) v.hidden = k !== t;
  tabLinks.forEach((a, k) => (k === t ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  document.body.dataset.tab = t;
  if (t === 'map') map.onShow(q?.get('stop') ?? null);
  if (changed) window.scrollTo({ top: 0 });
}

function route() {
  const r = parse();
  if (r.modal) {
    if (r.modal.kind === 'stop') openStop(r.modal.id);
    else openClip(r.modal.id);
    // התצוגה שמאחור: קליפ → קליפים; עצירה – נשארים איפה שהיינו
    if (r.modal.kind === 'clip' && tab !== 'clips') setTab('clips');
    else setTab(tab);
    return;
  }
  if (sheetKey()) {
    pushedModal = false;
    closeSheet();
  }
  setTab(r.tab, r.q);
}

// כל לחיצה על קישור פנימי לחלונית = צעד היסטוריה, כדי ש"חזור" בטלפון יסגור אותה
document.addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest?.('a[href^="#/stop/"], a[href^="#/clip/"]');
  if (a && !e.defaultPrevented && !(e as MouseEvent).metaKey && !(e as MouseEvent).ctrlKey) pushedModal = true;
});

mountSheet(() => {
  // החלונית נסגרה (Esc / כפתור / רקע): חוזרים לכתובת של התצוגה
  if (!parse().modal) return;
  if (pushedModal) {
    pushedModal = false;
    history.back();
  } else {
    history.replaceState(null, '', `#/${tab}`);
    route();
  }
});

window.addEventListener('hashchange', route);

// ── עצירה חדשה בלייב ──
let knownIds: Set<string> | null = null;
on('data', () => {
  document.title = `הדרך · ${state.data.settings.title || 'סאבתון GTA 6'}`;
  titleEl.textContent = state.data.settings.title || 'סאבתון GTA 6';
  const ids = new Set(state.data.missions.map((m) => m.id));
  if (knownIds && state.loaded) {
    const fresh = state.data.missions.filter((m) => !knownIds!.has(m.id));
    const m = fresh[fresh.length - 1];
    if (m) {
      toast(`עצירה חדשה על הדרך: ${m.title || 'בלי שם'}`, {
        label: 'לפתיחה',
        run: () => {
          pushedModal = true;
          location.hash = `#/stop/${encodeURIComponent(m.id)}`;
        },
      });
    }
  }
  if (state.loaded && state.data.missions.length) knownIds = ids;
});

if (loginError) toast('ההתחברות עם Kick לא הצליחה. אפשר לנסות שוב.');
onViewer((v) => v && toast(`מחובר בתור ${v.username}`));

titleEl.textContent = state.data.settings.title;
route();
boot().then(() => {
  // אחרי טעינה – אם נפתחה עצירה מקישור, נרענן אותה
  if (parse().modal) route();
});

if (store.mode === 'demo') document.documentElement.dataset.mode = 'demo';

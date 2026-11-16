// אוברליי לשידור (OBS Browser Source): הסקר הפתוח עם פסים חיים וספירה לאחור,
// הכרזת המנצח ~20 שניות אחרי הסגירה, ואופציונלית שעון זמן משחק ומיני-מפה של מיקום ההחלטה.
// מחובר לאותו store של האתר, כך שסקר שמוד פותח במפה קופץ כאן לבד.
import { createStore } from './data/store';
import { playMs, pollOpen, type Extras, type LiveData, type Poll } from './data/types';
import { h } from './dom';
import { fmtPlay } from './live';
import { countdown } from './control/polls';

const q = new URLSearchParams(location.search);
const pos = ['bl', 'br', 'tl', 'tr'].includes(q.get('pos') || '') ? q.get('pos')! : 'bl';
const showClock = q.get('clock') === '1';
const showMap = q.get('map') !== '0';
const scale = Math.min(2, Math.max(0.5, Number(q.get('scale')) || 1));
const WIN_MS = 20_000;

const root = document.querySelector<HTMLElement>('[data-ov]')!;
root.classList.add(`ov--${pos}`);
root.style.setProperty('--ov-scale', String(scale));

const store = createStore();
let ex: Extras | null = null;
let live: LiveData | null = null;

const clock = h('div', { class: 'ov-clock', hidden: !showClock }, h('span', {}, 'שעות משחק ב-GTA 6'), h('b', {}, '0:00'));
const card = h('section', { class: 'ov-card', ariaLive: 'polite' });
root.append(clock, card);

let shownId = '';
let shownState = '';

type State = 'open' | 'counting' | 'won';
/** מתי האוברליי ראה כל סקר נסגר (שעון מקומי) – כך ההכרזה לא תלויה במתי השרת סגר אותו */
const closedSeen = new Map<string, number>();
const seenOpen = new Set<string>();
let firstLoad = true;

function current(): { p: Poll; state: State } | null {
  if (!ex) return null;
  const now = Date.now();
  for (const p of ex.polls) {
    if (p.status === 'open') seenOpen.add(p.id);
    else if (!closedSeen.has(p.id)) {
      // בטעינה הראשונה: רק סקר שנסגר ממש עכשיו (פחות מ-20 שניות) מוכרז
      const fresh = seenOpen.has(p.id) || (firstLoad && now - Date.parse(p.ends_at) < WIN_MS);
      closedSeen.set(p.id, fresh ? now : 0);
    }
  }
  firstLoad = false;
  const open = ex.polls.find((p) => p.status === 'open');
  if (open) return { p: open, state: pollOpen(open) ? 'open' : 'counting' };
  const recent = ex.polls
    .filter((p) => p.winner != null && now - (closedSeen.get(p.id) || 0) < WIN_MS)
    .sort((a, b) => (closedSeen.get(b.id) || 0) - (closedSeen.get(a.id) || 0))[0];
  return recent ? { p: recent, state: 'won' } : null;
}

function miniMap(p: Poll) {
  if (!showMap || p.x == null || p.y == null) return null;
  const m = h('div', { class: 'ov-map', ariaHidden: 'true' }, h('i', { class: 'ov-map__pin' }));
  // חיתוך עגול של המפה סביב המיקום (התמונה 3400×4182)
  const W = 104 * 11;
  const H = (W * 4182) / 3400;
  m.style.backgroundImage = `url(${import.meta.env.BASE_URL}map.webp)`;
  m.style.backgroundPosition = `${(52 - p.x * W).toFixed(1)}px ${(52 - p.y * H).toFixed(1)}px`;
  return m;
}

function render() {
  const c = current();
  if (!c) {
    card.classList.remove('is-on');
    shownId = '';
    return;
  }
  const { p, state } = c;
  const total = p.votes.reduce((a, b) => a + b, 0);
  const lead = Math.max(...p.votes);
  const fresh = p.id !== shownId || (state === 'won') !== (shownState === 'won');
  if (fresh) {
    shownId = p.id;
    shownState = state;
    card.classList.remove('is-on', 'is-won', 'is-open');
    void card.offsetWidth;
    card.replaceChildren(
      h(
        'header',
        { class: 'ov-head' },
        h('span', { class: 'ov-tag' }, h('i'), state === 'won' ? 'הצ׳אט החליט' : 'סקר הצ׳אט'),
        h('b', { class: 'ov-time' }),
      ),
      h('div', { class: 'ov-main' }, miniMap(p), h('h2', { class: 'ov-q' }, p.question)),
      h(
        'ol',
        { class: 'ov-opts' },
        ...p.options.map((o, i) =>
          h('li', { class: 'ov-opt' }, h('i', { class: 'ov-bar' }), h('span', { class: 'ov-key' }, `!${i + 1}`), h('span', { class: 'ov-label' }, o), h('b', { class: 'ov-pct' })),
        ),
      ),
      h('footer', { class: 'ov-foot' }),
    );
    card.classList.add('is-on', state === 'won' ? 'is-won' : 'is-open');
  }
  card.querySelectorAll<HTMLElement>('.ov-opt').forEach((li, i) => {
    const v = p.votes[i] ?? 0;
    const pct = total ? Math.round((v / total) * 100) : 0;
    li.style.setProperty('--p', `${pct}%`);
    li.classList.toggle('is-lead', state !== 'won' && total > 0 && v === lead);
    li.classList.toggle('is-win', state === 'won' && p.winner === i);
    li.querySelector('.ov-pct')!.textContent = `${pct}%`;
  });
  const time = card.querySelector('.ov-time')!;
  const foot = card.querySelector('.ov-foot')!;
  if (state === 'open') {
    time.textContent = countdown(new Date(p.ends_at).getTime() - Date.now());
    foot.replaceChildren(
      h('span', {}, 'כתבו ', h('b', {}, p.options.map((_, i) => `!${i + 1}`).join(' / ')), ' בצ׳אט · או באתר'),
      h('span', {}, `${total.toLocaleString('he-IL')} קולות`),
    );
  } else if (state === 'counting') {
    time.textContent = '0:00';
    foot.replaceChildren(h('span', {}, 'ההצבעה נגמרה · סופרים…'), h('span', {}, `${total.toLocaleString('he-IL')} קולות`));
  } else {
    time.textContent = '';
    foot.replaceChildren(
      h('span', {}, 'ניצח: ', h('b', {}, p.options[p.winner ?? 0] ?? '')),
      h('span', {}, p.x != null ? 'נוסף מרקר על המפה' : `${total.toLocaleString('he-IL')} קולות`),
    );
  }
}

function tick() {
  if (live && showClock) clock.querySelector('b')!.textContent = fmtPlay(playMs(live));
  render();
}

store.loadExtras().then((e) => {
  ex = e;
  render();
});
store.subscribeExtras((e) => {
  ex = e;
  render();
});
if (showClock) {
  store.loadLive().then((l) => (live = l));
  store.subscribeLive((l) => (live = l));
}
setInterval(tick, 500);

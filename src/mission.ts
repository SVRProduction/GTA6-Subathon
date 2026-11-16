// גרסה "Mission": שכבת המשחק מעל המפה – שעון משחק ומונה מיתות בפינה, כרזת "משימה הושלמה",
// הבזק "מתת", ומקרא המפה לתפריט העצירה. כל הנתונים מגיעים מה-store הקיים.
import { countOf, playMs, statusFresh, type LiveData } from './data/types';
import { h } from './dom';
import { fmtPlay } from './live';

export function createMissionHud(stage: HTMLElement, opts: { reduce: boolean }) {
  // ── שעון + מיתות (פינה עליונה) ──
  const clock = h('b', { class: 'mh__clock' }, '0:00');
  const deaths = h('b', { class: 'mh__deaths' }, '0');
  const readout = h(
    'div',
    { class: 'mh', ariaLabel: 'נתוני המסע' },
    h('div', { class: 'mh__row' }, h('span', { class: 'mh__label' }, 'זמן משחק'), clock),
    h('div', { class: 'mh__row mh__row--d' }, h('span', { class: 'mh__label' }, 'מיתות'), deaths),
  );
  stage.querySelector('.hud')!.append(readout);

  // ── כרזה והבזק ──
  const banner = h('div', { class: 'mbanner', role: 'status', ariaLive: 'polite' });
  const flash = h('div', { class: 'mflash', ariaHidden: 'true' }, h('span', {}, 'מתת'));
  stage.append(banner, flash);

  let live: LiveData | null = null;
  let lastDeaths = -1;
  let bannerTimer = 0;

  function tick() {
    if (!live) return;
    clock.textContent = fmtPlay(playMs(live));
    readout.classList.toggle('is-running', !!live.status?.on_category && statusFresh(live.status));
  }
  window.setInterval(tick, 15_000);

  return {
    setLive(l: LiveData) {
      live = l;
      const d = countOf(l, 'deaths');
      deaths.textContent = d.toLocaleString('he-IL');
      if (lastDeaths >= 0 && d > lastDeaths) this.flash();
      lastDeaths = d;
      tick();
    },
    /** "משימה הושלמה": המשימה שנגמרה, והבאה שנוספה עכשיו */
    banner(done: string | null, next: string) {
      clearTimeout(bannerTimer);
      banner.replaceChildren(h('p', { class: 'mbanner__kicker' }, done ? 'משימה הושלמה' : 'משימה חדשה'), h('p', { class: 'mbanner__title' }, done ?? next));
      if (done) banner.append(h('p', { class: 'mbanner__next' }, `הבאה: ${next}`));
      banner.classList.remove('is-on');
      void banner.offsetWidth;
      banner.classList.add('is-on');
      bannerTimer = window.setTimeout(() => banner.classList.remove('is-on'), opts.reduce ? 4000 : 5200);
    },
    flash() {
      flash.classList.remove('is-on');
      void flash.offsetWidth;
      flash.classList.add('is-on');
      window.setTimeout(() => flash.classList.remove('is-on'), 1800);
      readout.classList.remove('is-hit');
      void readout.offsetWidth;
      readout.classList.add('is-hit');
    },
  };
}

/** מקרא המפה בתפריט העצירה */
export function legend() {
  const item = (cls: string, label: string) => h('li', {}, h('i', { class: `lg lg--${cls}`, ariaHidden: 'true' }), h('span', {}, label));
  return h(
    'aside',
    { class: 'mlegend', ariaLabel: 'מקרא' },
    h('p', { class: 'mlegend__title' }, 'מקרא'),
    h(
      'ul',
      {},
      item('ms', 'מיילסטון'),
      item('stop', 'משימה'),
      item('now', 'כאן אנחנו עכשיו'),
      item('route', 'הדרך שעברנו'),
      item('ahead', 'ההמשך'),
      item('clip', 'יש קליפ מכאן'),
    ),
    h('p', { class: 'mlegend__title' }, 'מקשים'),
    h(
      'ul',
      { class: 'mlegend__keys' },
      h('li', {}, h('kbd', {}, '↑'), h('kbd', {}, '↓'), h('span', {}, 'עצירה הבאה / הקודמת')),
      h('li', {}, h('kbd', {}, 'C'), h('span', {}, 'קליפים')),
      h('li', {}, h('kbd', {}, 'S'), h('span', {}, 'סטטיסטיקות')),
      h('li', {}, h('kbd', {}, 'K'), h('span', {}, 'מצב קולנוע')),
      h('li', {}, h('kbd', {}, 'Esc'), h('span', {}, 'חזרה למפה')),
    ),
  );
}

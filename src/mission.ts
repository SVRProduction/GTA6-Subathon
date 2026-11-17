// גרסה "Mission": שכבת המשחק מעל המפה – שעון משחק ומונה מיתות בפינה, כרזת "משימה הושלמה",
// הבזק "מתת", ומקרא המפה לתפריט העצירה. כל הנתונים מגיעים מה-store הקיים.
import { COUNTERS, countOf, playMs, statusFresh, type CounterName, type LiveData } from './data/types';
import { h } from './dom';
import { fmtPlay } from './live';

export function createMissionHud(stage: HTMLElement, opts: { reduce: boolean }) {
  // ── זמן משחק: גדול, בצד שמאל. (המיתות – בחלון הסטטיסטיקות; על המסך רק ההבזק "מתת") ──
  const clock = h('b', { class: 'mh__clock' }, '0:00');
  const sub = h('span', { class: 'mh__sub' });
  const readout = h(
    'div',
    { class: 'mh', role: 'timer', ariaLabel: 'שעות משחק ב-GTA 6' },
    h('span', { class: 'mh__label' }, 'שעות משחק ב-GTA 6'),
    clock,
    sub,
  );
  stage.querySelector('.hud')!.append(readout);

  // ── כרזה והבזק ──
  const banner = h('div', { class: 'mbanner', role: 'status', ariaLive: 'polite' });
  const flash = h('div', { class: 'mflash', ariaHidden: 'true' }, h('span', {}, 'מתת'));
  // "MISSION FAILED" בסגנון GTA
  const failed = h('div', { class: 'mfailed', ariaHidden: 'true' }, h('span', {}, 'MISSION FAILED'), h('small', {}, 'עודד פישל את המשימה'));
  stage.append(banner, flash, failed);

  let live: LiveData | null = null;
  let lastDeaths = -1;
  const last: Partial<Record<CounterName, number>> = {};
  // אירוע אחד בכל רגע: השאר נכנסים לתור
  const queue: CounterName[] = [];
  let busy = false;
  function play(kind: CounterName) {
    busy = true;
    // הדמות על המפה (main.ts) מציגה את האפקט שלה – גולגולת / אורות משטרה
    window.dispatchEvent(new CustomEvent('oded:fx', { detail: kind }));
    if (kind === 'fails') {
      failed.classList.remove('is-on');
      void failed.offsetWidth;
      failed.classList.add('is-on');
      window.setTimeout(() => failed.classList.remove('is-on'), 2600);
    }
    if (kind === 'deaths' && !opts.reduce) {
      stage.classList.remove('is-shake');
      void stage.offsetWidth;
      stage.classList.add('is-shake');
      window.setTimeout(() => stage.classList.remove('is-shake'), 600);
    }
    window.setTimeout(() => {
      busy = false;
      const next = queue.shift();
      if (next) play(next);
    }, kind === 'arrests' ? 3200 : 2700);
  }
  function fx(kind: CounterName) {
    if (busy) {
      if (queue.length < 4) queue.push(kind);
    } else play(kind);
  }
  let bannerTimer = 0;

  function tick() {
    if (!live) return;
    clock.textContent = fmtPlay(playMs(live));
    const running = !!live.status?.on_category && statusFresh(live.status);
    readout.classList.toggle('is-running', running);
    const v = live.status?.viewers;
    sub.textContent = running ? `השעון רץ · בלייב${v ? ` · ${v.toLocaleString('he-IL')} צופים` : ''}` : 'השעון עוצר כשהלייב לא על GTA 6';
  }
  window.setInterval(tick, 15_000);

  return {
    setLive(l: LiveData) {
      live = l;
      const d = countOf(l, 'deaths');
      if (lastDeaths >= 0 && d > lastDeaths) this.flash();
      lastDeaths = d;
      // עלה מספר (מהצ'אט או מהכפתורים) → אפקט על המפה אצל כל הצופים
      for (const c of COUNTERS) {
        const n = countOf(l, c.key);
        const was = last[c.key];
        if (was !== undefined && n > was) fx(c.key);
        last[c.key] = n;
      }
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
    /** לבדיקה (‎?fx): מפעיל אפקט כאילו הגיע מהצ'אט */
    test(kind: CounterName) {
      if (kind === 'deaths') this.flash();
      fx(kind);
    },
    flash() {
      flash.classList.remove('is-on');
      void flash.offsetWidth;
      flash.classList.add('is-on');
      window.setTimeout(() => flash.classList.remove('is-on'), 1800);

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
      item('mk', 'מרקר חופשי (מוות, רכב, נשק…)'),
      item('poll', 'סקר פתוח'),
    ),
    h('p', { class: 'mlegend__title' }, 'מקשים'),
    h(
      'ul',
      { class: 'mlegend__keys' },
      h('li', {}, h('kbd', {}, '↑'), h('kbd', {}, '↓'), h('span', {}, 'עצירה הבאה / הקודמת')),
      h('li', {}, h('kbd', {}, 'C'), h('span', {}, 'קליפים')),
      h('li', {}, h('kbd', {}, 'S'), h('span', {}, 'סטטיסטיקות')),
      h('li', {}, h('kbd', {}, 'F'), h('span', {}, 'פיד חי')),
      h('li', {}, h('kbd', {}, 'T'), h('span', {}, 'הטלפון')),
      h('li', {}, h('kbd', {}, 'K'), h('span', {}, 'מצב קולנוע')),
      h('li', {}, h('kbd', {}, 'Esc'), h('span', {}, 'חזרה למפה')),
    ),
  );
}

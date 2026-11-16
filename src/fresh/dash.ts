// לוח המחוונים: שלט אלקטרוני (לייב), מד זמן משחק, ושני שלטי אזהרה – מיתות וחתולים שנדרסו
import { countOf, kickSlug, playMs, statusFresh, type CounterName } from '../data/types';
import { h, safeUrl } from '../dom';
import { on, state } from './state';
import { ago, hms, ico, num, reducedMotion } from './ui';

const RELEASE = Date.parse('2026-11-19T00:00:00+02:00');

export type LiveKind = 'playing' | 'live' | 'off' | 'unknown';
export function liveKind(now = Date.now()): LiveKind {
  const s = state.live?.status ?? null;
  if (!state.live) return 'unknown';
  if (!s || !statusFresh(s, now) || !s.is_live) return 'off';
  return s.on_category ? 'playing' : 'live';
}
export const kickUrl = () => `https://kick.com/${kickSlug(state.data.settings.kick_channel || 'odedsvr')}`;

/** הנורה בכותרת: תמיד גלויה */
export function createLivePill() {
  const a = h('a', { class: 'pill', href: kickUrl(), target: '_blank', rel: 'noopener' });
  const draw = () => {
    const k = liveKind();
    a.href = kickUrl();
    a.dataset.k = k;
    const text = k === 'playing' ? 'משחק עכשיו' : k === 'live' ? 'בלייב' : k === 'off' ? 'לא בשידור' : 'בודק…';
    a.replaceChildren(h('span', { class: 'pill__dot', ariaHidden: 'true' }), h('span', {}, text));
    a.setAttribute('aria-label', `${text} – פתיחת הערוץ ב-Kick`);
  };
  draw();
  on('live', draw);
  on('data', draw);
  setInterval(draw, 30_000);
  return a;
}

function vmsLines(): { lines: string[]; cta: boolean } {
  const k = liveKind();
  const s = state.live?.status;
  const now = Date.now();
  if (k === 'playing') return { lines: ['משחק עכשיו GTA 6', s?.viewers ? `${num(s.viewers)} צופים בלייב` : 'בלייב ב-Kick'], cta: true };
  if (k === 'live') return { lines: ['בלייב עכשיו', s?.category ? `כרגע ב: ${s.category}` : 'לא ב-GTA 6 כרגע'], cta: true };
  if (now < RELEASE) {
    const d = Math.ceil((RELEASE - now) / 864e5);
    return { lines: ['לא בשידור כרגע', d <= 1 ? 'GTA 6 יוצא מחר' : `GTA 6 יוצא בעוד ${d} ימים`], cta: false };
  }
  if (k === 'off') {
    const seg = state.live?.segments[state.live.segments.length - 1];
    return { lines: ['לא בשידור כרגע', seg ? `שיחק לאחרונה ${new Date(seg.ended_at).toLocaleString('he-IL', { weekday: 'long', hour: '2-digit', minute: '2-digit' })}` : 'נחזור לכביש בקרוב'], cta: false };
  }
  return { lines: ['מתחבר ל-Kick…', ''], cta: false };
}

function digits(text: string, cls = '') {
  return [...text].map((c) => h('span', { class: `odo__d ${cls}` }, c));
}

export function createDash() {
  const vmsText = h('div', { class: 'vms__text' });
  const vmsCta = h('a', { class: 'btn btn--live', href: kickUrl(), target: '_blank', rel: 'noopener' }, ico.play(18), 'לצפייה בלייב');
  const vms = h('div', { class: 'vms', role: 'status' }, vmsText, vmsCta);
  vms.setAttribute('aria-live', 'polite');

  const odoH = h('span', { class: 'odo__grp' });
  const odoM = h('span', { class: 'odo__grp' });
  const odoS = h('span', { class: 'odo__grp odo__grp--s' });
  const odo = h('div', { class: 'odo__face', role: 'timer' }, odoH, h('span', { class: 'odo__sep' }, ':'), odoM, h('span', { class: 'odo__sep' }, ':'), odoS);
  const odoNote = h('p', { class: 'odo__note' });
  const odoWrap = h('div', { class: 'odo' }, h('p', { class: 'odo__label' }, 'זמן משחק ב-GTA 6'), odo, odoNote);

  const dia = (c: CounterName, label: string) => {
    const n = h('b', { class: 'dia__n' }, '–');
    const el = h('div', { class: `dia dia--${c}` },
      h('div', { class: 'dia__sign', ariaHidden: 'true' }, h('div', { class: 'dia__inner' }, c === 'deaths' ? ico.skull(30) : ico.cat(30))),
      h('div', { class: 'dia__txt' }, n, h('span', { class: 'dia__label' }, label)),
    );
    return { el, n };
  };
  const deaths = dia('deaths', 'מיתות');
  const cats = dia('cats', 'חתולים שנדרסו');

  const sideClips = h('div', { class: 'side-clips' });
  const drawClips = () => {
    const list = [...(state.live?.clips ?? [])].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 3);
    sideClips.hidden = !list.length;
    sideClips.replaceChildren(
      h('p', { class: 'side-clips__h' }, h('span', {}, 'קליפים אחרונים'), h('a', { href: '#/clips' }, 'לכל הקליפים')),
      ...list.map((c) => {
        const th = safeUrl(c.thumbnail_url);
        return h('a', { class: 'side-clip', href: `#/clip/${encodeURIComponent(c.id)}` },
          th ? h('img', { src: th, alt: '', loading: 'lazy' }) : h('i', { class: 'side-clip__ph' }),
          h('span', {}, h('span', { dir: 'auto' }, c.title || 'קליפ'), h('small', {}, `${num(c.views)} צפיות, ${ago(c.created_at)}`)),
        );
      }),
    );
  };
  const root = h('section', { class: 'dash', ariaLabel: 'מצב הסאבתון' }, vms, odoWrap, h('div', { class: 'dias' }, deaths.el, cats.el), sideClips);

  let lastLines = '';
  const drawVms = () => {
    const { lines, cta } = vmsLines();
    const key = lines.join('|');
    vms.dataset.k = liveKind();
    vmsCta.href = kickUrl();
    vmsCta.hidden = !cta;
    if (key === lastLines) return;
    lastLines = key;
    vmsText.replaceChildren(...lines.filter(Boolean).map((l) => h('p', {}, l)));
  };

  let prevH = '', prevM = '', prevS = '';
  let prevMs = -1;
  const tick = () => {
    const live = state.live;
    if (!live) {
      odo.setAttribute('aria-label', 'זמן משחק: נטען');
      if (!odoH.childElementCount) {
        odoH.replaceChildren(...digits('–'));
        odoM.replaceChildren(...digits('––'));
        odoS.replaceChildren(...digits('––'));
      }
      return;
    }
    const ms = playMs(live);
    const running = liveKind() === 'playing' && prevMs >= 0 && ms > prevMs;
    prevMs = ms;
    const t = hms(ms);
    if (t.h !== prevH) odoH.replaceChildren(...digits(t.h));
    if (t.m !== prevM) odoM.replaceChildren(...digits(t.m));
    if (t.s !== prevS) odoS.replaceChildren(...digits(t.s, running && !reducedMotion() ? 'is-roll' : ''));
    prevH = t.h; prevM = t.m; prevS = t.s;
    odo.setAttribute('aria-label', `זמן משחק: ${t.h} שעות ו-${Number(t.m)} דקות`);
    const st = state.data.settings.started_at;
    const day = st ? Math.floor((Date.now() - Date.parse(st)) / 864e5) + 1 : null;
    const note = day && day > 0 ? `יום ${day} של הסאבתון${running ? ', השעון רץ' : ''}` : 'נספר רק כשהוא משחק ב-GTA 6';
    if (odoNote.textContent !== note) odoNote.textContent = note;
  };

  const drawCounts = () => {
    const live = state.live;
    for (const [c, d] of [['deaths', deaths], ['cats', cats]] as const) {
      const v = live ? num(countOf(live, c)) : '–';
      if (d.n.textContent !== v) {
        const had = d.n.textContent !== '–';
        d.n.textContent = v;
        if (had && !reducedMotion()) {
          d.el.classList.remove('is-bump');
          void d.el.offsetWidth;
          d.el.classList.add('is-bump');
        }
      }
    }
  };

  drawVms();
  tick();
  drawCounts();
  drawClips();
  on('live', () => {
    drawClips();
    drawVms();
    tick();
    drawCounts();
  });
  on('data', drawVms);
  setInterval(tick, 1000);
  setInterval(drawVms, 30_000);
  return root;
}

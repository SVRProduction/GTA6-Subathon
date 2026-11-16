// Atlas: סיפור המסע ככתבת מגזין נגללת. פרק לכל chapter, המפה דביקה בצד וטסה לאן שקוראים.
import { loginError } from '../auth';
import { clipCard, clipStop, playClip } from '../clips';
import { commentCount, commentsBox, initComments } from '../comments';
import { createStore } from '../data/store';
import { countOf, currentIndex, kickSlug, playMs, statusFresh, type Clip, type Data, type LiveData, type Mission } from '../data/types';
import { fill, fmtDate, h } from '../dom';
import { stopBody } from '../journey/content';
import { fmtHours, fmtPlay } from '../live';
import { createAtlasMap } from './map';

const store = createStore();
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const lite = matchMedia('(max-width: 760px), (pointer: coarse)').matches;
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;

const textEl = $('[data-text]');
const tocEl = $('[data-toc]');
const liveEl = $('[data-live]');
const progressEl = $('[data-progress]');
const stage = $('[data-map]');

interface Chapter {
  name: string;
  slug: string;
  stops: number[];
}

let data: Data | null = null;
let live: LiveData | null = null;
let cur = -1;
let chapters: Chapter[] = [];
let clipsByStop = new Map<number, Clip[]>();
const open = new Set<string>(); // עצירות פתוחות (נשמר בין רענונים)
let pending = false;
let lastCount = -1;

const num = (n: number) => n.toLocaleString('he-IL');
/** dataset אי אפשר להעביר ל-h() (מאפיין לקריאה בלבד) – מוסיפים אחרי */
function D<T extends HTMLElement>(el: T, d: Record<string, string>): T {
  Object.assign(el.dataset, d);
  return el;
}

// ── טוסט (עם פעולה אופציונלית) ──
let toastTimer = 0;
function toast(text: string, action?: { label: string; run: () => void }) {
  const t = document.getElementById('toast')!;
  const act = action
    ? h('button', {
        class: 'toast__act',
        type: 'button',
        onclick: () => {
          action.run();
          t.classList.remove('show');
        },
      }, action.label)
    : null;
  fill(t, h('span', {}, text), act);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove('show'), action ? 9000 : 4000);
}

const map = createAtlasMap(stage, { reduce, lite, onPick: (i) => goStop(i, true) });
const snapImg = new Image();
snapImg.crossOrigin = 'anonymous';
snapImg.src = `${import.meta.env.BASE_URL}map.webp`;

/** פרקים: רצפים של עצירות עם אותו chapter (בלי chapter – לפי יום) */
function buildChapters(d: Data): Chapter[] {
  const out: Chapter[] = [];
  d.missions.forEach((m, i) => {
    const name = m.chapter || (m.stream_day ? `יום ${m.stream_day}` : 'המסע');
    const last = out[out.length - 1];
    if (last && last.name === name) last.stops.push(i);
    else out.push({ name, slug: `ch-${out.length + 1}`, stops: [i] });
  });
  return out;
}

/** זמן משחק בין שני רגעים */
const playBetween = (a: number, b: number) => (live ? Math.max(0, playMs(live, b) - playMs(live, a)) : 0);
const at = (m?: Mission) => (m?.happened_at ? Date.parse(m.happened_at) : NaN);

// ── פתיחה ──
function hero(d: Data) {
  const ms = live ? playMs(live) : 0;
  const deaths = live ? countOf(live, 'deaths') : 0;
  const cats = live ? countOf(live, 'cats') : 0;
  const start = d.settings.started_at ? fmtDate(d.settings.started_at).split(',')[0] : '';
  const title = d.settings.title && d.settings.title !== 'סאבתון GTA 6' ? d.settings.title : 'המסע, פרק אחרי פרק';
  return D(
    h(
      'section',
      { class: 'hero', id: 'top' },
      h('p', { class: 'kicker' }, start ? `סאבתון GTA 6 · מאז ${start}` : 'סאבתון GTA 6'),
      h('h1', { class: 'hero__title' }, title),
      h('div', { class: 'hero__num' }, D(h('b', {}, fmtPlay(ms)), { play: '' }), h('span', {}, 'שעות על המפה של GTA 6, וממשיכים לספור')),
      h('p', { class: 'hero__lede' }, `${num(d.missions.length)} עצירות, ${chapters.length} פרקים, ${num(deaths)} מיתות ו-${num(cats)} חתולים שלא שרדו את הכביש. גוללים, והמפה נוסעת איתכם לאורך המסלול.`),
      h(
        'div',
        { class: 'hero__acts' },
        h('a', { class: 'btn btn--primary', href: `#${chapters[0]?.slug ?? 'top'}` }, 'מתחילים מהפרק הראשון'),
        cur >= 0 ? h('a', { class: 'btn', href: `#m-${cur + 1}` }, `קפיצה לעכשיו: עצירה ${cur + 1}`) : null,
      ),
    ),
    { mark: 'hero' },
  );
}

let stopPlaying: (() => void) | null = null;
const onPlay = (c: Clip, el: HTMLElement) => {
  stopPlaying?.();
  el.classList.add('is-playing');
  stopPlaying = playClip(el, c);
};
function clipWithTalk(c: Clip) {
  const card = clipCard(c, { onPlay });
  const n = commentCount('clip', c.id);
  const btn = h('button', { class: 'btn btn--quiet clip__talk-btn', type: 'button', ariaExpanded: 'false' }, n ? `💬 ${n} תגובות` : '💬 להגיב');
  const wrap = h('div', { class: 'clip__talk' }, btn);
  btn.onclick = () => {
    const o = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', String(o));
    wrap.querySelector('.cmts')?.remove();
    if (o) wrap.append(commentsBox(store, 'clip', c.id, { toast, title: false }));
  };
  card.append(wrap);
  return card;
}
function stopClips(i: number) {
  const list = clipsByStop.get(i);
  if (!list?.length) return null;
  return h('div', { class: 'stop__clips' }, h('p', { class: 'kicker' }, list.length === 1 ? 'קליפ מכאן' : `${list.length} קליפים מכאן`), h('div', { class: 'clips clips--row' }, ...list.slice(0, 4).map(clipWithTalk)));
}

// ── עצירה רגילה: שורה שנפתחת ──
function row(m: Mission, i: number) {
  const id = `m-${i + 1}`;
  const isOpen = open.has(id);
  const deaths = live ? countOf(live, 'deaths', m.id) : 0;
  const talk = commentCount('stop', m.id);
  const body = h('div', { class: 'row__body', hidden: !isOpen, id: `${id}-body` });
  const head = h(
    'button',
    { class: 'row__head', type: 'button', ariaExpanded: String(isOpen) },
    h('span', { class: 'row__no' }, String(i + 1)),
    h('span', { class: 'row__name' }, h('strong', {}, m.title || `עצירה ${i + 1}`), h('small', {}, [m.stream_day ? `יום ${m.stream_day}` : '', fmtDate(m.happened_at)].filter(Boolean).join(' · '))),
    h('span', { class: 'row__tags' }, deaths ? h('span', { title: 'מיתות' }, `💀 ${deaths}`) : null, talk ? h('span', { title: 'תגובות' }, `💬 ${talk}`) : null, i === cur ? h('span', { class: 'here' }, 'כאן עכשיו') : null),
  );
  head.setAttribute('aria-controls', body.id);
  const fillBody = () => {
    const [media, ...rest] = stopBody(m, i, toast, { embed: true, snapshot: null });
    fill(body, m.body && m.summary ? h('p', { class: 'row__teaser' }, m.summary) : null, media, ...rest, stopClips(i), commentsBox(store, 'stop', m.id, { toast }));
  };
  if (isOpen) fillBody();
  head.onclick = () => {
    const now = head.getAttribute('aria-expanded') !== 'true';
    head.setAttribute('aria-expanded', String(now));
    body.hidden = !now;
    if (now) {
      open.add(id);
      fillBody();
    } else open.delete(id);
  };
  return D(h('article', { class: `row ${i === cur ? 'is-now' : ''} ${i > cur ? 'is-ahead' : ''}`, id }, head, body), { i: String(i), mark: 'stop' });
}

// ── מיילסטון: כרטיס גדול ──
function milestone(m: Mission, i: number) {
  const snap = D(h('div', { class: 'ms__snap' }), { snap: String(i) });
  const [media, ...rest] = stopBody(m, i, toast, { embed: true, snapshot: snap });
  const deaths = live ? countOf(live, 'deaths', m.id) : 0;
  const cats = live ? countOf(live, 'cats', m.id) : 0;
  return D(
    h(
      'article',
      { class: `ms ${i === cur ? 'is-now' : ''}`, id: `m-${i + 1}` },
      h('div', { class: 'ms__media' }, media ?? snap),
      h(
        'div',
        { class: 'ms__text' },
        h('p', { class: 'kicker' }, `מיילסטון · עצירה ${i + 1}`, i === cur ? h('span', { class: 'here' }, 'כאן עכשיו') : null),
        h('h3', { class: 'ms__title' }, m.title),
        m.summary ? h('p', { class: 'ms__dek' }, m.summary) : null,
        h('p', { class: 'ms__meta' }, [m.stream_day ? `יום ${m.stream_day}` : '', fmtDate(m.happened_at), deaths ? `💀 ${deaths}` : '', cats ? `🐈 ${cats}` : ''].filter(Boolean).join(' · ')),
        ...rest,
        stopClips(i),
        commentsBox(store, 'stop', m.id, { toast }),
      ),
    ),
    { i: String(i), mark: 'stop' },
  );
}

// ── פרק ──
function chapter(d: Data, c: Chapter, k: number) {
  const ms = c.stops.map((i) => d.missions[i]);
  const next = chapters[k + 1] ? d.missions[chapters[k + 1].stops[0]] : undefined;
  const deaths = live ? ms.reduce((n, m) => n + countOf(live!, 'deaths', m.id), 0) : 0;
  const cats = live ? ms.reduce((n, m) => n + countOf(live!, 'cats', m.id), 0) : 0;
  const a = at(ms[0]);
  const b = next ? at(next) : Date.now();
  const time = Number.isFinite(a) && Number.isFinite(b) ? playBetween(a, b) : 0;
  const days = [...new Set(ms.map((m) => m.stream_day).filter((x): x is number => !!x))];
  const isCur = c.stops.includes(cur);
  const ahead = c.stops[0] > cur;
  const shareBtn = h('button', { class: 'btn btn--quiet ch__share', type: 'button' }, 'שיתוף הפרק');
  shareBtn.onclick = async () => {
    const url = `${location.origin}${location.pathname}#${c.slug}`;
    try {
      if (navigator.share) await navigator.share({ title: `${c.name} · ${d.settings.title || 'סאבתון GTA 6'}`, url });
      else {
        await navigator.clipboard.writeText(url);
        toast('הקישור לפרק הועתק');
      }
    } catch {
      /* בוטל */
    }
  };
  const range = `עצירות ${c.stops[0] + 1}–${c.stops[c.stops.length - 1] + 1}`;
  const dayText = days.length ? (days.length === 1 ? `יום ${days[0]}` : `ימים ${days[0]}–${days[days.length - 1]}`) : '';
  const section = h(
    'section',
    { class: `ch ${isCur ? 'is-cur' : ''} ${ahead ? 'is-ahead' : ''}`, id: c.slug },
    D(
      h(
        'header',
        { class: 'ch__head' },
        h('p', { class: 'ch__no' }, `פרק ${k + 1}`),
        h('h2', { class: 'ch__title', id: `${c.slug}-t` }, c.name),
        h('p', { class: 'ch__dek' }, [range, dayText, isCur ? 'אנחנו כאן עכשיו' : ''].filter(Boolean).join(' · ')),
        shareBtn,
      ),
      { mark: 'ch', ch: String(k) },
    ),
    h('div', { class: 'ch__body' }, ...c.stops.map((i) => (d.missions[i].is_milestone ? milestone(d.missions[i], i) : row(d.missions[i], i)))),
    h(
      'aside',
      { class: 'ch__sum', ariaLabel: `סיכום ${c.name}` },
      h('p', { class: 'kicker' }, isCur ? 'הפרק עד עכשיו' : `סיכום ${c.name}`),
      h(
        'dl',
        {},
        h('div', {}, h('dt', {}, 'עצירות'), h('dd', {}, num(c.stops.length))),
        h('div', {}, h('dt', {}, 'מיתות'), h('dd', {}, num(deaths))),
        h('div', {}, h('dt', {}, 'חתולים'), h('dd', {}, num(cats))),
        h('div', {}, h('dt', {}, 'זמן משחק'), h('dd', {}, time ? fmtHours(time) : '–')),
      ),
    ),
  );
  section.setAttribute('aria-labelledby', `${c.slug}-t`);
  return D(section, { ch: String(k) });
}

// ── סוף: הפרק הבא + קליפים אחרונים ──
function coda(d: Data) {
  const latest = live ? [...live.clips].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 6) : [];
  const channel = kickSlug(d.settings.kick_channel);
  return D(
    h(
      'section',
      { class: 'coda', id: 'next' },
      h('p', { class: 'ch__no' }, `פרק ${chapters.length + 1}`),
      h('h2', { class: 'coda__title' }, 'הפרק הבא עוד לא נכתב'),
      h('p', { class: 'coda__lede' }, 'המסלול ממשיך בכל לייב. כל משימה חדשה נכנסת לכאן בזמן אמת, עם המקום שלה על המפה.'),
      h('div', { class: 'hero__acts' }, h('a', { class: 'btn btn--primary', href: `https://kick.com/${channel}`, target: '_blank', rel: 'noopener' }, 'לצפייה בלייב ב-Kick'), h('a', { class: 'btn', href: './stats.html' }, 'כל המספרים')),
      latest.length
        ? h(
            'div',
            { class: 'coda__clips' },
            h('h3', { class: 'kicker' }, 'קליפים אחרונים מהדרך'),
            live?.demoClips ? h('p', { class: 'clips__note' }, 'תצוגה מקדימה: קליפים מהערוץ מכל המשחקים. מ-19.11 יופיעו כאן רק קליפים מ-GTA 6.') : null,
            h('div', { class: 'clips coda__grid' }, ...latest.map(clipWithTalk)),
          )
        : null,
    ),
    { mark: 'coda' },
  );
}

// ── רינדור מלא (שומר על המקום של הקורא) ──
function busy() {
  // לא בונים מחדש מתחת לקליפ שמתנגן על המסך (קליפ שגללו ממנו הלאה – לא מעכב)
  const onScreen = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight;
  };
  if ([...textEl.querySelectorAll('.is-playing, iframe')].some(onScreen)) return true;
  return [...textEl.querySelectorAll('textarea')].some((t) => t.value.trim() || t === document.activeElement);
}
function render(force = false) {
  if (!data) return;
  if (!force && busy()) {
    pending = true;
    return;
  }
  pending = false;
  const d = data;
  cur = currentIndex(d);
  chapters = buildChapters(d);
  clipsByStop = new Map();
  for (const c of live?.demoClips ? [] : live?.clips ?? []) {
    const i = clipStop(c, d.missions);
    if (i >= 0) clipsByStop.set(i, [...(clipsByStop.get(i) ?? []), c]);
  }
  // עוגן: האלמנט שבקו הקריאה, כדי לחזור בדיוק לאותו מקום אחרי הבנייה מחדש
  const anchor = textEl.childElementCount ? markAtLine() : null;
  const anchorId = anchor?.id || anchor?.closest('[id]')?.id;
  const anchorTop = anchorId ? document.getElementById(anchorId)!.getBoundingClientRect().top : 0;
  stopPlaying?.();
  stopPlaying = null;
  fill(textEl, hero(d), ...chapters.map((c, k) => chapter(d, c, k)), coda(d));
  renderToc();
  renderLive();
  if (anchorId) {
    const el = document.getElementById(anchorId);
    if (el) window.scrollBy(0, el.getBoundingClientRect().top - anchorTop);
  }
  fillSnaps();
  onScroll();
}

function fillSnaps() {
  if (!map.ready() || !snapImg.complete || !snapImg.naturalWidth) return;
  textEl.querySelectorAll<HTMLElement>('[data-snap]').forEach((el) => {
    if (el.firstChild) return;
    const c = map.snapshot(Number(el.dataset.snap), snapImg);
    if (c) el.append(c);
  });
}
snapImg.onload = fillSnaps;
setInterval(() => {
  fillSnaps();
  if (pending && !busy()) render();
}, 1500);

// ── תוכן עניינים + סטטוס לייב ──
function renderToc() {
  fill(
    tocEl,
    ...chapters.map((c, k) =>
      h(
        'li',
        {},
        D(h('a', { href: `#${c.slug}` }, h('span', { class: 'toc__no' }, String(k + 1)), h('span', {}, c.name), c.stops.includes(cur) ? h('i', { class: 'toc__here', title: 'אנחנו כאן' }) : null), { ch: String(k) }),
      ),
    ),
    h('li', {}, D(h('a', { href: '#next' }, h('span', { class: 'toc__no' }, '→'), h('span', {}, 'הבא')), { ch: String(chapters.length) })),
  );
}
function renderLive() {
  if (!data) return;
  const s = live?.status ?? null;
  const fresh = statusFresh(s);
  const isLive = fresh ? !!s?.is_live : data.settings.is_live;
  const onGame = fresh ? !!s?.on_category : data.settings.is_live;
  liveEl.hidden = !isLive;
  liveEl.className = `live-chip ${onGame ? 'is-game' : ''}`;
  liveEl.setAttribute('href', cur >= 0 ? `#m-${cur + 1}` : '#next');
  fill(liveEl, h('span', {}, onGame ? 'משחק עכשיו' : 'בלייב'), fresh && s?.viewers ? h('small', {}, `${num(s.viewers)} צופים`) : null);
}

// ── גלילה → מפה ──
const isMobile = () => matchMedia('(max-width: 860px)').matches;
const lineY = () => {
  const top = isMobile() ? stage.getBoundingClientRect().bottom : 0;
  return top + (innerHeight - top) * 0.38;
};
function markAtLine(): HTMLElement | null {
  const y = lineY();
  const marks = [...textEl.querySelectorAll<HTMLElement>('[data-mark]')];
  let best: HTMLElement | null = null;
  for (const el of marks) {
    if (el.getBoundingClientRect().top <= y) best = el;
    else break;
  }
  return best ?? marks[0] ?? null;
}
let lastKey = '';
let activeCh = -2;
function onScroll() {
  if (!data) return;
  const max = document.documentElement.scrollHeight - innerHeight;
  progressEl.style.transform = `scaleX(${max > 0 ? Math.min(1, scrollY / max) : 0})`;
  const el = markAtLine();
  if (!el) return;
  const kind = el.dataset.mark;
  let key: string = kind ?? '';
  let k = -1;
  if (kind === 'ch') {
    k = Number(el.dataset.ch);
    key = `ch${k}`;
  } else if (kind === 'stop') {
    const i = Number(el.dataset.i);
    k = chapters.findIndex((c) => c.stops.includes(i));
    key = `s${i}`;
  } else if (kind === 'coda') k = chapters.length;
  if (key !== lastKey) {
    lastKey = key;
    if (kind === 'hero') map.setView({ stops: [], focus: cur, close: false });
    else if (kind === 'coda') map.setView({ stops: data.missions.map((_, i) => i).slice(Math.max(0, cur - 8), cur + 1), focus: cur, close: false, maxZ: 2.6 });
    else if (kind === 'ch') map.setView({ stops: chapters[k]?.stops ?? [], focus: -1 });
    else if (kind === 'stop') map.setView({ stops: chapters[k]?.stops ?? [], focus: Number(el.dataset.i) });
  }
  if (k !== activeCh) {
    activeCh = k;
    tocEl.querySelectorAll<HTMLAnchorElement>('a').forEach((a) => {
      if (Number(a.dataset.ch) === k) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    });
    const a = tocEl.querySelector<HTMLElement>('[aria-current]');
    if (a) tocEl.scrollTo({ left: a.offsetLeft - tocEl.clientWidth / 2 + a.clientWidth / 2, behavior: reduce ? 'auto' : 'smooth' });
  }
}
let ticking = false;
addEventListener(
  'scroll',
  () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      onScroll();
    });
  },
  { passive: true },
);
addEventListener('resize', onScroll);

/** מעבר לעצירה (מסיכה במפה או מקישור), ופתיחה אם היא שורה */
function goStop(i: number, fromMap = false) {
  const el = document.getElementById(`m-${i + 1}`);
  if (!el) return;
  if (el.classList.contains('row') && !open.has(el.id)) el.querySelector<HTMLButtonElement>('.row__head')?.click();
  const y = el.getBoundingClientRect().top + scrollY - (lineY() - 40);
  scrollTo({ top: Math.max(0, y), behavior: reduce ? 'auto' : 'smooth' });
  if (fromMap) history.replaceState(null, '', `#m-${i + 1}`);
}
function goTarget(id: string, smooth: boolean) {
  const m = id.match(/^m-(\d+)$/);
  if (m) return goStop(Number(m[1]) - 1);
  const el = document.getElementById(id);
  if (!el) return;
  const offset = isMobile() ? stage.getBoundingClientRect().height + 56 : 72;
  scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + scrollY - offset), behavior: smooth && !reduce ? 'smooth' : 'auto' });
}
addEventListener('hashchange', () => goTarget(decodeURIComponent(location.hash.slice(1)), true));
// קישורים פנימיים: גלילה חלקה בלי קפיצת עוגן
document.addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]');
  if (!a) return;
  e.preventDefault();
  const id = a.getAttribute('href')!.slice(1);
  history.pushState(null, '', `#${id}`);
  goTarget(id, true);
});

// השעון בפתיחה מתקתק
setInterval(() => {
  const b = textEl.querySelector<HTMLElement>('[data-play]');
  if (b && live) b.textContent = fmtPlay(playMs(live));
}, 15_000);

// ── נתונים ──
Promise.all([store.load(), store.loadLive()])
  .then(([d, l]) => {
    data = d;
    live = l;
    lastCount = d.missions.length;
    map.setData(d);
    render(true);
    if (location.hash.length > 1) setTimeout(() => goTarget(decodeURIComponent(location.hash.slice(1)), false), 60);
    store.subscribe((nd) => {
      const added = nd.missions.length > lastCount ? nd.missions[nd.missions.length - 1] : null;
      lastCount = nd.missions.length;
      data = nd;
      map.setData(nd);
      render();
      if (added) {
        const i = nd.missions.findIndex((m) => m.id === added.id);
        toast(`עצירה חדשה: ${added.title}`, {
          label: 'לקריאה',
          run: () => {
            if (!document.getElementById(`m-${i + 1}`)) render(true);
            goStop(i);
          },
        });
      }
    });
    store.subscribeLive((nl) => {
      live = nl;
      render();
    });
    initComments(store, () => render());
  })
  .catch((e) => {
    console.error(e);
    fill(textEl, h('p', { class: 'hero__lede' }, 'המסע לא נטען. נסו לרענן את הדף.'));
  });

if (loginError) setTimeout(() => toast('ההתחברות עם Kick לא הצליחה. נסו שוב.'), 600);

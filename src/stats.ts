// דף המספרים (בתוך הטלפון): זמן משחק, כמה פעמים עודד מת / נעצר / פישל, עובדות מצחיקות, שעות לפי יום והקליפים הנצפים.
import { clipCard, playClip } from './clips';
import { commentCount, commentsBox, initComments } from './comments';
import { createStore } from './data/store';
import { countOf, currentIndex, kickSlug, playMs, statusFresh, type Clip, type Data, type Extras, type LiveData } from './data/types';
import { fill, h } from './dom';
import { fmtPlay } from './live';

const store = createStore();
const root = document.querySelector<HTMLElement>('[data-root]')!;
const statusEl = document.querySelector<HTMLElement>('[data-status]')!;
let data: Data | null = null;
let live: LiveData | null = null;
let ex: Extras | null = null;
let nComments = 0;

let toastTimer = 0;
function toast(text: string) {
  const t = document.getElementById('toast')!;
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove('show'), 4000);
}

const num = (n: number, digits = 0) => n.toLocaleString('he-IL', { maximumFractionDigits: digits, minimumFractionDigits: digits });
const ago = (ms: number) => {
  const m = Math.round(ms / 60_000);
  if (m < 60) return `לפני ${m} דק'`;
  if (m < 1440) return `לפני ${Math.round(m / 60)} שעות`;
  return `לפני ${Math.round(m / 1440)} ימים`;
};

/** שעות משחק לכל יום (לפי שעון מקומי), מפוצל בחצות */
function perDay(l: LiveData) {
  const days = new Map<string, number>();
  const now = Date.now();
  const live = l.status?.on_category && statusFresh(l.status);
  l.segments.forEach((g, i) => {
    let a = Date.parse(g.started_at);
    let b = Date.parse(g.ended_at);
    if (live && i === l.segments.length - 1) b = Math.max(b, now);
    while (a < b) {
      const d = new Date(a);
      const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
      const end = Math.min(b, next);
      const key = `${d.getDate()}.${d.getMonth() + 1}`;
      days.set(key, (days.get(key) ?? 0) + (end - a));
      a = end;
    }
  });
  return [...days.entries()].slice(-14);
}

function bars(rows: Array<[string, number]>) {
  if (!rows.length) return h('p', { class: 'sx-empty' }, 'זמן המשחק יופיע כאן מהרגע שהלייב על GTA 6 מתחיל.');
  const max = Math.max(...rows.map((r) => r[1]), 3600_000);
  return h(
    'div',
    { class: 'sx-bars', role: 'img', ariaLabel: rows.map(([d, ms]) => `${d}: ${num(ms / 3600_000, 1)} שעות`).join(', ') },
    ...rows.map(([day, ms]) => {
      const bar = h('div', { class: 'sx-bar' }, h('span', { class: 'sx-bar__val' }, num(ms / 3600_000, 1)), h('i', {}), h('span', { class: 'sx-bar__day' }, day));
      bar.style.setProperty('--h', String(ms / max));
      return bar;
    }),
  );
}

let stopPlaying: (() => void) | null = null;
function render() {
  if (!data || !live) return;
  const d = data;
  const l = live;
  root.removeAttribute('aria-busy');
  const s = l.status;
  const fresh = statusFresh(s);
  const playing = fresh && s?.on_category;
  statusEl.textContent = playing ? `משחק GTA 6 עכשיו${s?.viewers ? `, ${num(s.viewers)} צופים` : ''}` : fresh && s?.is_live ? 'בלייב עכשיו, לא על GTA 6' : 'לא בלייב כרגע';
  statusEl.classList.toggle('is-live', !!playing);
  document.querySelector('[data-title]')!.textContent = `${d.settings.title || 'סאבתון GTA 6'} במספרים`;

  const ms = playMs(l);
  const hrs = ms / 3600_000;
  const deaths = countOf(l, 'deaths');
  const arrests = countOf(l, 'arrests');
  const fails = countOf(l, 'fails');
  const decisions = (ex?.polls ?? []).filter((p) => p.status === 'closed').length;
  const days = new Set(d.missions.map((m) => m.stream_day).filter(Boolean)).size;
  const dayRows = perDay(l);
  const peak = dayRows.reduce<[string, number] | null>((b, r) => (!b || r[1] > b[1] ? r : b), null);
  const missions = d.missions;
  const milestones = missions.filter((m) => m.is_milestone).length;
  const hardest = missions
    .map((m, i) => ({ m, i, n: countOf(l, 'deaths', m.id), c: countOf(l, 'arrests', m.id) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || b.i - a.i)
    .slice(0, 5);
  const topClips = [...l.clips].sort((a, b) => b.views - a.views).slice(0, 6);
  const cur = currentIndex(d);

  const tile = (value: string, label: string, cls = '', live = false) =>
    h('div', { class: `sx-tile ${cls}` }, h('b', { class: live ? 'is-live' : '' }, value), h('span', {}, label));

  stopPlaying?.();
  stopPlaying = null;
  fill(
    root,
    h(
      'section',
      { class: 'sx-tiles', ariaLabel: 'המספרים הגדולים' },
      tile(fmtPlay(ms), 'שעות משחק ב-GTA 6', 'sx-tile--play', !!playing),
      tile(num(deaths), '💀 כמה פעמים עודד מת', 'sx-tile--deaths'),
      tile(num(arrests), '🚔 כמה פעמים עודד נעצר', 'sx-tile--cats'),
      tile(num(fails), '❌ משימות שעודד פישל', 'sx-tile--fails'),
      tile(num(missions.length), 'עצירות על המפה'),
      tile(num(milestones), 'מיילסטונים'),
      tile(num(decisions), 'החלטות של הצ׳אט'),
      tile(num(nComments), 'תגובות של צופים'),
    ),
    h(
      'section',
      { class: 'sx-card sx-rates' },
      h('h2', {}, 'עודד במספרים'),
      h(
        'dl',
        {},
        h('div', {}, h('dt', {}, 'עודד מת בממוצע כל'), h('dd', {}, deaths && hrs > 0.05 ? `${num(Math.max(1, Math.round((hrs * 60) / deaths)))} דקות משחק` : 'עוד לא מת. חכו.')),
        h('div', {}, h('dt', {}, 'משימה חדשה על המפה כל'), h('dd', {}, missions.length > 1 && hrs > 0.05 ? `${num(Math.max(1, Math.round((hrs * 60) / missions.length)))} דקות` : '–')),
        h('div', {}, h('dt', {}, 'המשימה שהכי שברה אותו'), h('dd', {}, hardest[0] ? h('a', { href: `./#m-${hardest[0].i + 1}` }, `${hardest[0].m.title || `עצירה ${hardest[0].i + 1}`} · ${num(hardest[0].n)} מיתות`) : '–')),
        h('div', {}, h('dt', {}, 'יום השיא'), h('dd', {}, peak ? `${peak[0]}: ${num(peak[1] / 3600_000, 1)} שעות משחק` : '–')),
        h('div', {}, h('dt', {}, 'ימים בסאבתון'), h('dd', {}, days ? num(days) : '–')),
        h('div', {}, h('dt', {}, 'אנחנו עכשיו ב'), h('dd', {}, missions[cur] ? h('a', { href: `./#m-${cur + 1}` }, `עצירה ${cur + 1}: ${missions[cur].title}`) : '–')),
      ),
    ),
    h('section', { class: 'sx-card' }, h('h2', {}, 'שעות משחק לפי יום'), bars(dayRows)),
    h(
      'section',
      { class: 'sx-card' },
      h('h2', {}, 'המשימות שהכי שברו את עודד'),
      hardest.length
        ? h(
            'ol',
            { class: 'sx-hard' },
            ...hardest.map((x, k) =>
              h(
                'li',
                {},
                h('span', { class: 'sx-hard__rank' }, String(k + 1)),
                h('a', { class: 'sx-hard__name', href: `./#m-${x.i + 1}` }, h('strong', {}, x.m.title || `עצירה ${x.i + 1}`), h('small', {}, `עצירה ${x.i + 1}${x.m.chapter ? `, ${x.m.chapter}` : ''}`)),
                h('span', { class: 'sx-hard__n' }, `💀 ${num(x.n)}`, x.c ? h('small', {}, ` 🚔 ${num(x.c)}`) : null),
              ),
            ),
          )
        : h('p', { class: 'sx-empty' }, 'עוד לא מת אף פעם. מרשים.'),
    ),
    h(
      'section',
      { class: 'sx-card' },
      h('h2', {}, 'הקליפים הנצפים ביותר'),
      l.demoClips ? h('p', { class: 'clips__note' }, 'תצוגה מקדימה: קליפים מהערוץ מכל המשחקים. מ-19.11 יופיעו כאן רק קליפים מ-GTA 6.') : null,
      topClips.length
        ? h(
            'div',
            { class: 'clips sx-clips' },
            ...topClips.map((c: Clip) => {
              const card = clipCard(c, {
                onPlay: (cl, el) => {
                  stopPlaying?.();
                  el.classList.add('is-playing');
                  stopPlaying = playClip(el, cl);
                },
              });
              const n = commentCount('clip', c.id);
              const btn = h('button', { class: 'btn btn--quiet clip__talk-btn', type: 'button', ariaExpanded: 'false' }, n ? `💬 ${n} תגובות` : '💬 להגיב');
              const wrap = h('div', { class: 'clip__talk' }, btn);
              btn.onclick = () => {
                const open = btn.getAttribute('aria-expanded') !== 'true';
                btn.setAttribute('aria-expanded', String(open));
                wrap.querySelector('.cmts')?.remove();
                if (open) wrap.append(commentsBox(store, 'clip', c.id, { toast, title: false }));
              };
              card.append(wrap);
              return card;
            }),
          )
        : h('p', { class: 'sx-empty' }, 'עוד אין קליפים מ-GTA 6.'),
      h('a', { class: 'btn', href: `https://kick.com/${kickSlug(d.settings.kick_channel)}/clips`, target: '_blank', rel: 'noopener' }, 'כל הקליפים ב-Kick'),
    ),
    h('p', { class: 'sx-foot' }, s?.checked_at ? `עודכן ${ago(Date.now() - Date.parse(s.checked_at))}. זמן המשחק נספר רק כשהלייב בקטגוריה של GTA 6.` : 'זמן המשחק נספר רק כשהלייב בקטגוריה של GTA 6.'),
  );
}

// השעון מתקתק בלי לבנות מחדש את כל הדף (כדי לא לעצור קליפ שמתנגן)
setInterval(() => {
  const b = root.querySelector('.sx-tile--play b');
  if (b && live) b.textContent = fmtPlay(playMs(live));
}, 15_000);

const busy = () => !!root.querySelector('.is-playing') || [...root.querySelectorAll('textarea')].some((t) => t.value.trim() || t === document.activeElement);
Promise.all([store.load(), store.loadLive()])
  .then(([d, l]) => {
    data = d;
    live = l;
    render();
    store.subscribe((nd) => {
      data = nd;
      if (!busy()) render();
    });
    store.subscribeLive((nl) => {
      live = nl;
      if (!busy()) render();
    });
    initComments(store, (list) => {
      nComments = list.length;
      if (!busy()) render();
    });
    store.loadExtras().then((e) => {
      ex = e;
      if (!busy()) render();
    }, () => {});
    store.subscribeExtras((e) => {
      ex = e;
      if (!busy()) render();
    });
  })
  .catch((e) => {
    console.error(e);
    fill(root, h('p', { class: 'sx-empty' }, 'הנתונים לא נטענו. נסו לרענן.'));
  });

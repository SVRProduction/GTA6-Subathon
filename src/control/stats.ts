// חלון הסטטיסטיקות: כל המספרים של המסע – זמן משחק, מיתות, מעצרים, פישולים, מרקרים, סקרים וסטוריז,
// קצב, שעות לפי יום, המשימות הקשות, ואיפה הכי הרבה מיתות על המפה.
import { countOf, currentIndex, liveStories, MARKER_TYPES, playMs, statusFresh, type Data, type Extras, type LiveData, type MarkerType } from '../data/types';
import { h } from '../dom';
import { fmtPlay } from '../live';
import { markerIcon } from './icons';

const num = (n: number, digits = 0) => n.toLocaleString('he-IL', { maximumFractionDigits: digits, minimumFractionDigits: digits });

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

export function statsView(d: Data, l: LiveData | null, ex: Extras | null, opts: { openStop: (i: number) => void; openMarker: (id: string) => void }) {
  if (!l) return [h('p', { class: 'sx-empty' }, 'טוען את המספרים…')];
  const ms = playMs(l);
  const hrs = ms / 3600_000;
  const deaths = countOf(l, 'deaths');
  const arrests = countOf(l, 'arrests');
  const fails = countOf(l, 'fails');
  const missions = d.missions;
  const milestones = missions.filter((m) => m.is_milestone).length;
  const markers = ex?.markers ?? [];
  const byType = new Map<MarkerType, number>();
  markers.forEach((m) => byType.set(m.type, (byType.get(m.type) ?? 0) + 1));
  const stories = liveStories(ex?.stories ?? []);
  const polls = (ex?.polls ?? []).filter((p) => p.status === 'closed');
  const votes = (ex?.polls ?? []).reduce((a, p) => a + p.votes.reduce((x, y) => x + y, 0), 0);
  const hardest = missions
    .map((m, i) => ({ m, i, n: countOf(l, 'deaths', m.id), c: countOf(l, 'arrests', m.id) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || b.i - a.i)
    .slice(0, 5);
  const cur = currentIndex(d);
  const playing = statusFresh(l.status) && l.status?.on_category;
  const tile = (value: string, label: string, cls = '') => h('div', { class: `sx-tile ${cls}` }, h('b', {}, value), h('span', {}, label));
  const link = (label: string, go: () => void) => {
    const b = h('button', { type: 'button', class: 'linkish' }, label);
    b.onclick = go;
    return b;
  };
  return [
    h(
      'section',
      { class: 'sx-tiles', ariaLabel: 'המספרים הגדולים' },
      tile(fmtPlay(ms), playing ? 'שעות משחק · רץ עכשיו' : 'שעות משחק ב-GTA 6', `sx-tile--play ${playing ? 'is-live' : ''}`),
      tile(num(deaths), 'כמה פעמים עודד מת', 'sx-tile--deaths'),
      tile(num(arrests), 'כמה פעמים עודד נעצר', 'sx-tile--cats'),
      tile(num(fails), 'משימות שעודד פישל'),
      tile(num(missions.length), 'עצירות'),
      tile(num(milestones), 'מיילסטונים'),
      tile(num(markers.length), 'מרקרים על המפה'),
      tile(num(l.clips.length), 'קליפים'),
      tile(num(stories.length), 'סטוריז פעילים'),
      tile(num(votes), 'קולות בסקרים'),
    ),
    h(
      'section',
      { class: 'sx-card sx-rates' },
      h('h3', {}, 'הקצב'),
      h(
        'dl',
        {},
        h('div', {}, h('dt', {}, 'מיתות לשעת משחק'), h('dd', {}, hrs > 0.05 ? num(deaths / hrs, 1) : '–')),
        h('div', {}, h('dt', {}, 'עודד מת בממוצע כל'), h('dd', {}, deaths && hrs > 0.05 ? `${Math.max(1, Math.round((hrs * 60) / deaths))} דק׳ משחק` : '–')),
        h('div', {}, h('dt', {}, 'משימות לשעה'), h('dd', {}, hrs > 0.05 ? num(missions.length / hrs, 1) : '–')),
        h('div', {}, h('dt', {}, 'החלטות של הצ׳אט'), h('dd', {}, num(polls.length))),
        h('div', { class: 'is-wide' }, h('dt', {}, 'אנחנו עכשיו ב'), h('dd', {}, missions[cur] ? link(`עצירה ${cur + 1}: ${missions[cur].title}`, () => opts.openStop(cur)) : '–')),
      ),
    ),
    h('section', { class: 'sx-card' }, h('h3', {}, 'שעות משחק לפי יום'), bars(perDay(l))),
    h(
      'div',
      { class: 'sx-split' },
      h(
        'section',
        { class: 'sx-card' },
        h('h3', {}, 'המשימות הקשות ביותר'),
        hardest.length
          ? h(
              'ol',
              { class: 'sx-hard' },
              ...hardest.map((x, k) => {
                const name = h('button', { type: 'button', class: 'sx-hard__name' }, h('strong', {}, x.m.title || `עצירה ${x.i + 1}`), h('small', {}, `עצירה ${x.i + 1}${x.m.chapter ? `, ${x.m.chapter}` : ''}`));
                name.onclick = () => opts.openStop(x.i);
                return h('li', {}, h('span', { class: 'sx-hard__rank' }, String(k + 1)), name, h('span', { class: 'sx-hard__n' }, `${num(x.n)}`, h('small', {}, ' מיתות')));
              }),
            )
          : h('p', { class: 'sx-empty' }, 'עוד לא מת אף פעם. מרשים.'),
      ),
      h(
        'section',
        { class: 'sx-card' },
        h('h3', {}, 'מה יש על המפה'),
        markers.length
          ? h(
              'ul',
              { class: 'sx-types' },
              ...[...byType.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([t, n]) => h('li', {}, h('span', { class: `sx-type mk--${t}` }, markerIcon(t, 16)), h('span', {}, MARKER_TYPES[t].label), h('b', {}, num(n)))),
            )
          : h('p', { class: 'sx-empty' }, 'עוד אין מרקרים. המודים מוסיפים אותם בזמן הלייב.'),
        markers.length ? link('לכל המרקרים במפה', () => opts.openMarker('')) : null,
      ),
    ),
    h('p', { class: 'sx-foot' }, 'זמן המשחק נספר רק כשהלייב בקטגוריה של GTA 6. המספרים מתעדכנים לבד.'),
  ];
}

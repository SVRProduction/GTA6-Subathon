// פיד הפעילות: כל מה שקורה במסע, בציר זמן אחד – עצירות, מיילסטונים, מוות וחתולים, מרקרים, קליפים,
// תגובות, סטוריז וסקרים. "מה פספסת" – סיכום מאז הביקור הקודם.
import { clipStop } from '../clips';
import { liveStories, MARKER_TYPES, type Clip, type Comment, type Data, type Extras, type LiveData, type Marker, type Poll, type Story } from '../data/types';
import { h } from '../dom';
import { markerIcon, svg } from './icons';

export type FeedKind = 'stop' | 'ms' | 'death' | 'cat' | 'marker' | 'clip' | 'comment' | 'story' | 'poll';
export interface FeedEv {
  key: string;
  t: number;
  kind: FeedKind;
  title: string;
  sub?: string;
  stop?: number;
  marker?: Marker;
  clip?: Clip;
  story?: Story;
  poll?: Poll;
}
const LABEL: Record<FeedKind, string> = {
  ms: 'מיילסטון',
  stop: 'עצירה',
  death: 'מוות',
  cat: 'חתול',
  marker: 'מרקר',
  clip: 'קליפ',
  comment: 'תגובה',
  story: 'סטורי',
  poll: 'סקר',
};
const FILTERS: Array<[string, string, FeedKind[] | null]> = [
  ['all', 'הכול', null],
  ['stops', 'עצירות', ['stop', 'ms']],
  ['map', 'מרקרים', ['marker', 'death']],
  ['social', 'צופים', ['comment', 'story', 'poll']],
  ['clips', 'קליפים', ['clip']],
];
const LAST_KEY = 'mc-last-visit';
const hm = (t: number) => new Date(t).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
export const ago = (ms: number) => {
  const m = Math.round(ms / 60_000);
  if (m < 1) return 'עכשיו';
  if (m < 60) return `לפני ${m} דק'`;
  if (m < 1440) return `לפני ${Math.round(m / 60)} שעות`;
  return `לפני ${Math.round(m / 1440)} ימים`;
};
function dayLabel(t: number) {
  const d = new Date(t);
  const today = new Date();
  const y = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'היום';
  if (d.toDateString() === y.toDateString()) return 'אתמול';
  return d.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric' });
}

export function feedEvents(d: Data, live: LiveData | null, comments: Comment[], ex: Extras | null): FeedEv[] {
  const out: FeedEv[] = [];
  const idx = new Map(d.missions.map((m, i) => [m.id, i]));
  const stopName = (id: string | null) => {
    const i = id ? idx.get(id) : undefined;
    return i == null ? '' : `במשימה ${i + 1}: ${d.missions[i].title}`;
  };
  d.missions.forEach((m, i) => {
    if (!m.happened_at) return;
    out.push({ key: `s:${m.id}`, t: Date.parse(m.happened_at), kind: m.is_milestone ? 'ms' : 'stop', title: `${i + 1}. ${m.title || 'עצירה'}`, sub: m.summary || m.chapter || '', stop: i });
  });
  // מיתות שנרשמו כמרקר מופיעות פעם אחת (כמרקר), לא גם כספירה
  const deathMarkers = (ex?.markers ?? []).filter((m) => m.type === 'death').map((m) => Date.parse(m.created_at));
  (live?.recent ?? []).forEach((e, k) => {
    if (e.delta < 0) return;
    const t = Date.parse(e.created_at);
    if (e.counter === 'deaths' && deathMarkers.some((x) => Math.abs(x - t) < 5000)) return;
    out.push({ key: `c:${e.counter}:${e.created_at}:${k}`, t, kind: e.counter === 'deaths' ? 'death' : 'cat', title: e.counter === 'deaths' ? 'מת' : 'דרס חתול', sub: stopName(e.mission_id), stop: e.mission_id ? idx.get(e.mission_id) : undefined });
  });
  (ex?.markers ?? []).forEach((m) => out.push({ key: `mk:${m.id}`, t: Date.parse(m.created_at), kind: m.type === 'death' ? 'death' : 'marker', title: m.title || MARKER_TYPES[m.type].label, sub: `${MARKER_TYPES[m.type].label}${m.mission_id && idx.has(m.mission_id) ? `, ${stopName(m.mission_id)}` : ''}`, marker: m }));
  if (!live?.demoClips)
    (live?.clips ?? []).forEach((c) => {
      const i = clipStop(c, d.missions);
      out.push({ key: `k:${c.id}`, t: Date.parse(c.created_at), kind: 'clip', title: c.title || 'קליפ חדש', sub: c.creator ? `קליפ של ${c.creator}` : '', stop: i >= 0 ? i : undefined, clip: c });
    });
  comments.forEach((c) => out.push({ key: `m:${c.id}`, t: Date.parse(c.created_at), kind: 'comment', title: c.username, sub: c.body, stop: c.target_type === 'stop' ? idx.get(c.target_id) : undefined }));
  liveStories(ex?.stories ?? []).forEach((s) => out.push({ key: `st:${s.id}`, t: Date.parse(s.created_at), kind: 'story', title: `${s.username} העלה סטורי`, sub: s.caption, story: s }));
  (ex?.polls ?? []).forEach((p) => {
    out.push({ key: `p:${p.id}`, t: Date.parse(p.created_at), kind: 'poll', title: `סקר: ${p.question}`, sub: p.options.join(' / '), poll: p });
    if (p.status === 'closed' && p.winner != null) out.push({ key: `pw:${p.id}`, t: Date.parse(p.ends_at), kind: 'poll', title: `הצ׳אט החליט: ${p.options[p.winner]}`, sub: p.question, poll: p });
  });
  return out.filter((e) => Number.isFinite(e.t) && e.t <= Date.now() + 60_000).sort((a, b) => b.t - a.t).slice(0, 160);
}

export function feedView(all: FeedEv[], opts: { filter: string; onFilter: (f: string) => void; open: (e: FeedEv) => void; fresh: Set<string> }) {
  const f = FILTERS.find((x) => x[0] === opts.filter)?.[2];
  const list = f ? all.filter((e) => f.includes(e.kind)) : all;
  const chips = h(
    'div',
    { class: 'chips', role: 'group', ariaLabel: 'סינון' },
    ...FILTERS.map(([key, label]) => {
      const b = h('button', { type: 'button', class: 'chip', ariaPressed: String(opts.filter === key) }, label);
      b.onclick = () => opts.onFilter(key);
      return b;
    }),
  );
  const rows: HTMLElement[] = [];
  let day = '';
  for (const e of list) {
    const dl = dayLabel(e.t);
    if (dl !== day) {
      day = dl;
      rows.push(h('li', { class: 'feed__day', ariaHidden: 'true' }, dl));
    }
    const mark =
      e.kind === 'marker' && e.marker ? markerIcon(e.marker.type, 16)
      : e.kind === 'death' ? markerIcon('death', 16)
      : svg({ stop: 'stops', ms: 'decision', cat: 'custom', clip: 'clips', comment: 'chat', story: 'phone', poll: 'poll' }[e.kind as string] ?? 'feed', 16);
    const body = h(
      'button',
      { type: 'button', class: 'ev__body' },
      h('span', { class: 'ev__top' }, h('span', { class: 'ev__kind' }, LABEL[e.kind]), h('time', { dateTime: new Date(e.t).toISOString(), title: new Date(e.t).toLocaleString('he-IL') }, hm(e.t))),
      h('strong', { class: 'ev__title' }, e.title),
      e.sub ? h('span', { class: 'ev__sub' }, e.sub) : null,
    );
    body.onclick = () => opts.open(e);
    rows.push(h('li', { class: `ev ev--${e.kind} ${opts.fresh.has(e.key) ? 'is-new' : ''}` }, h('span', { class: 'ev__mark' }, mark), body));
  }
  if (!rows.length) rows.push(h('li', { class: 'feed__empty' }, 'אין עדיין פעילות מהסוג הזה.'));
  return [chips, h('ol', { class: 'feed' }, ...rows)];
}

/** "מה פספסת": מה קרה מאז הביקור הקודם (פעם אחת לביקור, רק אם עברו יותר מ-10 דקות) */
export function missedSummary(all: FeedEv[]) {
  let last = 0;
  try {
    last = Number(localStorage.getItem(LAST_KEY) || 0);
  } catch {
    /* חסום */
  }
  const markSeen = () => {
    try {
      localStorage.setItem(LAST_KEY, String(Date.now()));
    } catch {
      /* חסום */
    }
  };
  addEventListener('pagehide', markSeen);
  if (!last || Date.now() - last < 10 * 60_000) {
    markSeen();
    return null;
  }
  const since = all.filter((e) => e.t > last);
  if (!since.length) return null;
  const c = (k: FeedKind[]) => since.filter((e) => k.includes(e.kind)).length;
  const parts = ([
    [c(['stop', 'ms']), 'עצירות'],
    [c(['ms']), 'מיילסטונים'],
    [c(['death']), 'מיתות'],
    [c(['marker']), 'מרקרים'],
    [c(['story']), 'סטוריז'],
    [c(['clip']), 'קליפים'],
    [c(['comment']), 'תגובות'],
  ] as Array<[number, string]>).filter(([n]) => n > 0);
  const firstStop = since.filter((e) => e.kind === 'stop' || e.kind === 'ms').pop();
  return { since: last, parts, firstStop: firstStop?.stop ?? null, markSeen };
}

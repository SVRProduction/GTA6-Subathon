// ניהול התוספות של גרסה 6: תור אישור סטוריז, מרקרים חופשיים, סקרים.
// העריכה הנוחה (גרירה על המפה) נמצאת במפה עצמה במצב עריכה; כאן הרשימות והאישורים.
import { fmtDate, h, safeUrl } from '../dom';
import { MARKER_TYPES, pollOpen, type Data, type Extras, type Store } from '../data/types';

interface Ctx {
  store: Store;
  ex: Extras;
  data: Data;
  run: (a: () => Promise<void>, ok?: string) => Promise<boolean>;
  twice: (e: MouseEvent, a: () => void) => void;
}

/** תמונה של סטורי: מהדלי (https), דמו (data:) או קובץ מקומי של הדמו (./demo/…) */
const pic = (u: string) => safeUrl(u) || (/^\.\/[\w/.-]+$/.test(u) ? u : '');

const stopName = (d: Data, id: string | null) => {
  const i = d.missions.findIndex((m) => m.id === id);
  return i >= 0 ? `עצירה ${i + 1}: ${d.missions[i].title}` : '';
};

export function storiesPanel(c: Ctx) {
  const pending = c.ex.stories.filter((s) => s.status === 'pending');
  const live = c.ex.stories.filter((s) => s.status === 'approved' && new Date(s.expires_at).getTime() > Date.now());
  const card = (s: Extras['stories'][number], isPending: boolean) =>
    h(
      'li',
      { class: `sq ${isPending ? 'is-pending' : ''}` },
      h('a', { class: 'sq__img', href: pic(s.image_url) || '#', target: '_blank', rel: 'noopener' }, h('img', { src: pic(s.image_url), alt: s.caption || `סטורי של ${s.username}`, loading: 'lazy' })),
      h(
        'div',
        { class: 'sq__main' },
        h('p', { class: 'sq__meta' }, h('strong', {}, s.username), h('span', {}, fmtDate(s.created_at)), stopName(c.data, s.mission_id) ? h('span', {}, stopName(c.data, s.mission_id)) : null),
        s.caption ? h('p', { class: 'sq__cap' }, s.caption) : h('p', { class: 'sq__cap is-empty' }, 'בלי כיתוב'),
        isPending ? null : h('p', { class: 'sq__meta' }, h('span', {}, `❤ ${s.likes}`), h('span', {}, `נעלם ${fmtDate(s.expires_at)}`)),
        h(
          'div',
          { class: 'ops sq__actions' },
          isPending ? h('button', { type: 'button', class: 'ok', onclick: () => c.run(() => c.store.moderateStory(s.id, 'approve'), 'הסטורי עלה לאתר') }, 'אישור') : null,
          isPending ? h('button', { type: 'button', onclick: () => c.run(() => c.store.moderateStory(s.id, 'reject'), 'נדחה') }, 'דחייה') : h('button', { type: 'button', onclick: () => c.run(() => c.store.moderateStory(s.id, 'reject'), 'הוסר מהאתר') }, 'הסרה'),
          h('button', { type: 'button', class: 'danger', onclick: (e: MouseEvent) => c.twice(e, () => c.run(() => c.store.moderateStory(s.id, 'delete'), 'נמחק')) }, 'מחיקה'),
          h('button', { type: 'button', class: 'danger', title: 'חוסם את המשתמש מלהעלות ומלהגיב', onclick: (e: MouseEvent) => c.twice(e, () => c.run(async () => { await c.store.moderateStory(s.id, 'delete'); await c.store.banUser(s.kick_user_id, s.username); }, `${s.username} נחסם`)) }, 'חסימה'),
        ),
      ),
    );
  return h(
    'section',
    { class: `panel ${pending.length ? 'is-hot' : ''}`, id: 'stories' },
    h('div', { class: 'panel-head' }, h('h2', {}, `סטוריז לאישור (${pending.length})`), h('span', { class: 'hint' }, 'שום סטורי לא מופיע באתר לפני אישור. אחרי 48 שעות הוא נעלם לבד.')),
    pending.length ? h('ul', { class: 'sq-list' }, ...pending.map((s) => card(s, true))) : h('p', { class: 'empty' }, 'אין סטוריז שמחכים. כשצופה מעלה, הוא יופיע כאן.'),
    live.length ? h('details', { class: 'fold fold--inner' }, h('summary', {}, h('span', {}, `באוויר עכשיו (${live.length})`)), h('ul', { class: 'sq-list' }, ...live.map((s) => card(s, false)))) : null,
  );
}

export function markersPanel(c: Ctx) {
  const list = [...c.ex.markers].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return h(
    'section',
    { class: 'panel', id: 'markers' },
    h('div', { class: 'panel-head' }, h('h2', {}, `מרקרים על המפה (${list.length})`), h('a', { class: 'btn', href: './?mod#layers', target: '_blank' }, 'עריכה על המפה')),
    h('p', { class: 'hint' }, 'מוסיפים, גוררים ועורכים מרקרים ישירות על המפה (כפתור "עריכה" בסרגל). כאן אפשר למחוק מהר.'),
    list.length
      ? h(
          'ul',
          { class: 'mk-list' },
          ...list.slice(0, 80).map((m) =>
            h(
              'li',
              {},
              h('span', { class: `mk-list__type t-${m.type}` }, m.emoji || MARKER_TYPES[m.type].label),
              h('div', { class: 'mk-list__main' }, h('strong', {}, m.title || MARKER_TYPES[m.type].label), h('small', {}, [fmtDate(m.created_at), stopName(c.data, m.mission_id)].filter(Boolean).join(' · '))),
              h('div', { class: 'ops' }, h('a', { class: 'mk-list__link', href: `./#marker-${m.id}`, target: '_blank' }, 'במפה'), h('button', { type: 'button', class: 'danger', onclick: (e: MouseEvent) => c.twice(e, () => c.run(() => c.store.deleteMarker(m.id), 'המרקר נמחק')) }, 'מחיקה')),
            ),
          ),
        )
      : h('p', { class: 'empty' }, 'עדיין אין מרקרים.'),
  );
}

export function pollsPanel(c: Ctx) {
  const open = c.ex.polls.find(pollOpen);
  const past = c.ex.polls.filter((p) => p !== open).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 10);
  const q = h('input', { placeholder: 'לאן נוסעים עכשיו?', maxLength: 90 });
  const opts = [0, 1, 2, 3].map((i) => h('input', { placeholder: i < 2 ? `אפשרות ${i + 1}` : `אפשרות ${i + 1} (לא חובה)`, maxLength: 40 }));
  const mins = h('select', {}, ...[1, 2, 3, 5, 10, 15].map((m) => h('option', { value: String(m), selected: m === 3 }, `${m} דק׳`)));
  const bars = (p: Extras['polls'][number]) => {
    const total = p.votes.reduce((a, b) => a + b, 0) || 1;
    return h(
      'ol',
      { class: 'pl-bars' },
      ...p.options.map((o, i) => {
        const li = h('li', { class: p.winner === i ? 'is-win' : '' }, h('span', {}, `!${i + 1} ${o}`), h('b', {}, `${p.votes[i] ?? 0}`));
        li.style.setProperty('--p', `${Math.round(((p.votes[i] ?? 0) / total) * 100)}%`);
        return li;
      }),
    );
  };
  return h(
    'section',
    { class: 'panel', id: 'polls' },
    h('div', { class: 'panel-head' }, h('h2', {}, 'סקרים לצ׳אט'), h('a', { class: 'btn', href: './overlay.html', target: '_blank' }, 'אוברליי ל-OBS')),
    open
      ? h(
          'div',
          { class: 'pl-open' },
          h('p', { class: 'stamp' }, 'פתוח עכשיו'),
          h('h3', {}, open.question),
          bars(open),
          h('div', { class: 'pl-actions' }, h('button', { type: 'button', class: 'btn', onclick: () => c.run(() => c.store.closePoll(open.id), 'הסקר נסגר') }, 'סגירה עכשיו'), h('button', { type: 'button', class: 'btn danger', onclick: (e: MouseEvent) => c.twice(e, () => c.run(() => c.store.deletePoll(open.id), 'נמחק')) }, 'מחיקה')),
        )
      : h(
          'form',
          {
            class: 'pl-form',
            onsubmit: (e: Event) => {
              e.preventDefault();
              const options = opts.map((o) => o.value.trim()).filter(Boolean);
              if (!q.value.trim() || options.length < 2) return;
              c.run(() => c.store.createPoll({ question: q.value.trim(), options, minutes: Number(mins.value), x: null, y: null }), 'הסקר נפתח – הצ׳אט יכול להצביע');
            },
          },
          h('label', { class: 'field' }, h('span', {}, 'שאלה'), q),
          h('div', { class: 'pl-opts' }, ...opts),
          h('div', { class: 'pl-row' }, h('label', { class: 'field' }, h('span', {}, 'זמן'), mins), h('button', { class: 'btn primary', type: 'submit' }, 'פתיחת סקר')),
          h('p', { class: 'hint' }, 'רוצים שההחלטה תסומן על המפה? פותחים את הסקר מהמפה (כפתור "סקר") ובוחרים מיקום.'),
        ),
    past.length ? h('details', { class: 'fold fold--inner' }, h('summary', {}, h('span', {}, `סקרים קודמים (${past.length})`)), h('ul', { class: 'pl-past' }, ...past.map((p) => h('li', {}, h('div', { class: 'pl-past__head' }, h('strong', {}, p.question), h('div', { class: 'ops' }, h('button', { type: 'button', class: 'danger', onclick: (e: MouseEvent) => c.twice(e, () => c.run(() => c.store.deletePoll(p.id), 'נמחק')) }, 'מחיקה'))), bars(p))))) : null,
  );
}

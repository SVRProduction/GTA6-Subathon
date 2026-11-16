// קליפים מקטגוריית GTA 6 ב-Kick
import { h, safeUrl } from '../dom';
import { commentsFor, on, state } from './state';
import { ago, bdi, dur, ico, num } from './ui';

type Sort = 'new' | 'top';

export function createClips() {
  let sort: Sort = 'new';
  let shown = 24;
  const grid = h('ul', { class: 'clips__grid' });
  const note = h('p', { class: 'clips__note' });
  const more = h('button', { type: 'button', class: 'btn btn--ghost clips__more' }, 'עוד קליפים');
  more.onclick = () => {
    shown += 24;
    render();
  };
  const seg = h('div', { class: 'seg', role: 'radiogroup', ariaLabel: 'סדר הקליפים' });
  const mk = (v: Sort, label: string) => {
    const b = h('button', { type: 'button', class: 'seg__btn', role: 'radio' }, label);
    b.dataset.v = v;
    b.onclick = () => {
      sort = v;
      shown = 24;
      render();
    };
    return b;
  };
  seg.append(mk('new', 'החדשים'), mk('top', 'הכי נצפים'));

  const root = h('section', { class: 'clips' },
    h('header', { class: 'view__head' },
      h('h2', { class: 'view__h', id: 'clips-h' }, 'קליפים'),
      h('p', { class: 'view__lede' }, 'הרגעים שהצ׳אט חתך מהלייב, מקטגוריית GTA 6 ב-Kick.'),
    ),
    h('div', { class: 'road__tools' }, seg, note),
    grid,
    more,
  );
  root.setAttribute('aria-labelledby', 'clips-h');

  let slow = false;
  setTimeout(() => {
    slow = true;
    if (!state.live) render();
  }, 10_000);

  function render() {
    seg.querySelectorAll<HTMLButtonElement>('.seg__btn').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === sort)));
    const live = state.live;
    if (!live) {
      note.textContent = '';
      more.hidden = true;
      grid.replaceChildren(
        ...(slow
          ? [h('li', { class: 'clips__empty' }, 'Kick לא עונה כרגע. הקליפים יופיעו כאן כשהחיבור יחזור.')]
          : Array.from({ length: 6 }, () => h('li', { class: 'clip clip--ghost', ariaHidden: 'true' }, h('span', { class: 'clip__thumb' }), h('span', { class: 'clip__t' }, ' ')))),
      );
      return;
    }
    const all = [...live.clips].sort((a, b) => (sort === 'top' ? b.views - a.views : Date.parse(b.created_at) - Date.parse(a.created_at)));
    note.textContent = live.demoClips ? 'בדמו: הקליפים האחרונים מהערוץ, מכל הקטגוריות' : all.length ? `${num(all.length)} קליפים` : '';
    if (!all.length) {
      grid.replaceChildren(h('li', { class: 'clips__empty' }, 'עוד אין קליפים מ-GTA 6. רואים רגע טוב בלייב? חותכים קליפ ב-Kick והוא יגיע לכאן.'));
      more.hidden = true;
      return;
    }
    grid.replaceChildren(
      ...all.slice(0, shown).map((c) => {
        const th = safeUrl(c.thumbnail_url);
        const n = commentsFor('clip', c.id).length;
        return h('li', { class: 'clip' },
          h('a', { class: 'clip__hit', href: `#/clip/${encodeURIComponent(c.id)}` },
            h('span', { class: 'clip__thumb' },
              th ? h('img', { src: th, alt: '', loading: 'lazy' }) : null,
              c.duration ? h('span', { class: 'clip__dur' }, dur(c.duration)) : null,
              h('span', { class: 'clip__play', ariaHidden: 'true' }, ico.play(22)),
            ),
            h('span', { class: 'clip__t', dir: 'auto' }, c.title || 'קליפ בלי שם'),
            h('span', { class: 'clip__meta' },
              c.creator ? bdi(c.creator) : null,
              h('span', {}, ico.eye(), ' ', num(c.views)),
              n ? h('span', {}, ico.chat(), ' ', num(n)) : null,
              h('time', { dateTime: c.created_at }, ago(c.created_at)),
            ),
          ),
        );
      }),
    );
    more.hidden = all.length <= shown;
  }
  render();
  on('live', render);
  on('comments', render);
  return root;
}

// הדרך: העצירות כשלטי כביש. למעלה – איפה שאנחנו עכשיו והדרך שנמשכת; גוללים למטה – אחורה בזמן עד נקודת ההתחלה.
import { countOf, currentIndex, type Mission } from '../data/types';
import { h, safeUrl } from '../dom';
import { commentsFor, on, state } from './state';
import { ago, ico, num, whenText } from './ui';

type Filter = 'all' | 'ms';
const FKEY = 'fresh-road-filter';

const exitNo = (m: Mission, i: number) => i + 1;

function tallies(m: Mission) {
  const out: Node[] = [];
  const live = state.live;
  if (live) {
    const d = countOf(live, 'deaths', m.id);
    const c = countOf(live, 'cats', m.id);
    if (d) out.push(h('span', { class: 'tally tally--d', title: `${d} מיתות בעצירה הזו` }, ico.skull(15), h('span', {}, num(d)), h('span', { class: 'sr' }, ' מיתות')));
    if (c) out.push(h('span', { class: 'tally tally--c', title: `${c} חתולים בעצירה הזו` }, ico.cat(15), h('span', {}, num(c)), h('span', { class: 'sr' }, ' חתולים')));
  }
  const n = commentsFor('stop', m.id).length;
  if (n) out.push(h('span', { class: 'tally', title: `${n} תגובות` }, ico.chat(), h('span', {}, num(n)), h('span', { class: 'sr' }, ' תגובות')));
  return out;
}

function plate(m: Mission, i: number, cls = '') {
  return h('span', { class: `plate ${m.kind === 'moment' ? 'plate--moment' : ''} ${cls}`, ariaHidden: 'true' }, String(exitNo(m, i)));
}

function rowStop(m: Mission, i: number, ahead: boolean) {
  const meta = h('span', { class: 'row__meta' },
    m.kind === 'moment' ? h('span', { class: 'row__kind' }, 'רגע') : null,
    m.happened_at ? h('time', { dateTime: m.happened_at }, ago(m.happened_at)) : null,
    ...tallies(m),
  );
  return h('li', { class: `stop row ${ahead ? 'is-ahead' : ''}`, id: `s-${m.id}` },
    h('span', { class: 'stop__mark', ariaHidden: 'true' }),
    h('a', { class: 'row__hit', href: `#/stop/${encodeURIComponent(m.id)}` },
      plate(m, i),
      h('span', { class: 'row__txt' },
        h('span', { class: 'row__title' }, h('span', { class: 'sr' }, `יציאה ${exitNo(m, i)}: `), m.title || `עצירה ${exitNo(m, i)}`),
        m.summary ? h('span', { class: 'row__sum' }, m.summary) : null,
        meta,
      ),
    ),
  );
}

function bigSign(m: Mission, i: number, ahead: boolean) {
  const img = safeUrl(m.image_url);
  return h('li', { class: `stop big ${ahead ? 'is-ahead' : ''}`, id: `s-${m.id}` },
    h('span', { class: 'stop__mark stop__mark--big', ariaHidden: 'true' }),
    h('a', { class: `sign ${m.kind === 'moment' ? 'sign--moment' : ''}`, href: `#/stop/${encodeURIComponent(m.id)}` },
      h('span', { class: 'sign__tab' }, `יציאה ${exitNo(m, i)}`),
      h('span', { class: 'sign__face' },
        img ? h('img', { class: 'sign__img', src: img, alt: '', loading: 'lazy' }) : null,
        h('span', { class: 'sign__body' },
          h('span', { class: 'sign__title' }, m.title || `עצירה ${exitNo(m, i)}`),
          m.summary ? h('span', { class: 'sign__sum' }, m.summary) : null,
          m.quote ? h('span', { class: 'sign__quote' }, `״${m.quote}״`) : null,
          h('span', { class: 'sign__meta' },
            m.happened_at ? h('time', { dateTime: m.happened_at }, whenText(m.happened_at)) : null,
            ...tallies(m),
          ),
        ),
      ),
    ),
  );
}

function hereSign(m: Mission, i: number) {
  const img = safeUrl(m.image_url);
  return h('li', { class: 'stop here', id: `s-${m.id}` },
    h('span', { class: 'stop__mark stop__mark--here', ariaHidden: 'true' }),
    h('a', { class: 'here__sign', href: `#/stop/${encodeURIComponent(m.id)}` },
      h('span', { class: 'here__you' }, ico.locate(), 'אתה כאן'),
      h('span', { class: 'here__face' },
        h('span', { class: 'here__exit' }, `יציאה ${exitNo(m, i)}`, m.chapter ? `, ${m.chapter}` : ''),
        h('span', { class: 'here__title' }, m.title || 'העצירה הנוכחית'),
        m.summary ? h('span', { class: 'here__sum' }, m.summary) : null,
        img ? h('img', { class: 'here__img', src: img, alt: '', loading: 'lazy' }) : null,
        h('span', { class: 'sign__meta' }, m.happened_at ? h('time', { dateTime: m.happened_at }, `התחיל ${ago(m.happened_at)}`) : null, ...tallies(m)),
      ),
    ),
  );
}

function chapterSign(name: string, from: number, to: number) {
  return h('li', { class: 'chap' },
    h('span', { class: 'chap__sign' },
      h('span', { class: 'chap__small' }, 'ברוכים הבאים ל'),
      h('span', { class: 'chap__name' }, name),
      h('span', { class: 'chap__range' }, from === to ? `יציאה ${from}` : `יציאות ${from}–${to}`),
    ),
  );
}

export function createRoad() {
  let filter: Filter = 'all';
  try {
    filter = (localStorage.getItem(FKEY) as Filter) || 'all';
  } catch {
    /* חסום */
  }
  const list = h('ol', { class: 'road__list' });
  const count = h('p', { class: 'road__count' });
  const seg = h('div', { class: 'seg', role: 'radiogroup', ariaLabel: 'מה להציג בדרך' });
  const mkSeg = (v: Filter, label: string) => {
    const b = h('button', { type: 'button', class: 'seg__btn', role: 'radio' }, label);
    b.onclick = () => {
      filter = v;
      try {
        localStorage.setItem(FKEY, v);
      } catch {
        /* חסום */
      }
      render();
    };
    b.dataset.v = v;
    return b;
  };
  seg.append(mkSeg('all', 'כל העצירות'), mkSeg('ms', 'רק מיילסטונים'));

  const head = h('div', { class: 'road__head' },
    h('div', { class: 'horizon', ariaHidden: 'true' }),
    h('h2', { class: 'road__h' }, 'הדרך נמשכת'),
    h('p', { class: 'road__lede' }, 'אין קו סיום. כל עצירה חדשה מתווספת כאן בזמן הלייב.'),
  );
  const tools = h('div', { class: 'road__tools' }, seg, count);
  const foot = h('div', { class: 'road__start' });
  const root = h('section', { class: 'road', id: 'road', ariaLabel: 'הדרך' }, head, tools, list, foot);

  let known = new Set<string>();
  const fresh = new Map<string, number>();
  let first = true;

  function render() {
    const ms = state.data.missions;
    seg.querySelectorAll<HTMLButtonElement>('.seg__btn').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === filter)));
    if (!ms.length) {
      list.replaceChildren(h('li', { class: 'road__empty' }, state.loaded ? 'הדרך עוד לא התחילה. העצירה הראשונה תופיע כאן ברגע שתתווסף.' : 'טוען את הדרך…'));
      count.textContent = '';
      foot.replaceChildren();
      return;
    }
    const cur = currentIndex(state.data);
    const msCount = ms.filter((m) => m.is_milestone).length;
    count.textContent = `${num(ms.length)} עצירות, ${num(msCount)} מיילסטונים`;

    const items: Node[] = [];
    let chapter: string | null | undefined;
    // מהחדש לישן
    for (let i = ms.length - 1; i >= 0; i--) {
      const m = ms[i];
      const ahead = i > cur;
      const isHere = i === cur;
      if (filter === 'ms' && !m.is_milestone && !isHere) continue;
      if (isHere) {
        if (cur < ms.length - 1) items.push(h('li', { class: 'road__ahead-note' }, 'מעל: עצירות שכבר תוכננו ועוד לא הגענו אליהן'));
        items.push(hereSign(m, i));
        chapter = null; // שלט הפרק מופיע מתחת ל"אתה כאן"
        continue;
      }
      if (!ahead && m.chapter && m.chapter !== chapter) {
        // שלט פרק בראש כל רצף של עצירות באותו פרק (מהחדשה לישנה)
        let j = i;
        while (j > 0 && ms[j - 1].chapter === m.chapter) j--;
        items.push(chapterSign(m.chapter, j + 1, i + 1));
      }
      if (!ahead) chapter = m.chapter;
      if (m.is_milestone) items.push(bigSign(m, i, ahead));
      else items.push(rowStop(m, i, ahead));
    }
    // שומרים על פוקוס המקלדת כשהרשימה מתעדכנת ברקע
    const focusedId = (document.activeElement as HTMLElement | null)?.closest?.('li.stop')?.id;
    list.replaceChildren(...items);
    if (focusedId && list.contains(document.activeElement) === false) {
      document.getElementById(focusedId)?.querySelector<HTMLElement>('a')?.focus({ preventScroll: true });
    }

    // עצירה חדשה שנוספה בזמן שהדף פתוח – מסמנים אותה
    // (האדמין שומר פעמיים ברצף – עצירה ואז הגדרות – אז זוכרים את החדשות כמה שניות)
    if (!first) for (const m of ms) if (!known.has(m.id)) fresh.set(m.id, Date.now());
    for (const [id, t] of fresh) {
      if (Date.now() - t > 4000) fresh.delete(id);
      else document.getElementById(`s-${id}`)?.classList.add('is-new');
    }
    known = new Set(ms.map((m) => m.id));
    first = false;

    const st = state.data.settings.started_at ?? ms[0]?.happened_at;
    foot.replaceChildren(
      h('span', { class: 'start__sign' },
        h('span', { class: 'start__h' }, 'נקודת ההתחלה'),
        st ? h('span', {}, `יצאנו לדרך ${whenText(st)}`) : null,
      ),
    );
  }

  render();
  on('data', render);
  on('live', render);
  on('comments', render);
  return root;
}

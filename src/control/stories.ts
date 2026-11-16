// סטוריז במסך מלא: מיילסטונים ("רשמי") וסטוריז שצופים העלו ומוד אישר.
// טאפ שמאלה = הבא (עברית), ימינה = הקודם, החזקה עוצרת, החלקה למטה / Esc סוגרים. לייק ותגובות בכל סטורי.
import { getViewer, login } from '../auth';
import { commentCount, commentsBox } from '../comments';
import type { Mission, Store, Story } from '../data/types';
import { fill, h } from '../dom';
import { ago } from './feed';
import { svg } from './icons';

export type StoryItem =
  | { kind: 'official'; key: string; stop: number; m: Mission; t: number }
  | { kind: 'viewer'; key: string; s: Story; t: number };

const SEEN = 'mc-stories-seen';
export function seenSet(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN) || '[]'));
  } catch {
    return new Set();
  }
}
function markSeen(key: string) {
  const s = seenSet();
  s.add(key);
  try {
    localStorage.setItem(SEEN, JSON.stringify([...s].slice(-400)));
  } catch {
    /* חסום */
  }
}
const LIKED = 'mc-liked';
const liked = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(LIKED) || '[]'));
  } catch {
    return new Set();
  }
};

export function createStoryViewer(opts: {
  store: Store;
  toast: (t: string) => void;
  /** רקע לסטורי רשמי (תמונת העצירה או צילום המפה במקום) */
  stopBg: (i: number) => HTMLElement | null;
  goStop: (i: number) => void;
}) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = h('div', { class: 'story', hidden: true, role: 'dialog', ariaModal: 'true', ariaLabel: 'סטורי' });
  document.body.append(root);
  let items: StoryItem[] = [];
  let at = 0;
  let raf = 0;
  let started = 0;
  let elapsed = 0;
  let paused = false;
  let sheetOpen = false;
  const DUR = 7000;
  let onChange: (() => void) | null = null;

  function open(list: StoryItem[], i: number, changed?: () => void) {
    items = list;
    at = Math.max(0, Math.min(i, list.length - 1));
    onChange = changed ?? null;
    root.hidden = false;
    document.body.classList.add('is-story');
    render();
    requestAnimationFrame(() => root.classList.add('is-open'));
  }
  function close() {
    cancelAnimationFrame(raf);
    root.classList.remove('is-open');
    document.body.classList.remove('is-story');
    root.querySelectorAll('video').forEach((v) => v.pause());
    setTimeout(() => {
      root.hidden = true;
      root.replaceChildren();
    }, reduce ? 0 : 240);
    if (location.hash.startsWith('#story-')) history.replaceState(null, '', location.pathname + location.search);
    onChange?.();
  }
  function step(dir: 1 | -1) {
    if (sheetOpen) return;
    markSeen(items[at].key);
    if (dir === 1 && at >= items.length - 1) return close();
    if (dir === -1 && at === 0) elapsed = 0;
    else at += dir;
    render();
  }
  function tick() {
    const bar = root.querySelector<HTMLElement>('.st-prog .is-cur i');
    const now = performance.now();
    if (!paused && !sheetOpen) elapsed += now - started;
    started = now;
    if (bar) bar.style.transform = `scaleX(${Math.min(1, elapsed / DUR)})`;
    if (elapsed >= DUR) return step(1);
    raf = requestAnimationFrame(tick);
  }

  function comments(type: 'stop' | 'story', id: string) {
    sheetOpen = true;
    const box = h('div', { class: 'st-sheet' });
    const close = h('button', { type: 'button', class: 'pop__close', ariaLabel: 'סגירה' }, '✕');
    close.onclick = () => {
      sheetOpen = false;
      box.remove();
      started = performance.now();
    };
    fill(box, h('header', { class: 'st-sheet__head' }, h('strong', {}, 'תגובות'), close), commentsBox(opts.store, type, id, { toast: opts.toast, title: false }));
    root.append(box);
    setTimeout(() => close.focus(), 30);
  }

  function render() {
    cancelAnimationFrame(raf);
    const it = items[at];
    if (!it) return close();
    history.replaceState(null, '', `#story-${it.key}`);
    const btnClose = h('button', { class: 'st-close', type: 'button', ariaLabel: 'סגירה' }, svg('close', 22));
    btnClose.onclick = close;
    const back = h('button', { class: 'st-zone st-zone--back', type: 'button', ariaLabel: 'הקודם' });
    const fwd = h('button', { class: 'st-zone st-zone--fwd', type: 'button', ariaLabel: 'הבא' });
    back.onclick = () => step(-1);
    fwd.onclick = () => step(1);
    let bg: HTMLElement | null;
    let head: [string, string];
    let title = '';
    let caption = '';
    let ring = '';
    const actions = h('div', { class: 'st-actions' });
    if (it.kind === 'official') {
      bg = opts.stopBg(it.stop);
      head = [`מיילסטון ${it.stop + 1}`, [it.m.stream_day ? `יום ${it.m.stream_day}` : '', it.m.happened_at ? ago(Date.now() - Date.parse(it.m.happened_at)) : ''].filter(Boolean).join('  |  ')];
      title = it.m.title;
      caption = it.m.summary;
      ring = String(it.stop + 1);
      const nC = commentCount('stop', it.m.id);
      const c = h('button', { class: 'pill', type: 'button' }, svg('chat', 18), nC ? `${nC} תגובות` : 'תגובות');
      c.onclick = () => comments('stop', it.m.id);
      const go = h('button', { class: 'pill pill--solid', type: 'button' }, svg('pin', 18), 'לעצירה במפה');
      go.onclick = () => {
        close();
        opts.goStop(it.stop);
      };
      actions.append(go, c);
    } else {
      const s = it.s;
      bg = h('img', { class: 'st-img', src: s.image_url, alt: s.caption || `סטורי של ${s.username}` });
      head = [s.username, ago(Date.now() - Date.parse(s.created_at))];
      caption = s.caption;
      ring = s.username.slice(0, 1).toUpperCase();
      const mine = liked().has(s.id);
      const like = h('button', { class: `pill ${mine ? 'is-on' : ''}`, type: 'button', ariaPressed: String(mine), ariaLabel: 'לייק' }, svg('heart', 18), String(s.likes));
      like.onclick = async () => {
        const v = getViewer();
        if (!v) return login(opts.store);
        if (liked().has(s.id)) return;
        try {
          await opts.store.likeStory(v, s.id);
          const l = liked();
          l.add(s.id);
          localStorage.setItem(LIKED, JSON.stringify([...l]));
          like.classList.add('is-on');
          like.lastChild!.textContent = String(s.likes + 1);
          like.classList.remove('is-pop');
          void like.offsetWidth;
          like.classList.add('is-pop');
        } catch (e) {
          opts.toast((e as Error).message);
        }
      };
      const nC = commentCount('story', s.id);
      const c = h('button', { class: 'pill', type: 'button' }, svg('chat', 18), nC ? String(nC) : 'תגובה');
      c.onclick = () => comments('story', s.id);
      actions.append(like, c);
    }
    const share = h('button', { class: 'pill pill--icon', type: 'button', ariaLabel: 'שיתוף' }, svg('share', 18));
    share.onclick = async () => {
      const url = `${location.origin}${location.pathname}#story-${it.key}`;
      try {
        if (navigator.share) await navigator.share({ title: title || 'סטורי מהסאבתון', url });
        else {
          await navigator.clipboard.writeText(url);
          opts.toast('הקישור הועתק');
        }
      } catch {
        /* בוטל */
      }
    };
    actions.append(share);
    fill(
      root,
      h('div', { class: 'st-frame' },
        h('div', { class: 'st-bg' }, bg),
        h('div', { class: 'st-shade' }),
        h('div', { class: 'st-prog', ariaHidden: 'true' }, ...items.map((_, k) => h('span', { class: k < at ? 'is-done' : k === at ? 'is-cur' : '' }, h('i')))),
        h('div', { class: 'st-head' }, h('span', { class: `st-ring ${it.kind === 'official' ? 'is-official' : ''}` }, h('b', {}, ring)), h('div', {}, h('strong', {}, head[0]), h('small', {}, head[1])), btnClose),
        back,
        fwd,
        h('div', { class: 'st-body' }, it.kind === 'official' ? h('p', { class: 'st-chip' }, 'סטורי רשמי') : null, title ? h('h2', { class: 'st-title' }, title) : null, caption ? h('p', { class: 'st-sum' }, caption) : null, actions),
      ),
    );
    elapsed = 0;
    started = performance.now();
    paused = false;
    if (!reduce) raf = requestAnimationFrame(tick);
    else root.querySelector<HTMLElement>('.st-prog .is-cur i')?.style.setProperty('transform', 'scaleX(1)');
    setTimeout(() => btnClose.focus({ preventScroll: true }), 20);
  }

  // מחוות
  {
    let y0 = 0;
    let x0 = 0;
    let dy = 0;
    let down = false;
    root.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.st-actions, .st-close, .st-sheet')) return;
      down = true;
      y0 = e.clientY;
      x0 = e.clientX;
      dy = 0;
      paused = true;
    });
    root.addEventListener('pointermove', (e) => {
      if (!down) return;
      dy = Math.max(0, e.clientY - y0);
      const f = root.querySelector<HTMLElement>('.st-frame');
      if (f && dy > 6 && Math.abs(e.clientX - x0) < dy) f.style.transform = `translateY(${dy}px) scale(${1 - dy / 2400})`;
    });
    const up = () => {
      if (!down) return;
      down = false;
      paused = false;
      const f = root.querySelector<HTMLElement>('.st-frame');
      if (f) f.style.transform = '';
      if (dy > 110) close();
    };
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', up);
    root.addEventListener(
      'click',
      (e) => {
        if (dy > 12) {
          e.stopPropagation();
          e.preventDefault();
        }
      },
      true,
    );
    addEventListener(
      'keydown',
      (e) => {
        if (root.hidden) return;
        if (e.key === 'Escape') {
          e.stopImmediatePropagation();
          if (sheetOpen) root.querySelector<HTMLButtonElement>('.st-sheet .pop__close')?.click();
          else close();
        }
        if (sheetOpen || (e.target as HTMLElement).closest('textarea, input')) return;
        if (e.key === 'ArrowLeft') (e.stopImmediatePropagation(), step(1));
        if (e.key === 'ArrowRight') (e.stopImmediatePropagation(), step(-1));
      },
      true,
    );
  }

  return { open, close, isOpen: () => !root.hidden };
}
export type StoryViewer = ReturnType<typeof createStoryViewer>;

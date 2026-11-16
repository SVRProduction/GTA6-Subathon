// שכבת המרקרים החופשיים: בכל מקום במפה, לא מחוברים לקו של המסלול.
// כל מרקר הוא "מגן" אחיד עם אייקון – אותה שפה של סימני המשימה, בלי ערבוב של אימוג'ים בגדלים שונים.
import { MARKER_TYPES, pollOpen, type Marker, type MarkerType, type Poll } from '../data/types';
import { h } from '../dom';
import type { World } from '../journey/world';
import { markerIcon, svg } from './icons';

const HIDE_KEY = 'mk-hidden';

export function createMarkerLayer(opts: { stage: HTMLElement; world: World; onOpen: (m: Marker) => void; onPoll: (p: Poll) => void }) {
  const layer = h('div', { class: 'mks', ariaLabel: 'מרקרים על המפה' });
  opts.stage.querySelector('[data-pins]')!.before(layer);
  let list: Marker[] = [];
  let poll: Poll | null = null;
  const els = new Map<string, HTMLButtonElement>();
  let pollEl: HTMLButtonElement | null = null;
  let hidden = new Set<string>();
  try {
    hidden = new Set(JSON.parse(localStorage.getItem(HIDE_KEY) || '[]'));
  } catch {
    /* חסום */
  }
  /** מיקום חי בזמן גרירה (עריכה) – גובר על המיקום השמור */
  const drag = new Map<string, { x: number; y: number }>();

  function pinFor(m: Marker) {
    const face = m.type === 'custom' && m.emoji ? h('span', { class: 'mk__emoji', ariaHidden: 'true' }, m.emoji) : markerIcon(m.type);
    const label = m.title || MARKER_TYPES[m.type].label;
    const b = h(
      'button',
      { type: 'button', class: `mk mk--${m.type}`, ariaLabel: `${MARKER_TYPES[m.type].label}: ${label}` },
      h('span', { class: 'mk__shield' }, face, m.image_url ? h('i', { class: 'mk__has-img', ariaHidden: 'true' }) : null),
      h('span', { class: 'mk__tip', ariaHidden: 'true' }),
      h('span', { class: 'mk__card' }, h('span', { class: 'mk__kind' }, MARKER_TYPES[m.type].label), h('span', { class: 'mk__title' }, label)),
    );
    b.dataset.id = m.id;
    b.onclick = (e) => {
      if (b.dataset.dragged) {
        e.preventDefault();
        delete b.dataset.dragged;
        return;
      }
      opts.onOpen(m);
    };
    return b;
  }

  function set(next: Marker[], nextPoll: Poll | null) {
    list = next;
    const keep = new Set(next.map((m) => m.id));
    for (const [id, el] of els) if (!keep.has(id)) (el.remove(), els.delete(id));
    for (const m of next) {
      const old = els.get(m.id);
      const sig = JSON.stringify([m.type, m.title, m.emoji, m.image_url]);
      if (old && old.dataset.sig === sig) continue;
      const el = pinFor(m);
      el.dataset.sig = sig;
      if (old) old.replaceWith(el);
      else layer.append(el);
      els.set(m.id, el);
    }
    // סקר פתוח עם מיקום: סיכה מיוחדת שמהבהבת
    poll = nextPoll && pollOpen(nextPoll) && nextPoll.x != null ? nextPoll : null;
    if (poll && !pollEl) {
      pollEl = h('button', { type: 'button', class: 'mk mk--poll', ariaLabel: 'סקר פתוח: הצביעו' }, h('span', { class: 'mk__shield' }, svg('poll', 18, 'mk__ic')), h('span', { class: 'mk__tip', ariaHidden: 'true' }), h('span', { class: 'mk__card' }, h('span', { class: 'mk__kind' }, 'סקר פתוח'), h('span', { class: 'mk__title' })));
      layer.append(pollEl);
    }
    if (!poll && pollEl) (pollEl.remove(), (pollEl = null));
    if (poll && pollEl) {
      const p = poll;
      pollEl.querySelector('.mk__title')!.textContent = p.question;
      pollEl.onclick = () => opts.onPoll(p);
    }
    applyHidden();
    place();
  }

  function applyHidden() {
    for (const m of list) els.get(m.id)?.classList.toggle('is-off', hidden.has(m.type));
    layer.classList.toggle('is-route-off', hidden.has('route'));
    opts.stage.classList.toggle('is-route-off', hidden.has('route'));
  }

  function place() {
    const { w, h: hh } = opts.world.size();
    if (w <= 1) return;
    const { w: vw, h: vh } = opts.world.view();
    const pos = (x: number, y: number, el: HTMLElement) => {
      const s = opts.world.project({ x: x * w, y: y * hh });
      const off = s.x < -60 || s.y < -60 || s.x > vw + 60 || s.y > vh + 60;
      el.hidden = off;
      if (off) return;
      const depth = Math.pow(Math.min(1.25, Math.max(0.6, s.s)), 0.8);
      el.style.transform = `translate3d(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px, 0) scale(${depth.toFixed(3)})`;
      el.style.zIndex = String(Math.round(s.y));
      el.classList.toggle('mk--flip', s.x < vw * 0.42);
    };
    for (const m of list) {
      const el = els.get(m.id);
      if (!el) continue;
      const d = drag.get(m.id);
      pos(d?.x ?? m.x, d?.y ?? m.y, el);
    }
    if (poll && pollEl) pos(poll.x!, poll.y!, pollEl);
  }

  return {
    el: layer,
    set,
    place,
    list: () => list,
    elFor: (id: string) => els.get(id) ?? null,
    setDrag(id: string, p: { x: number; y: number } | null) {
      if (p) drag.set(id, p);
      else drag.delete(id);
      place();
    },
    hidden: () => hidden,
    toggle(type: MarkerType | 'route', on: boolean) {
      if (on) hidden.delete(type);
      else hidden.add(type);
      try {
        localStorage.setItem(HIDE_KEY, JSON.stringify([...hidden]));
      } catch {
        /* חסום */
      }
      applyHidden();
    },
  };
}
export type MarkerLayer = ReturnType<typeof createMarkerLayer>;

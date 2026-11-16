// חלון קופץ אחד מעל המפה (במקום דפים נפרדים): סטטיסטיקות, פיד, קליפים, עצירות, מרקר, סקר, מדריך.
// מחשב: כרטיס זכוכית במרכז. טלפון: גיליון מלמטה. Esc / לחיצה על הרקע / ✕ סוגרים.
import { h } from '../dom';

export interface PopupOpts {
  key: string;
  title: string;
  kicker?: string;
  body: Node | Node[];
  /** רוחב: s = 520, m = 760 (ברירת מחדל), l = 1040 */
  size?: 's' | 'm' | 'l';
  onClose?: () => void;
  /** כתובת (‎#stats וכו') – מתעדכנת בפתיחה ומתנקה בסגירה */
  hash?: string;
}

const root = h('div', { class: 'pop', hidden: true });
root.setAttribute('role', 'dialog');
root.setAttribute('aria-modal', 'true');
const backdrop = h('div', { class: 'pop__backdrop' });
const card = h('section', { class: 'pop__card' });
root.append(backdrop, card);
document.body.append(root);

let current: PopupOpts | null = null;
let lastFocus: Element | null = null;

export const popupKey = () => (root.hidden ? null : current?.key ?? null);

export function closePopup() {
  if (root.hidden) return;
  const c = current;
  root.classList.remove('is-open');
  card.querySelectorAll('video').forEach((v) => v.pause());
  const done = () => {
    root.hidden = true;
    card.replaceChildren();
  };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) done();
  else setTimeout(done, 220);
  current = null;
  if (c?.hash && location.hash === c.hash) history.replaceState(null, '', location.pathname + location.search);
  c?.onClose?.();
  (lastFocus as HTMLElement | null)?.focus?.({ preventScroll: true });
}

export function openPopup(o: PopupOpts) {
  if (current && !root.hidden) current.onClose?.();
  lastFocus = root.hidden ? document.activeElement : lastFocus;
  current = o;
  const close = h('button', { class: 'pop__close', type: 'button', ariaLabel: 'סגירה' }, '✕');
  close.onclick = closePopup;
  const head = h('header', { class: 'pop__head' }, h('div', {}, o.kicker ? h('p', { class: 'pop__kicker' }, o.kicker) : null, h('h2', { class: 'pop__title', id: 'pop-title' }, o.title)), close);
  const body = h('div', { class: 'pop__body' });
  body.append(...([] as Node[]).concat(o.body));
  card.className = `pop__card pop__card--${o.size ?? 'm'}`;
  card.dataset.key = o.key;
  card.replaceChildren(h('div', { class: 'pop__grip', ariaHidden: 'true' }), head, body);
  root.setAttribute('aria-labelledby', 'pop-title');
  root.hidden = false;
  requestAnimationFrame(() => root.classList.add('is-open'));
  if (o.hash && location.hash !== o.hash) history.replaceState(null, '', o.hash);
  setTimeout(() => close.focus({ preventScroll: true }), 30);
  return { body, setBody: (...n: Node[]) => body.replaceChildren(...n), setTitle: (t: string) => (head.querySelector('.pop__title')!.textContent = t) };
}

/** מחליף את התוכן של החלון הפתוח (אם הוא עדיין אותו מפתח) בלי לסגור ולפתוח */
export function refreshPopup(key: string, body: Node | Node[]) {
  if (popupKey() !== key) return false;
  const b = card.querySelector('.pop__body');
  if (!b) return false;
  const keep = b.scrollTop;
  b.replaceChildren(...([] as Node[]).concat(body));
  b.scrollTop = keep;
  return true;
}
export const popupBody = () => card.querySelector<HTMLElement>('.pop__body');

backdrop.onclick = closePopup;
addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Escape' && !root.hidden) {
      e.stopImmediatePropagation();
      closePopup();
    }
  },
  true,
);
// גיליון בטלפון: גרירה למטה של הידית סוגרת
{
  let y0 = 0;
  let dy = 0;
  let on = false;
  root.addEventListener('pointerdown', (e) => {
    if (!(e.target as HTMLElement).closest('.pop__grip, .pop__head')) return;
    on = true;
    y0 = e.clientY;
    dy = 0;
  });
  root.addEventListener('pointermove', (e) => {
    if (!on) return;
    dy = Math.max(0, e.clientY - y0);
    if (innerWidth <= 760) card.style.transform = `translateY(${dy}px)`;
  });
  const up = () => {
    if (!on) return;
    on = false;
    card.style.transform = '';
    if (dy > 120 && innerWidth <= 760) closePopup();
  };
  root.addEventListener('pointerup', up);
  root.addEventListener('pointercancel', up);
}

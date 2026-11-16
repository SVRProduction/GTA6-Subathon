// כלים קטנים משותפים: אייקונים, עיצוב מספרים וזמנים, טוסט
import {
  Cat,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Download,
  ExternalLink,
  Eye,
  LocateFixed,
  LogOut,
  Map as MapIcon,
  MessageCircle,
  Minus,
  Play,
  Plus,
  Route,
  Skull,
  X,
  createElement,
  type IconNode,
} from 'lucide';
import { h } from '../dom';

function icon(node: IconNode, size = 20, stroke = 2) {
  const el = createElement(node);
  el.setAttribute('width', String(size));
  el.setAttribute('height', String(size));
  el.setAttribute('stroke-width', String(stroke));
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('focusable', 'false');
  el.classList.add('ic');
  return el;
}

export const ico = {
  skull: (s = 20) => icon(Skull, s),
  cat: (s = 20) => icon(Cat, s),
  close: () => icon(X, 22),
  // בעברית "הבא" הולך שמאלה
  next: () => icon(ChevronLeft),
  prev: () => icon(ChevronRight),
  play: (s = 20) => icon(Play, s),
  download: () => icon(Download),
  out: () => icon(ExternalLink, 18),
  eye: () => icon(Eye, 16),
  road: () => icon(Route, 22),
  clips: () => icon(Clapperboard, 22),
  map: () => icon(MapIcon, 22),
  chat: () => icon(MessageCircle, 16),
  logout: () => icon(LogOut, 18),
  plus: () => icon(Plus),
  minus: () => icon(Minus),
  locate: () => icon(LocateFixed),
};

export const BASE = import.meta.env.BASE_URL;
export const asset = (p: string) => `${BASE}${p}`;

const nf = new Intl.NumberFormat('he-IL');
export const num = (n: number) => nf.format(n);

const dayFmt = new Intl.DateTimeFormat('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit' });
export const whenText = (iso: string | null) => (iso ? `${dayFmt.format(new Date(iso))}, ${timeFmt.format(new Date(iso))}` : '');

const rtf = new Intl.RelativeTimeFormat('he', { numeric: 'auto' });
export function ago(iso: string, now = Date.now()) {
  const s = (Date.parse(iso) - now) / 1000;
  const a = Math.abs(s);
  // זמנים עתידיים (שעון לא מסונכרן / תכנון) – תאריך רגיל במקום "בעוד"
  if (s > 60) return whenText(iso);
  if (a < 60) return 'עכשיו';
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (a < 86400 * 30) return rtf.format(Math.round(s / 86400), 'day');
  return dayFmt.format(new Date(iso));
}

/** שעות:דקות:שניות, השעות בלי תקרה (סאבתון יכול להגיע ל-500 שעות) */
export function hms(ms: number) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(t / 3600);
  const mm = Math.floor((t % 3600) / 60);
  const ss = t % 60;
  return { h: String(hh), m: String(mm).padStart(2, '0'), s: String(ss).padStart(2, '0') };
}

export const dur = (sec: number | null) => {
  if (!sec) return '';
  const m = Math.floor(sec / 60);
  return `${m}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
};

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** שם משתמש מעורב (לטיני/עברי) בתוך טקסט עברי */
export const bdi = (s: string, cls?: string) => h('bdi', { class: cls }, s);

let toastEl: HTMLElement | null = null;
let toastTimer = 0;
export function toast(text: string, action?: { label: string; run: () => void }) {
  if (!toastEl) {
    toastEl = h('div', { class: 'toast', role: 'status' });
    toastEl.setAttribute('aria-live', 'polite');
    document.body.append(toastEl);
  }
  const t = toastEl;
  t.replaceChildren(h('span', {}, text));
  if (action) {
    t.append(
      h('button', {
        type: 'button',
        class: 'toast__btn',
        onclick: () => {
          action.run();
          t.classList.remove('is-on');
        },
      }, action.label),
    );
  }
  t.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove('is-on'), action ? 8000 : 3500);
}

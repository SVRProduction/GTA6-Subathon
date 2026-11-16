// אייקונים אחידים למרקרים ולסרגל: קו 2, פינות עגולות, 24×24 – כמו סמלים של מפת משחק רשמית.
import type { MarkerType } from '../data/types';

const P: Record<string, string> = {
  // גולגולת
  death: '<path d="M12 3c-4.4 0-8 3.2-8 7.6 0 2.5 1.2 4.4 3 5.6V19a1 1 0 0 0 1 1h1.2v-2h1.6v2h2.4v-2h1.6v2H16a1 1 0 0 0 1-1v-2.8c1.8-1.2 3-3.1 3-5.6C20 6.2 16.4 3 12 3Z"/><circle cx="9" cy="11" r="1.7" fill="currentColor" stroke="none"/><circle cx="15" cy="11" r="1.7" fill="currentColor" stroke="none"/><path d="m12 13.3-.9 1.8h1.8z" fill="currentColor"/>',
  // רכב
  car: '<path d="M5 16V12l1.6-4.2A2 2 0 0 1 8.5 6.5h7a2 2 0 0 1 1.9 1.3L19 12v4"/><path d="M4 16h16v2a1 1 0 0 1-1 1h-1.5a1 1 0 0 1-1-1v-1h-9v1a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M5 12h14"/><circle cx="8" cy="14.2" r=".9" fill="currentColor"/><circle cx="16" cy="14.2" r=".9" fill="currentColor"/>',
  // אקדח
  weapon: '<path d="M3 8h15.5a1 1 0 0 1 1 1v1.5a1 1 0 0 1-1 1H13l-.6 1.6a1 1 0 0 1-.9.6h-1.6l-1.3 4.6a1 1 0 0 1-1 .7H5.4a.8.8 0 0 1-.8-1L6.4 11.5H4a1 1 0 0 1-1-1z"/><path d="M19.5 8V6.5M10 13.7l.4-2.2"/>',
  // בית
  property: '<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5h4v5"/>',
  // שק כסף
  heist: '<path d="M9 4h6l-1.5 3h-3z"/><path d="M10.5 7C6.5 9 4.5 12.5 4.5 15.5 4.5 18.5 7.5 20 12 20s7.5-1.5 7.5-4.5c0-3-2-6.5-6-8.5"/><path d="M13.8 11.3c-.4-.6-1.1-.9-1.9-.9-1.1 0-1.9.6-1.9 1.4 0 1.9 3.9 1 3.9 2.9 0 .8-.9 1.4-2 1.4-.9 0-1.6-.3-2-.9M12 9.5v1M12 16.1v1"/>',
  // צופר / סירנה
  chase: '<path d="M7 17v-5a5 5 0 0 1 10 0v5"/><path d="M5 17h14v3H5z"/><path d="M12 3v2M4.2 6.2l1.4 1.4M19.8 6.2l-1.4 1.4M2.5 12h1.5M20 12h1.5"/>',
  // מצלמה
  moment: '<path d="M4 8.5a1.5 1.5 0 0 1 1.5-1.5h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z"/><circle cx="12" cy="13" r="3.6"/>',
  // כוכב
  decision: '<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  custom: '<circle cx="12" cy="12" r="7.5"/><path d="M9 14.2c.7.9 1.8 1.4 3 1.4s2.3-.5 3-1.4"/><circle cx="9.6" cy="10.3" r=".9" fill="currentColor"/><circle cx="14.4" cy="10.3" r=".9" fill="currentColor"/>',
  // סרגל
  stats: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  feed: '<path d="M4 6h16M4 12h10M4 18h13"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>',
  clips: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m10.5 9.2 4.5 2.8-4.5 2.8z" fill="currentColor"/>',
  stops: '<circle cx="6" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><path d="M8 6h6a3 3 0 0 1 0 6h-4a3 3 0 0 0 0 6h6"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  poll: '<path d="M4 20V13M10 20V6M16 20v-9M20 20H3"/><path d="m14.5 4.5 2 2 3.5-3.5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8v.5"/><circle cx="12" cy="17" r=".9" fill="currentColor"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>',
  cinema: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 9h18M3 15h18M7 6v3M12 6v3M17 6v3M7 15v3M12 15v3M17 15v3"/>',
  explore: '<path d="M12 3v18M3 12h18"/><path d="m9 6 3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 3c0 5.4-7.5 10-7.5 10Z"/>',
  chat: '<path d="M5 18.5 4 21l3.4-1.3A8.5 8.5 0 1 0 5 18.5Z"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5"/><path d="M4 19h16"/>',
  map: '<path d="m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  share: '<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="m8.2 10.8 7.6-4M8.2 13.2l7.6 4"/>',
  live: '<circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/>',
};

export function svg(name: string, size = 20, cls = 'ic') {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('width', String(size));
  el.setAttribute('height', String(size));
  el.setAttribute('fill', 'none');
  el.setAttribute('stroke', 'currentColor');
  el.setAttribute('stroke-width', '1.9');
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('class', cls);
  el.innerHTML = P[name] ?? P.custom;
  return el;
}

export const markerIcon = (t: MarkerType, size = 18) => svg(t, size, 'mk__ic');

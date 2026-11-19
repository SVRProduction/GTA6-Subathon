// בוחר מיקום על המפה: לחיצה קובעת את הנקודה, גרירה מתקנת. מציג גם את המסלול והנקודות הקיימות.
import { h } from '../dom';
import type { Mission } from '../data/types';
import { buildCurve, makeTrail, placeAll } from '../journey/route';

export function createPicker(opts: {
  mapUrl: string;
  missions: Mission[]; // כל הנקודות, כולל זו שנערכת
  editingId: string;
  value: { x: number; y: number } | null;
  /** השביל הראשי של המפה המקורית – עצירות נצמדות אליו */
  trail?: Array<[number, number]> | null;
}) {
  let value = opts.value;
  const svgNS = 'http://www.w3.org/2000/svg';
  const img = h('img', { src: opts.mapUrl, alt: 'המפה', draggable: false });
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('preserveAspectRatio', 'none');
  const marker = h('span', { class: 'picker__marker' });
  const hint = h('small', { class: 'picker__hint' });
  // שכבה פנימית שמוגדלת ומוזזת (זום), בתוך מסגרת קבועה
  const stage = h('div', { class: 'picker__stage' }, img, svg, marker);
  const zin = h('button', { type: 'button', class: 'picker__z', ariaLabel: 'הגדלה' }, '+');
  const zout = h('button', { type: 'button', class: 'picker__z', ariaLabel: 'הקטנה' }, '−');
  const zfit = h('button', { type: 'button', class: 'picker__z picker__z--fit', ariaLabel: 'כל המפה' }, '⤢');
  const wrap = h('div', { class: 'picker' }, stage, h('div', { class: 'picker__zoom' }, zin, zout, zfit));
  const clear = h('button', { type: 'button', class: 'btn' }, 'מיקום אוטומטי');
  const root = h('div', { class: 'picker-field' }, wrap, h('div', { class: 'picker__bar' }, hint, clear));

  // ── זום והזזה: גלגלת / צביטה / כפתורים; גרירה מזיזה כשמוגדל, לחיצה קובעת נקודה ──
  let z = 1;
  let tx = 0;
  let ty = 0;
  const ZMAX = 8;
  function clampPan() {
    const w = wrap.clientWidth;
    const hh = wrap.clientHeight;
    tx = Math.min(0, Math.max(w - w * z, tx));
    ty = Math.min(0, Math.max(hh - hh * z, ty));
  }
  function applyZoom() {
    clampPan();
    stage.style.transform = `translate(${tx}px, ${ty}px) scale(${z})`;
    stage.style.setProperty('--pz', String(z));
    wrap.classList.toggle('is-zoomed', z > 1.01);
  }
  /** זום סביב נקודה במסגרת (px יחסית לפינה) */
  function zoomAt(px: number, py: number, f: number) {
    const nz = Math.min(ZMAX, Math.max(1, z * f));
    tx = px - ((px - tx) * nz) / z;
    ty = py - ((py - ty) * nz) / z;
    z = nz;
    applyZoom();
  }
  const center = () => [wrap.clientWidth / 2, wrap.clientHeight / 2] as const;
  zin.onclick = () => zoomAt(...center(), 1.6);
  zout.onclick = () => zoomAt(...center(), 1 / 1.6);
  zfit.onclick = () => {
    z = 1;
    tx = ty = 0;
    applyZoom();
  };
  wrap.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const r = wrap.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0018));
    },
    { passive: false },
  );

  function draw() {
    const w = img.naturalWidth || 1000;
    const hh = img.naturalHeight || 1000;
    svg.setAttribute('viewBox', `0 0 ${w} ${hh}`);
    const list = opts.missions.map((m) => (m.id === opts.editingId ? { ...m, map_x: value?.x ?? null, map_y: value?.y ?? null } : m));
    const trail = opts.trail ? makeTrail(opts.trail, w, hh) : null;
    const pts = placeAll(list, trail);
    const curve = buildCurve(pts, w, hh, trail);
    svg.replaceChildren();
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', curve.path(0, curve.total));
    path.setAttribute('class', 'picker__route');
    svg.append(path);
    list.forEach((m, i) => {
      if (m.id === opts.editingId) return;
      const c = document.createElementNS(svgNS, 'circle');
      c.setAttribute('cx', String(pts[i].x * w));
      c.setAttribute('cy', String(pts[i].y * hh));
      c.setAttribute('r', String(Math.max(w, hh) * (m.is_milestone ? 0.009 : 0.005)));
      c.setAttribute('class', m.is_milestone ? 'picker__ms' : 'picker__pt');
      svg.append(c);
    });
    const me = pts[list.findIndex((m) => m.id === opts.editingId)];
    if (me) {
      marker.style.left = `${me.x * 100}%`;
      marker.style.top = `${me.y * 100}%`;
    }
    marker.classList.toggle('is-auto', !value);
    hint.textContent = value ? 'לחץ או גרור כדי לשנות את המיקום' : opts.trail ? 'מיקום אוטומטי: בהמשך הכביש. לחיצה ליד הכביש נצמדת אליו, לחיצה רחוק ממנו יוצאת מהדרך' : 'מיקום אוטומטי (בהמשך המסלול). לחץ על המפה כדי לקבוע מיקום מדויק';
  }

  function setFrom(e: PointerEvent) {
    const r = img.getBoundingClientRect();
    value = {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
    draw();
  }
  // מצביעים פעילים: אחד = לחיצה/גרירה, שניים = צביטה
  const pts = new Map<number, { x: number; y: number }>();
  let mode: 'none' | 'marker' | 'maybe' | 'pan' | 'pinch' = 'none';
  let start = { x: 0, y: 0, tx: 0, ty: 0 };
  let pinch = 0;
  wrap.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('.picker__zoom')) return;
    wrap.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
      mode = 'pinch';
      return;
    }
    start = { x: e.clientX, y: e.clientY, tx, ty };
    // תפיסה של הסמן = הזזת הנקודה; בלי זום – כל לחיצה קובעת מיד (כמו קודם)
    if ((e.target as HTMLElement).closest('.picker__marker') || z <= 1.01) {
      mode = 'marker';
      setFrom(e);
    } else mode = 'maybe';
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (mode === 'pinch' && pts.size === 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const r = wrap.getBoundingClientRect();
      if (pinch) zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, d / pinch);
      pinch = d;
    } else if (mode === 'marker') setFrom(e);
    else if (mode === 'maybe' && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) mode = 'pan';
    if (mode === 'pan') {
      tx = start.tx + (e.clientX - start.x);
      ty = start.ty + (e.clientY - start.y);
      applyZoom();
    }
  });
  const up = (e: PointerEvent) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (mode === 'maybe') setFrom(e); // לחיצה בלי גרירה = קובעים כאן
    if (!pts.size) mode = 'none';
    else if (mode === 'pinch') mode = 'none';
  };
  wrap.addEventListener('pointerup', up);
  wrap.addEventListener('pointercancel', up);
  clear.onclick = () => {
    value = null;
    draw();
  };
  img.addEventListener('load', draw);
  if (img.complete) draw();

  return { el: root, get: () => value };
}

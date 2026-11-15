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
  const wrap = h('div', { class: 'picker' }, img, svg, marker);
  const clear = h('button', { type: 'button', class: 'btn' }, 'מיקום אוטומטי');
  const root = h('div', { class: 'picker-field' }, wrap, h('div', { class: 'picker__bar' }, hint, clear));

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
  let dragging = false;
  wrap.addEventListener('pointerdown', (e) => {
    dragging = true;
    wrap.setPointerCapture(e.pointerId);
    setFrom(e);
  });
  wrap.addEventListener('pointermove', (e) => dragging && setFrom(e));
  wrap.addEventListener('pointerup', () => (dragging = false));
  clear.onclick = () => {
    value = null;
    draw();
  };
  img.addEventListener('load', draw);
  if (img.complete) draw();

  return { el: root, get: () => value };
}

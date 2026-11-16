// המפה: הדרך שעברנו מצוירת על האי, כל עצירה היא סיכה. זום בכפתורים, גלילה/גרירה להזזה.
import { currentIndex } from '../data/types';
import { h, safeUrl } from '../dom';
import { loadTrail, MAP_ASPECT, placeAll, trailPoints, type Pt } from './geo';
import { on, state } from './state';
import { asset, ico } from './ui';

const ZOOMS = [1, 2, 3.5];
const NS = 'http://www.w3.org/2000/svg';

export function createMap() {
  let z = 0;
  let aspect = MAP_ASPECT;
  let focusId: string | null = null;

  const img = h('img', { class: 'map__img', alt: 'מפת האי של GTA 6 עם הדרך שעברנו', draggable: false, decoding: 'async' });
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'map__svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const pins = h('div', { class: 'map__pins' });
  const canvas = h('div', { class: 'map__canvas' }, img, svg, pins);
  const scroller = h('div', { class: 'map__scroll', dir: 'ltr', tabIndex: 0, ariaLabel: 'המפה. אפשר לגלול כדי להזיז' }, canvas);
  const zin = h('button', { type: 'button', class: 'mapbtn', ariaLabel: 'התקרבות' }, ico.plus());
  const zout = h('button', { type: 'button', class: 'mapbtn', ariaLabel: 'התרחקות' }, ico.minus());
  const here = h('button', { type: 'button', class: 'mapbtn mapbtn--wide' }, ico.locate(), 'איפה אנחנו');
  const legend = h('p', { class: 'map__legend' },
    h('span', { class: 'lg lg--here' }, 'אתה כאן'),
    h('span', { class: 'lg lg--ms' }, 'מיילסטון'),
    h('span', { class: 'lg lg--pt' }, 'עצירה'),
    h('span', { class: 'lg lg--road' }, 'הדרך שעברנו'),
  );
  const note = h('p', { class: 'map__note' });
  const root = h('section', { class: 'mapview' },
    h('header', { class: 'view__head view__head--map' },
      h('div', {}, h('h2', { class: 'view__h', id: 'map-h' }, 'המפה'), legend),
      h('div', { class: 'map__tools' }, here, zout, zin),
    ),
    scroller,
    note,
  );
  root.setAttribute('aria-labelledby', 'map-h');

  // גרירה עם עכבר (במגע הגלילה הטבעית עושה את העבודה)
  let drag: { x: number; y: number; l: number; t: number } | null = null;
  let moved = false;
  scroller.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, l: scroller.scrollLeft, t: scroller.scrollTop };
    moved = false;
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) {
      moved = true;
      scroller.classList.add('is-drag');
    }
    scroller.scrollLeft = drag.l - dx;
    scroller.scrollTop = drag.t - dy;
  });
  window.addEventListener('pointerup', () => {
    drag = null;
    scroller.classList.remove('is-drag');
  });
  scroller.addEventListener('click', (e) => {
    if (moved) {
      e.preventDefault();
      e.stopPropagation();
      moved = false;
    }
  }, true);

  function baseWidth() {
    const w = scroller.clientWidth || 360;
    const hgt = scroller.clientHeight || 500;
    return Math.min(w, hgt * aspect);
  }

  function layout(keep?: Pt) {
    const c = keep ?? centerFrac();
    const bw = baseWidth() * ZOOMS[z];
    canvas.style.width = `${bw}px`;
    canvas.style.height = `${bw / aspect}px`;
    const custom = safeUrl(state.data.settings.map_image_url);
    const want = custom ?? asset(ZOOMS[z] > 1 ? 'map.webp' : 'map-original.webp');
    // ממשיכים להציג את הקטנה עד שהגדולה נטענה
    if (img.dataset.src !== want) {
      if (!img.src || custom) {
        img.src = want;
      } else {
        const pre = new Image();
        pre.onload = () => (img.src = want);
        pre.src = want;
      }
      img.dataset.src = want;
    }
    canvas.dataset.z = String(z);
    zin.disabled = z === ZOOMS.length - 1;
    zout.disabled = z === 0;
    centerOn(c);
  }
  function centerFrac(): Pt {
    const cw = canvas.offsetWidth || 1;
    const ch = canvas.offsetHeight || 1;
    return { x: (scroller.scrollLeft + scroller.clientWidth / 2) / cw, y: (scroller.scrollTop + scroller.clientHeight / 2) / ch };
  }
  function centerOn(p: Pt, smooth = false) {
    const left = p.x * canvas.offsetWidth - scroller.clientWidth / 2;
    const top = p.y * canvas.offsetHeight - scroller.clientHeight / 2;
    scroller.scrollTo({ left, top, behavior: smooth ? 'smooth' : 'auto' });
  }

  img.addEventListener('load', () => {
    const a = img.naturalWidth / img.naturalHeight;
    if (a && Math.abs(a - aspect) > 0.01) {
      aspect = a;
      layout();
    }
  });

  zin.onclick = () => {
    if (z < ZOOMS.length - 1) {
      z++;
      layout();
    }
  };
  zout.onclick = () => {
    if (z > 0) {
      z--;
      layout();
    }
  };
  here.onclick = () => {
    const ms = state.data.missions;
    const p = placeAll(ms, !state.data.settings.map_image_url)[currentIndex(state.data)];
    if (!p) return;
    if (z === 0) z = 1;
    layout(p);
    pins.querySelector<HTMLElement>('.pin.is-here')?.focus({ preventScroll: true });
  };

  function draw() {
    const ms = state.data.missions;
    const custom = !!safeUrl(state.data.settings.map_image_url);
    const pts = placeAll(ms, !custom);
    const cur = currentIndex(state.data);
    svg.replaceChildren();
    const sx = (p: Pt) => `${(p.x * 100).toFixed(2)},${(p.y * 100).toFixed(2)}`;
    const tr = trailPoints();
    if (!custom && tr) {
      const ahead = document.createElementNS(NS, 'polyline');
      ahead.setAttribute('points', tr.map(sx).join(' '));
      ahead.setAttribute('class', 'map__ahead');
      svg.append(ahead);
    }
    const done = pts.slice(0, cur + 1).filter((p): p is Pt => !!p);
    if (done.length > 1) {
      for (const cls of ['map__road-edge', 'map__road', 'map__road-line']) {
        const pl = document.createElementNS(NS, 'polyline');
        pl.setAttribute('points', done.map(sx).join(' '));
        pl.setAttribute('class', cls);
        svg.append(pl);
      }
    }
    const missing = pts.filter((p) => !p).length;
    note.textContent = missing ? `${missing} עצירות בלי מיקום על המפה הזו.` : '';
    pins.replaceChildren(
      ...ms.flatMap((m, i) => {
        const p = pts[i];
        if (!p) return [];
        const cls = i === cur ? 'is-here' : m.is_milestone ? 'is-ms' : i > cur ? 'is-ahead' : '';
        const a = h('a', { class: `pin ${cls}`, href: `#/stop/${encodeURIComponent(m.id)}`, title: m.title },
          h('span', { class: 'pin__dot' }),
          m.is_milestone || i === cur ? h('span', { class: 'pin__label' }, m.title || `עצירה ${i + 1}`) : h('span', { class: 'sr' }, m.title || `עצירה ${i + 1}`),
        );
        a.setAttribute('aria-label', `יציאה ${i + 1}: ${m.title || ''}${i === cur ? ' (אתה כאן)' : ''}`);
        a.style.left = `${p.x * 100}%`;
        a.style.top = `${p.y * 100}%`;
        a.style.zIndex = String(i === cur ? 1000 : m.is_milestone ? 500 + i : i);
        a.dataset.id = m.id;
        return [a];
      }),
    );
  }

  let shownOnce = false;
  function onShow(stop: string | null) {
    focusId = stop;
    requestAnimationFrame(() => {
      const ms = state.data.missions;
      const pts = placeAll(ms, !state.data.settings.map_image_url);
      const idx = focusId ? ms.findIndex((m) => m.id === focusId) : -1;
      if (idx >= 0 && pts[idx]) {
        if (z === 0) z = 1;
        layout(pts[idx]!);
        const pin = pins.querySelector<HTMLElement>(`[data-id="${CSS.escape(focusId!)}"]`);
        pin?.classList.add('is-focus');
        pin?.focus({ preventScroll: true });
        setTimeout(() => pin?.classList.remove('is-focus'), 2400);
      } else if (!shownOnce) {
        layout({ x: 0.5, y: 0.5 });
      } else layout();
      shownOnce = true;
    });
  }

  loadTrail().then(draw);
  draw();
  on('data', draw);
  window.addEventListener('resize', () => root.isConnected && !root.hidden && layout());
  return { el: root, onShow };
}

// המפה הדביקה של Atlas: אותו מנוע מפה (world/route/water/life), אבל המצלמה נשלטת מהטקסט –
// הגלילה בעמוד בוחרת פרק או עצירה, והמפה טסה אליהם בהחלקה. אין חטיפת גלגלת: העמוד נגלל כרגיל.
import type { Data } from '../data/types';
import { currentIndex } from '../data/types';
import { safeUrl } from '../dom';
import { createLife, type Life } from '../journey/life';
import { buildCurve, makeTrail, placeAll, type Curve, type Pt } from '../journey/route';
import { createWater, type Water } from '../journey/water';
import { createWorld } from '../journey/world';

type HdSet = { tiles: string[]; grid: number; w: number };
type Meta = { pad: string; mx: number; my: number; hd?: Record<string, HdSet>; sea?: string; edge?: string; trail?: string };

const B = import.meta.env.BASE_URL;
const DEFAULT_MAP = `${B}map.webp`;
const svgNS = 'http://www.w3.org/2000/svg';

export interface View {
  /** אינדקסים של העצירות שצריכות להיכנס בתמונה */
  stops: number[];
  /** העצירה שמודגשת (נקראת עכשיו), או -1 */
  focus: number;
  /** כמה קרוב: 1 = מתאים בדיוק לעצירות; מעל 1 = קרוב יותר */
  tight?: number;
  /** false = מדגישים את העצירה בלי להתקרב אליה */
  close?: boolean;
  /** הזום המקסימלי, בכפולות של 'כל המפה' */
  maxZ?: number;
}

export function createAtlasMap(stage: HTMLElement, opts: { onPick: (i: number) => void; reduce: boolean; lite: boolean }) {
  const pinsEl = document.createElement('div');
  pinsEl.className = 'amap__pins';
  const sky = document.createElement('div');
  sky.className = 'amap__sky';
  stage.append(sky, pinsEl);

  let data: Data | null = null;
  let curve: Curve | null = null;
  let meta: Meta | null = null;
  let trailRaw: Array<[number, number]> | null = null;
  let metaLoaded = false;
  let pins: HTMLButtonElement[] = [];
  let water: Water | null = null;
  let life: Life | null = null;
  let view: View = { stops: [], focus: -1 };
  let target = { x: 0, y: 0, z: 0.1 };
  let cam = { x: 0, y: 0, z: 0 };
  let tilt = 0;
  let tiltTarget = 0;
  let ready = false;

  const world = createWorld(stage, () => {
    ready = true;
    stage.classList.add('is-ready');
    rebuild();
  });
  const mk = (cls: string, normalized = false) => {
    const p = document.createElementNS(svgNS, 'path');
    p.classList.add(cls);
    if (normalized) p.setAttribute('pathLength', '1');
    return p;
  };
  const trailBase = mk('trail-base');
  const routeAhead = mk('route-ahead');
  const routeCasing = mk('route-casing');
  const routeDone = mk('route-done');
  world.svg.append(trailBase, routeAhead, routeCasing, routeDone);

  fetch(`${B}map.json`)
    .then((r) => (r.ok ? r.json() : null))
    .then((j: Meta | null) => {
      meta = j;
      applyMap();
      return j?.trail ? fetch(`${B}${j.trail}`).then((r) => r.json()) : null;
    })
    .then((t) => (trailRaw = t))
    .catch(() => {})
    .finally(() => {
      metaLoaded = true;
      rebuild();
    });

  function applyMap() {
    if (!data) return;
    const custom = safeUrl(data.settings.map_image_url);
    world.setImage(custom || DEFAULT_MAP);
    world.setPad(!custom && meta ? `${B}${meta.pad}` : null, meta?.mx, meta?.my);
    const wantHd = matchMedia('(min-width: 900px) and (pointer: fine)').matches;
    const levels = !custom && meta?.hd ? [meta.hd.lite, wantHd ? meta.hd.full : null].filter((x): x is HdSet => !!x) : [];
    world.setHd(levels.map((x) => ({ ...x, tiles: x.tiles.map((u) => `${B}${u}`) })));
    world.setEdge(!custom && meta?.edge ? `${B}${meta.edge}` : null);
    if (!custom && meta?.sea && !water) water = createWater(world.tiltLayer, `${B}${meta.sea}`, opts.lite);
    water?.show(!custom);
    if (!custom && meta?.sea && !life) life = createLife(sky, world, `${B}${meta.sea}`, opts.lite);
    life?.show(!custom);
  }

  function rebuild() {
    if (!data || !ready || !metaLoaded) return;
    const { w, h } = world.size();
    if (w <= 1) return;
    const useTrail = !safeUrl(data.settings.map_image_url) && trailRaw;
    const trail = useTrail ? makeTrail(trailRaw!, w, h) : null;
    curve = buildCurve(placeAll(data.missions, trail), w, h, trail);
    life?.setTrail(trail);
    const cur = currentIndex(data);
    const sNow = cur >= 0 ? curve.stopS[cur] : 0;
    trailBase.setAttribute('d', trail ? trail.path : '');
    const done = curve.path(0, sNow || 0.01);
    routeDone.setAttribute('d', done);
    routeCasing.setAttribute('d', done);
    routeAhead.setAttribute('d', curve.path(sNow, curve.total));
    pinsEl.replaceChildren();
    pins = data.missions.map((m, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `apin ${m.is_milestone ? 'apin--ms' : ''} ${i < cur ? 'is-past' : i === cur ? 'is-now' : 'is-future'}`;
      b.setAttribute('aria-label', `עצירה ${i + 1}: ${m.title}`);
      b.innerHTML = m.is_milestone || i === cur ? `<span>${i + 1}</span>` : '';
      b.onclick = () => opts.onPick(i);
      pinsEl.append(b);
      return b;
    });
    setView(view, true);
  }

  /** כמה זום צריך כדי שמלבן במפה ייכנס במסך (עם שוליים) */
  function fit(box: { x0: number; y0: number; x1: number; y1: number }, tight = 1) {
    const { w: vw, h: vh } = world.view();
    const bw = Math.max(box.x1 - box.x0, 1);
    const bh = Math.max(box.y1 - box.y0, 1);
    const z = Math.min(vw / (bw * 1.35), vh / (bh * 1.5)) * tight;
    const fz = world.fitZ();
    return Math.min(fz * 9, Math.max(fz, z));
  }

  function setView(v: View, jump = false) {
    view = v;
    if (!curve || !data) return;
    const { w, h } = world.size();
    const list = v.stops.length ? v.stops : data.missions.map((_, i) => i);
    const pts: Pt[] = list.map((i) => curve!.stops[i]).filter(Boolean);
    if (!pts.length) pts.push({ x: w / 2, y: h / 2 });
    const box = { x0: Math.min(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), x1: Math.max(...pts.map((p) => p.x)), y1: Math.max(...pts.map((p) => p.y)) };
    const overview = !v.stops.length;
    if (overview) Object.assign(box, { x0: 0, y0: 0, x1: w, y1: h });
    let z = overview ? world.fitZ() : fit(box, v.tight ?? 1);
    if (v.maxZ) z = Math.min(z, world.fitZ() * v.maxZ);
    let c = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
    // עצירה מודגשת: מתקרבים אליה, ושומרים אותה במרכז
    const f = v.focus >= 0 ? curve.stops[v.focus] : null;
    if (f && v.close !== false) {
      z = Math.max(z, world.fitZ() * 3.2);
      c = { x: c.x * 0.25 + f.x * 0.75, y: c.y * 0.25 + f.y * 0.75 };
    }
    target = { x: c.x, y: c.y, z };
    tiltTarget = overview ? 0 : opts.reduce ? 0 : 22;
    pins.forEach((p, i) => {
      p.classList.toggle('is-focus', i === v.focus);
      p.classList.toggle('is-in', v.stops.includes(i));
    });
    if (jump || opts.reduce || cam.z === 0) {
      cam = { ...target };
      tilt = tiltTarget;
    }
  }

  // ── לולאה: מצלמה בהחלקה (קפיץ קריטי), סיכות, מים וחיים ──
  let last = performance.now();
  const t0 = last;
  function frame(now: number) {
    requestAnimationFrame(frame);
    if (document.hidden || !curve) return;
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const k = 1 - Math.exp(-dt * 3.2);
    // זום בלוגריתם – כדי שהתקרבות והתרחקות ירגישו באותו קצב
    const lz = Math.log(cam.z) + (Math.log(target.z) - Math.log(cam.z)) * k;
    cam = { x: cam.x + (target.x - cam.x) * k, y: cam.y + (target.y - cam.y) * k, z: Math.exp(lz) };
    tilt += (tiltTarget - tilt) * k;
    world.setTilt(tilt);
    world.setCamera(cam);
    world.apply();
    const { w: vw, h: vh } = world.view();
    // סיכות קטנות כשרואים את כל המפה, בגודל מלא בזום של פרק
    const zk = Math.min(1, Math.max(0.5, cam.z / (world.fitZ() * 2.4)));
    const overview = !view.stops.length;
    pins.forEach((p, i) => {
      const s = world.project(curve!.stops[i]);
      const minor = !p.classList.contains('apin--ms') && !p.classList.contains('is-now') && !p.classList.contains('is-focus');
      const off = s.x < -40 || s.y < -40 || s.x > vw + 40 || s.y > vh + 40 || (overview && minor);
      p.hidden = off;
      if (!off) p.style.transform = `translate3d(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px, 0) scale(${(zk * Math.min(1.15, Math.max(0.75, s.s))).toFixed(3)})`;
    });
    const { w, h } = world.size();
    water?.render(world.camera(), world.tilt(), world.persp(), vw, vh, w, h, opts.reduce ? 0 : (now - t0) / 1000);
    life?.update(dt, !opts.reduce);
  }
  requestAnimationFrame(frame);
  addEventListener('resize', () => setView(view, true));

  return {
    setData(d: Data) {
      const first = !data;
      data = d;
      if (first) applyMap();
      rebuild();
    },
    setView,
    /** צילום קטן של המפה סביב עצירה (לכרטיס מיילסטון בלי תמונה) */
    snapshot(i: number, img: HTMLImageElement) {
      const p = curve?.stops[i];
      if (!p || !img.complete || !img.naturalWidth) return null;
      const { w: W, h: H } = world.size();
      const kx = img.naturalWidth / W;
      const ky = img.naturalHeight / H;
      const cw = 960;
      const ch = 600;
      const span = Math.min(W, H) * 0.2;
      const c = document.createElement('canvas');
      c.width = cw;
      c.height = ch;
      const g = c.getContext('2d')!;
      g.fillStyle = '#0d3a5c';
      g.fillRect(0, 0, cw, ch);
      g.drawImage(img, p.x * kx - (span * kx) / 2, p.y * ky - ((span * ch) / cw) * ky / 2, span * kx, ((span * ch) / cw) * ky, 0, 0, cw, ch);
      // סימון המקום: טבעת לבנה רחבה ונקודה בצבע המבטא – נראה גם על ים וגם על עיר
      g.beginPath();
      g.arc(cw / 2, ch / 2, 44, 0, Math.PI * 2);
      g.lineWidth = 6;
      g.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      g.stroke();
      g.beginPath();
      g.arc(cw / 2, ch / 2, 15, 0, Math.PI * 2);
      g.fillStyle = '#0b6f73';
      g.fill();
      g.lineWidth = 5;
      g.strokeStyle = '#fff';
      g.stroke();
      c.setAttribute('role', 'img');
      c.setAttribute('aria-label', 'המקום על המפה');
      return c;
    },
    ready: () => !!curve,
  };
}

export type AtlasMap = ReturnType<typeof createAtlasMap>;

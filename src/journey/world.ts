// "העולם": תמונת המפה + שכבת המסלול, מוזזים ומוגדלים ב-CSS transform.
// מצב "גרירה חופשית" לפי apple-design: מעקב 1:1, המשך תנועה לפי המהירות בשחרור, התנגדות גומי בקצוות, זום מתחת לאצבע.
import type { Pt } from './route';

export interface Camera {
  x: number; // מרכז, בפיקסלים של התמונה
  y: number;
  z: number; // פיקסלי מסך לכל פיקסל תמונה
}

/** הקצה הרך של Apple: ככל שמושכים רחוק יותר מעבר לגבול, האובייקט עוקב פחות */
const rubberband = (over: number, dim: number, c = 0.55) => (over * dim * c) / (dim + c * Math.abs(over));
/** איפה תנועה תיעצר, לפי מהירות (px/s) – הנוסחה של Apple, ‎0.998 = האטה של גלילה רגילה */
const project = (v: number, d = 0.998) => ((v / 1000) * d) / (1 - d);

/** חציון צבעי השוליים של תמונה */
function edgeColor(im: HTMLImageElement) {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(im, 0, 0, 32, 32);
    const px: number[][] = [];
    for (let i = 1; i < 31; i += 2) for (const [x, y] of [[0, i], [31, i], [i, 0], [i, 31]]) px.push([...g.getImageData(x, y, 1, 1).data].slice(0, 3));
    px.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
    return `rgb(${px[Math.floor(px.length / 2)].join(',')})`;
  } catch {
    return null;
  }
}

export function createWorld(stage: HTMLElement, onSize: (w: number, h: number) => void) {
  const world = document.createElement('div');
  world.className = 'world';
  const img = new Image();
  img.className = 'world__map';
  img.alt = '';
  img.decoding = 'async';
  img.crossOrigin = 'anonymous';
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.classList.add('world__route');
  // ים מסביב למפה (ברזולוציה נמוכה, מאחוריה) – ממלא את המסך כבר במבט הפתיחה
  const pad = new Image();
  pad.className = 'world__pad';
  pad.alt = '';
  pad.decoding = 'async';
  pad.hidden = true;
  // כשיש ים מסביב, הרקע שמעבר לו לוקח את הצבע של קצוות הים (בלי תפר)
  pad.addEventListener('load', () => {
    const c = edgeColor(pad);
    if (c) document.body.style.setProperty('--sea', c);
  });
  // אריחים באיכות גבוהה (רק במחשב): נטענים מעל המפה הרגילה, באותו מקום בדיוק
  const hd = document.createElement('div');
  hd.className = 'world__hd';
  world.append(pad, img, hd, svg);
  // שכבת ההטיה: המפה נוטה לאחור סביב מרכז המסך (מבט רחפן). הסיכות לא בתוכה – הן עומדות ישר
  const tiltLayer = document.createElement('div');
  tiltLayer.className = 'tilt';
  tiltLayer.append(world);
  stage.prepend(tiltLayer);
  let tilt = 0; // מעלות

  let W = 1;
  let H = 1;
  let cam: Camera = { x: 0.5, y: 0.5, z: 1 };
  let free: Camera | null = null;

  img.addEventListener('load', () => {
    W = img.naturalWidth;
    H = img.naturalHeight;
    world.style.width = `${W}px`;
    world.style.height = `${H}px`;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width', String(W));
    svg.setAttribute('height', String(H));
    // צבע הרקע סביב המפה = חציון של צבעי השוליים שלה, כדי שהקצוות ייבלעו (המפה עצמה לא משתנה)
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 32;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(img, 0, 0, 32, 32);
      const px: number[][] = [];
      for (let i = 2; i < 30; i += 3) for (const [x, y] of [[0, i], [31, i], [i, 0], [i, 31]]) px.push([...g.getImageData(x, y, 1, 1).data].slice(0, 3));
      px.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
      const mid = px[Math.floor(px.length / 2)];
      if (pad.hidden) document.body.style.setProperty('--sea', `rgb(${mid.join(',')})`);
    } catch {
      /* תמונה מדומיין אחר בלי CORS – נשארים עם צבע ברירת המחדל */
    }
    onSize(W, H);
  });

  function setImage(url: string) {
    if (img.getAttribute('src') !== url) img.src = url;
  }

  /** mx/my: כמה ים יש מכל צד, ביחס לרוחב/גובה המפה */
  function setPad(url: string | null, mx = 0, my = 0) {
    pad.hidden = !url;
    if (!url) return;
    if (pad.getAttribute('src') !== url) pad.src = url;
    Object.assign(pad.style, {
      left: `${-mx * 100}%`,
      top: `${-my * 100}%`,
      width: `${(1 + 2 * mx) * 100}%`,
      height: `${(1 + 2 * my) * 100}%`,
    });
  }

  const view = () => ({ w: stage.clientWidth, h: stage.clientHeight });

  /** זום שבו כל המפה נכנסת במסך */
  function fitZ() {
    const { w, h } = view();
    return Math.min(w / W, h / H) * 0.94;
  }

  const persp = () => Math.max(700, view().h * 1.25);

  // אריחי HD בכמה רמות: כל רמה נטענת רק כשהזום עובר את מה שהרמה שמתחתיה נותנת, ורק האריחים שנראים על המסך
  type HdSet = { tiles: string[]; grid: number; w: number };
  let hdSets: Array<{ set: HdSet; els: HTMLImageElement[]; from: number }> = [];
  function updateHd(c: Camera, w: number, h: number) {
    const need = c.z * devicePixelRatio; // פיקסלי מסך לכל פיקסל של המפה הרגילה
    const hx = (w / 2 / c.z) * 1.1;
    const hy = (h / 2 / c.z) * (1.1 + tilt / 60); // במבט מוטה רואים רחוק יותר קדימה
    for (const { set, els, from } of hdSets) {
      if (need < from) continue;
      const g = set.grid;
      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        if (el.dataset.on) continue;
        const x0 = ((i % g) * W) / g;
        const y0 = (Math.floor(i / g) * H) / g;
        if (x0 > c.x + hx || x0 + W / g < c.x - hx || y0 > c.y + hy * 0.75 || y0 + H / g < c.y - hy) continue;
        el.dataset.on = '1';
        el.src = set.tiles[i];
      }
    }
  }

  function apply() {
    const c = free ?? cam;
    const { w, h } = view();
    updateHd(c, w, h);
    world.style.transform = `translate3d(${(w / 2 - c.x * c.z).toFixed(2)}px, ${(h / 2 - c.y * c.z).toFixed(2)}px, 0) scale(${c.z.toFixed(5)})`;
    tiltLayer.style.transform = tilt > 0.05 ? `perspective(${persp().toFixed(0)}px) rotateX(${tilt.toFixed(2)}deg)` : '';
  }

  /** נקודה במפה → מיקום על המסך, כולל ההטיה והפרספקטיבה (אותה מתמטיקה כמו ה-CSS). s = קנה מידה לפי עומק */
  /** e = גובה מעל הקרקע בפיקסלים של המפה (הרים בתלת-ממד) */
  function project2(p: Pt, e = 0) {
    const c = free ?? cam;
    const { w, h } = view();
    const X = (p.x - c.x) * c.z;
    const Y = (p.y - c.y) * c.z;
    const E = e * c.z;
    const a = (tilt * Math.PI) / 180;
    const y1 = Y * Math.cos(a) - E * Math.sin(a);
    const z1 = Y * Math.sin(a) + E * Math.cos(a); // חיובי = קרוב לצופה
    const P = persp();
    const s = P / (P - z1);
    return { x: w / 2 + X * s, y: h / 2 + y1 * s, s };
  }

  // ── גרירה חופשית ──
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDist = 0;
  let history: Array<{ x: number; y: number; t: number }> = [];
  let glide = 0;
  // לא מתרחקים יותר מכל המפה על המסך (התרחקות מעבר לזה שברה את התצוגה)
  const minZ = () => fitZ();
  // לא מתקרבים מעבר למה שיש לו פיקסלים אמיתיים (אחרת מטושטש)
  const maxZ = () => Math.max(fitZ() * 2.5, Math.min(fitZ() * 10, ((hdSets[hdSets.length - 1]?.set.w ?? W) / W) / devicePixelRatio));

  /** גבולות: מרכז המצלמה נשאר בתוך המפה */
  // בטיול חופשי מותר לצאת גם אל הים שמסביב למפה (עד שליש מפה לכל צד)
  const ROAM = matchMedia('(pointer: coarse)').matches ? 0.12 : 0.35;
  const bound = (v: number, max: number) => Math.min(max * (1 + ROAM), Math.max(-max * ROAM, v));
  function soft(c: Camera): Camera {
    const { w, h } = view();
    const ox = c.x - bound(c.x, W);
    const oy = c.y - bound(c.y, H);
    return { ...c, x: bound(c.x, W) + rubberband(ox * c.z, w) / c.z, y: bound(c.y, H) + rubberband(oy * c.z, h) / c.z };
  }

  let raw: Camera | null = null; // מיקום "אמיתי" לפני התנגדות הגומי

  function zoomAt(sx: number, sy: number, factor: number) {
    if (!raw) return;
    const { w, h } = view();
    const wx = raw.x + (sx - w / 2) / raw.z;
    const wy = raw.y + (sy - h / 2) / raw.z;
    const z = Math.min(maxZ(), Math.max(minZ(), raw.z * factor));
    raw = { x: wx - (sx - w / 2) / z, y: wy - (sy - h / 2) / z, z };
    free = soft(raw);
  }

  /** שחרור: ממשיכים במהירות האצבע אל הנקודה שהמומנטום מנבא, ואז קפיץ חזרה לתוך הגבולות */
  function release() {
    if (!raw) return;
    const now = performance.now();
    const recent = history.filter((p) => now - p.t < 100);
    let vx = 0;
    let vy = 0;
    if (recent.length >= 2) {
      const a = recent[0];
      const b = recent[recent.length - 1];
      const dt = Math.max(1, b.t - a.t);
      vx = ((b.x - a.x) / dt) * 1000;
      vy = ((b.y - a.y) / dt) * 1000;
    }
    const z = raw.z;
    const from = { ...raw };
    const to = { x: bound(raw.x - project(vx) / z, W), y: bound(raw.y - project(vy) / z, H) };
    // קפיץ בלי קפיצות-יתר (damping 1), response ≈ 0.4s; מתחיל במהירות האצבע
    const start = performance.now();
    const v0x = -vx / z;
    const v0y = -vy / z;
    const omega = (2 * Math.PI) / 0.4;
    cancelAnimationFrame(glide);
    const step = () => {
      if (!raw) return;
      const t = (performance.now() - start) / 1000;
      const e = Math.exp(-omega * t);
      const dx0 = from.x - to.x;
      const dy0 = from.y - to.y;
      raw = { z, x: to.x + (dx0 + (v0x + omega * dx0) * t) * e, y: to.y + (dy0 + (v0y + omega * dy0) * t) * e };
      free = raw;
      if (t < 1.4) glide = requestAnimationFrame(step);
    };
    glide = requestAnimationFrame(step);
  }

  const onDown = (e: PointerEvent) => {
    if (!free || (e.target as HTMLElement).closest('button, a, .panel')) return;
    cancelAnimationFrame(glide); // אפשר לתפוס באמצע תנועה
    raw = { ...free };
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('is-dragging');
    history = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };
  const onMove = (e: PointerEvent) => {
    if (!raw || !pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId)!;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      raw = { ...raw, x: raw.x - (e.clientX - prev.x) / raw.z, y: raw.y - (e.clientY - prev.y) / raw.z };
      free = soft(raw);
      history.push({ x: e.clientX, y: e.clientY, t: performance.now() });
      if (history.length > 8) history.shift();
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const r = stage.getBoundingClientRect();
      if (pinchDist) zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, d / pinchDist);
      pinchDist = d;
      history = [];
    }
  };
  const onUp = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    pinchDist = 0;
    if (!pointers.size) {
      stage.classList.remove('is-dragging');
      if (raw) {
        raw = { ...free! };
        release();
      }
    }
  };
  const onWheel = (e: WheelEvent) => {
    if (!free) return;
    e.preventDefault();
    cancelAnimationFrame(glide);
    raw = { ...free };
    const r = stage.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
  };
  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  stage.addEventListener('wheel', onWheel, { passive: false });

  return {
    svg,
    setImage,
    setPad,
    /** רמות HD מהנמוכה לגבוהה. בכל רמה: אריחים בסדר שורות, grid = אריחים בשורה, w = רוחב התמונה המלאה */
    setHd(sets: HdSet[]) {
      const key = sets.map((x) => x.tiles.join()).join('|');
      if (hd.dataset.src === key) return;
      hd.dataset.src = key;
      let below = W; // הרזולוציה של הרמה שמתחת (מתחילים מהמפה הרגילה)
      hdSets = sets.map((set) => {
        const g = set.grid;
        const els = set.tiles.map((_, i) => {
          const t = new Image();
          t.decoding = 'async';
          t.alt = '';
          t.className = 'world__tile';
          Object.assign(t.style, { left: `${(i % g) * (100 / g)}%`, top: `${Math.floor(i / g) * (100 / g)}%`, width: `${100 / g}%`, height: `${100 / g}%` });
          t.addEventListener('load', () => t.classList.add('is-loaded'));
          return t;
        });
        const from = (below / W) * (below === W ? 0.9 : 1.15); // הרמה הגבוהה רק בזום עמוק באמת
        below = set.w;
        return { set, els, from };
      });
      hd.replaceChildren(...hdSets.flatMap((x) => x.els));
    },
    /** מסכה שמעמעמת את קצות המפה אל הים שמסביב */
    setEdge(url: string | null) {
      for (const el of [img, hd]) {
        el.style.setProperty('-webkit-mask-image', url ? `url("${url}")` : 'none');
        el.style.setProperty('mask-image', url ? `url("${url}")` : 'none');
      }
    },
    persp,
    tiltLayer,
    size: () => ({ w: W, h: H }),
    fitZ,
    view,
    camera: () => free ?? cam,
    setCamera(c: Camera) {
      cam = c;
    },
    apply,
    project: project2,
    /** נקודה על המסך (יחסית לבמה) → נקודה במפה (פיקסלים של התמונה), ההפך של project */
    unproject(sx: number, sy: number) {
      const c = free ?? cam;
      const { w, h } = view();
      const a = (tilt * Math.PI) / 180;
      const P = persp();
      const dx = sx - w / 2;
      const dy = sy - h / 2;
      const Y = (dy * P) / (P * Math.cos(a) + dy * Math.sin(a));
      const s = P / (P - Y * Math.sin(a));
      return { x: c.x + dx / s / c.z, y: c.y + Y / c.z };
    },
    exploring: () => !!free,
    setTilt(deg: number) {
      tilt = deg;
    },
    tilt: () => tilt,
    explore(on: boolean) {
      cancelAnimationFrame(glide);
      free = on ? { ...cam } : null;
      raw = free ? { ...free } : null;
      stage.classList.toggle('is-free', on);
    },
  };
}

export type World = ReturnType<typeof createWorld>;

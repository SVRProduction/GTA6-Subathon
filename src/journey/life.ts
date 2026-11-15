// "חיים" על המפה: סירות ששטות (רק במים), מטוס שחוצה את השמיים עם צל, להקות ציפורים, ומכוניות על הכביש הראשי.
// הכול אלמנטים קטנים שמוקרנים על המפה עם אותה מצלמה (world.project), כך שהם זזים, נוטים ומתקרבים יחד איתה.
import type { Trail } from './route';
import type { World } from './world';

const BOAT = (hull: string, deck: string) =>
  `<svg viewBox="0 0 40 14" aria-hidden="true"><path d="M2 3.5C10 1.2 26 1 33 3.2L39 7l-6 3.8C26 13 10 12.8 2 10.5z" fill="${hull}"/><rect x="9" y="4.6" width="14" height="4.8" rx="1.6" fill="${deck}"/></svg>`;
const CARGO = `<svg viewBox="0 0 60 14" aria-hidden="true"><path d="M2 2h46l10 5-10 5H2z" fill="#7d2f2a"/><rect x="6" y="3.2" width="9" height="7.6" fill="#d9d4c7"/><rect x="18" y="3.6" width="7" height="6.8" fill="#c8862c"/><rect x="26" y="3.6" width="7" height="6.8" fill="#3d6f8f"/><rect x="34" y="3.6" width="7" height="6.8" fill="#b7473a"/></svg>`;
const PLANE = `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M60 32c0 2-4 3.4-9 3.6L40 36 27 58h-6l6-22-13-.6L9 41H5l2.6-9L5 23h4l5 5.6L27 28 21 6h6l13 22 11 .4c5 .2 9 1.6 9 3.6z" fill="currentColor"/></svg>`;
const BIRD = `<svg viewBox="0 0 20 10" aria-hidden="true"><path d="M1 8C4 3 7 2 10 6c3-4 6-3 9 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

interface Mover {
  el: HTMLElement;
  x: number;
  y: number;
  a: number; // כיוון, רדיאנים
  speed: number; // יחידות מפה לשנייה
  len: number; // אורך ביחידות מפה
  px: number; // אורך הספרייט בפיקסלים (לפני הגדלה)
}

export function createLife(layer: HTMLElement, world: World, seaUrl: string, lite: boolean) {
  const root = document.createElement('div');
  root.className = 'life';
  root.setAttribute('aria-hidden', 'true');
  layer.before(root);
  let seed = 41;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  // ── איפה יש ים (מהמסכה) ──
  let sea: Uint8ClampedArray | null = null;
  let sw = 1;
  let shh = 1;
  const boats: Mover[] = [];
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const c = document.createElement('canvas');
    sw = c.width = Math.round(img.naturalWidth / 2);
    shh = c.height = Math.round(img.naturalHeight / 2);
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img, 0, 0, sw, shh);
    sea = g.getImageData(0, 0, sw, shh).data;
    spawnBoats();
  };
  img.src = seaUrl;
  /** האם הנקודה (ביחידות מפה) בים פתוח. מחוץ למפה הכול ים */
  function isSea(x: number, y: number) {
    const { w, h } = world.size();
    const u = x / w;
    const v = y / h;
    if (u < 0 || v < 0 || u >= 1 || v >= 1) return u > -0.45 && u < 1.45 && v > -0.4 && v < 1.4;
    return !!sea && sea[(Math.floor(v * shh) * sw + Math.floor(u * sw)) * 4] > 215;
  }
  /** ים פתוח עם מרווח מהחוף */
  const clear = (x: number, y: number, r: number) => isSea(x, y) && isSea(x + r, y) && isSea(x - r, y) && isSea(x, y + r) && isSea(x, y - r);

  function spawnBoats() {
    const { w, h } = world.size();
    const n = lite ? 9 : 18;
    for (let i = 0; i < n; i++) {
      const kind = i % 6 === 0 ? 'cargo' : i % 3 === 0 ? 'speed' : 'yacht';
      let x = 0;
      let y = 0;
      for (let k = 0; k < 60; k++) {
        x = (-0.15 + rnd() * 1.3) * w;
        y = (-0.1 + rnd() * 1.2) * h;
        if (clear(x, y, w * 0.03)) break;
      }
      const el = document.createElement('span');
      el.className = `boat boat--${kind}`;
      el.innerHTML = `<i></i>${kind === 'cargo' ? CARGO : BOAT(kind === 'speed' ? '#f4f1e8' : '#ffffff', kind === 'speed' ? '#c8452c' : '#9fb4c2')}`;
      root.append(el);
      boats.push({ el, x, y, a: rnd() * Math.PI * 2, speed: (kind === 'cargo' ? 0.0028 : kind === 'speed' ? 0.011 : 0.0055) * w, len: (kind === 'cargo' ? 0.021 : kind === 'speed' ? 0.009 : 0.011) * w, px: kind === 'cargo' ? 60 : 40 });
    }
  }

  // ── מטוס ──
  const plane = document.createElement('span');
  plane.className = 'plane';
  plane.innerHTML = PLANE;
  const planeShadow = document.createElement('span');
  planeShadow.className = 'plane plane--shadow';
  planeShadow.innerHTML = PLANE;
  root.append(planeShadow, plane);
  let pl = { x: 0, y: 0, a: 0, wait: 6 };
  function launch() {
    const { w, h } = world.size();
    const a = rnd() * Math.PI * 2;
    // נכנס מצד אחד של המפה וחוצה אותה דרך אזור המרכז
    const cx = (0.3 + rnd() * 0.4) * w;
    const cy = (0.25 + rnd() * 0.5) * h;
    const R = Math.max(w, h) * 0.95;
    pl = { x: cx - Math.cos(a) * R, y: cy - Math.sin(a) * R, a, wait: -1 };
  }

  // ── ציפורים ──
  const flocks = Array.from({ length: lite ? 1 : 2 }, (_, i) => {
    const el = document.createElement('span');
    el.className = 'flock';
    el.innerHTML = Array.from({ length: 5 }, (_, k) => `<b style="left:${-k * 13 + (k % 2) * 4}px;top:${(k % 2 ? 1 : -1) * Math.ceil(k / 2) * 9}px;animation-delay:${-k * 0.13}s">${BIRD}</b>`).join('');
    root.append(el);
    return { el, x: 0.2 + i * 0.5, y: 0.3 + i * 0.35, a: 0.6 + i * 2.4, t: i * 3 };
  });

  // ── מכוניות על הכביש הראשי ──
  let trail: Trail | null = null;
  let cars: Array<{ el: HTMLElement; s: number; v: number; lane: number }> = [];
  function setTrail(t: Trail | null) {
    trail = t;
    cars.forEach((c) => c.el.remove());
    cars = [];
    if (!t) return;
    const n = lite ? 14 : 34;
    for (let i = 0; i < n; i++) {
      const el = document.createElement('span');
      const dir = i % 2 ? 1 : -1;
      el.className = `car car--${i % 5}`;
      root.append(el);
      cars.push({ el, s: rnd() * t.total, v: dir * (0.006 + rnd() * 0.005) * t.w, lane: dir * 0.0022 * t.w });
    }
  }

  const place = (el: HTMLElement, x: number, y: number, a: number, len: number, px: number, e = 0) => {
    const p = world.project({ x, y }, e);
    const { w: vw, h: vh } = world.view();
    const size = len * world.camera().z * p.s;
    const off = p.x < -size * 4 || p.y < -size * 4 || p.x > vw + size * 4 || p.y > vh + size * 4 || size < 2.5;
    el.hidden = off;
    if (off) return;
    // כיוון על המסך: מקרינים גם נקודה קצת קדימה (ההטיה משנה את הזווית)
    const q = world.project({ x: x + Math.cos(a) * len, y: y + Math.sin(a) * len }, e);
    const ang = Math.atan2(q.y - p.y, q.x - p.x);
    el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0) rotate(${ang.toFixed(3)}rad) scale(${(size / px).toFixed(4)})`;
  };

  return {
    setTrail,
    show(on: boolean) {
      root.hidden = !on;
    },
    /** dt בשניות; move=false מקפיא את התנועה (הפחתת תנועה) אבל עדיין ממקם לפי המצלמה */
    update(dt: number, move: boolean) {
      if (root.hidden) return;
      const { w, h } = world.size();
      const z = world.camera().z;
      // סירות: שטות ישר, ופונות בעדינות כשיש יבשה לפניהן
      for (const b of boats) {
        if (move) {
          const look = b.len * 5 + w * 0.02;
          const free = (da: number) => clear(b.x + Math.cos(b.a + da) * look, b.y + Math.sin(b.a + da) * look, b.len * 1.2) && isSea(b.x + Math.cos(b.a + da) * look * 0.5, b.y + Math.sin(b.a + da) * look * 0.5);
          if (!free(0)) {
            const turn = [0.5, -0.5, 1, -1, 1.6, -1.6, 2.4, -2.4].find(free) ?? 3;
            b.a += Math.sign(turn) * Math.min(Math.abs(turn), 0.9 * dt + 0.01);
          } else b.a += (rnd() - 0.5) * 0.25 * dt;
          const nx = b.x + Math.cos(b.a) * b.speed * dt;
          const ny = b.y + Math.sin(b.a) * b.speed * dt;
          if (isSea(nx, ny)) {
            b.x = nx;
            b.y = ny;
          } else b.a += 1.2 * dt;
        }
        place(b.el, b.x, b.y, b.a, b.len, b.px);
      }
      // מטוס: חוצה את המפה, ואז הפסקה עד הבא
      if (pl.wait >= 0) {
        if (move) pl.wait -= dt;
        plane.hidden = planeShadow.hidden = true;
        if (pl.wait < 0) launch();
      } else {
        const sp = w * 0.035;
        if (move) {
          pl.x += Math.cos(pl.a) * sp * dt;
          pl.y += Math.sin(pl.a) * sp * dt;
        }
        const alt = w * 0.07;
        place(plane, pl.x, pl.y, pl.a, w * 0.022, 64, alt);
        place(planeShadow, pl.x + alt * 0.5, pl.y + alt * 0.35, pl.a, w * 0.02, 64);
        if (pl.x < -w || pl.x > 2 * w || pl.y < -h || pl.y > 2 * h) pl.wait = 14 + rnd() * 16;
      }
      // ציפורים: חגות במעגלים רחבים
      for (const f of flocks) {
        if (move) {
          f.t += dt;
          f.a += Math.sin(f.t * 0.21) * 0.12 * dt + 0.035 * dt;
          f.x += (Math.cos(f.a) * 0.012 * dt * w) / w;
          f.y += (Math.sin(f.a) * 0.012 * dt * w) / h;
          if (f.x < -0.1 || f.x > 1.1 || f.y < -0.1 || f.y > 1.1) f.a += Math.PI * 0.6 * dt;
        }
        place(f.el, f.x * w, f.y * h, f.a, w * 0.02, 60, w * 0.03);
      }
      // מכוניות: רק כשקרובים מספיק כדי לראות אותן
      const showCars = !!trail && z > 0.28;
      for (const c of cars) {
        if (!showCars || !trail) {
          c.el.hidden = true;
          continue;
        }
        if (move) {
          c.s += c.v * dt;
          if (c.s > trail.total) c.s -= trail.total;
          if (c.s < 0) c.s += trail.total;
        }
        const p = trail.at(c.s);
        const q = trail.at(c.s + Math.sign(c.v) * 6);
        const a = Math.atan2(q.y - p.y, q.x - p.x);
        // נתיב: מוסט ימינה מכיוון הנסיעה
        place(c.el, p.x - Math.sin(a) * Math.abs(c.lane), p.y + Math.cos(a) * Math.abs(c.lane), a, w * 0.0042, 14);
      }
    },
  };
}

export type Life = ReturnType<typeof createLife>;

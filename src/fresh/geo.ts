// מיקום העצירות על המפה: מיקום מפורש מהאדמין, ואם אין – לאורך הכביש (trail.json) לפי הסדר
import type { Mission } from '../data/types';
import { asset } from './ui';

export type Pt = { x: number; y: number };
export const MAP_ASPECT = 800 / 984; // רוחב/גובה של מפת ה-GTA המקורית

let trail: Pt[] | null = null;
let trailPromise: Promise<Pt[] | null> | null = null;

export function loadTrail() {
  trailPromise ??= fetch(asset('trail.json'))
    .then((r) => (r.ok ? r.json() : null))
    .then((a: Array<[number, number]> | null) => (trail = a?.map(([x, y]) => ({ x, y })) ?? null))
    .catch(() => null);
  return trailPromise;
}

/** נקודה על הכביש לפי שבר 0–1 מהאורך (מחושב ביחס הממדים האמיתי של המפה) */
function along(t: number, pts: Pt[]): Pt {
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot((pts[i].x - pts[i - 1].x) * MAP_ASPECT, pts[i].y - pts[i - 1].y);
    seg.push(d);
    total += d;
  }
  let want = Math.min(1, Math.max(0, t)) * total;
  for (let i = 0; i < seg.length; i++) {
    if (want <= seg[i] || i === seg.length - 1) {
      const k = seg[i] ? Math.min(1, want / seg[i]) : 0;
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * k, y: pts[i].y + (pts[i + 1].y - pts[i].y) * k };
    }
    want -= seg[i];
  }
  return pts[pts.length - 1];
}

/** מיקום לכל עצירה (null אם אין מיקום ואין כביש, למשל במפה שהועלתה) */
export function placeAll(ms: Mission[], useTrail: boolean): Array<Pt | null> {
  const n = ms.length;
  return ms.map((m, i) => {
    if (m.map_x != null && m.map_y != null) return { x: m.map_x, y: m.map_y };
    if (!useTrail || !trail) return null;
    return along(n > 1 ? i / (n - 1) : 0, trail);
  });
}

export const trailPoints = () => trail;

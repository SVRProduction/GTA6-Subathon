// המסלול על המפה: נקודות (0–1 ביחס לתמונה) → עקומה חלקה, אורך לאורכה, ומיקום מצלמה לפי גלילה.
import type { Mission } from '../data/types';

export interface Pt {
  x: number;
  y: number;
}

export interface Placed extends Pt {
  /** מרחק לאורך השביל הראשי, אם העצירה יושבת עליו */
  s?: number;
}

const clamp01 = (v: number) => Math.min(0.98, Math.max(0.02, v));

/** קטע Catmull-Rom צנטריפטלי (alpha 0.5) מ-p1 עד p2 (בלי p2): עובר בנקודות בלי לולאות ובלי לחרוג בפינות */
function crSegment(p0: Pt, p1: Pt, p2: Pt, p3: Pt, seg: number): Pt[] {
  const dist = (a: Pt, b: Pt) => Math.max(1e-4, Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)));
  const t0 = 0;
  const t1 = t0 + dist(p0, p1);
  const t2 = t1 + dist(p1, p2);
  const t3 = t2 + dist(p2, p3);
  const out: Pt[] = [];
  for (let k = 0; k < seg; k++) {
    const t = t1 + ((t2 - t1) * k) / seg;
    const lerp = (a: Pt, b: Pt, ta: number, tb: number) => ({
      x: ((tb - t) / (tb - ta)) * a.x + ((t - ta) / (tb - ta)) * b.x,
      y: ((tb - t) / (tb - ta)) * a.y + ((t - ta) / (tb - ta)) * b.y,
    });
    const A1 = lerp(p0, p1, t0, t1);
    const A2 = lerp(p1, p2, t1, t2);
    const A3 = lerp(p2, p3, t2, t3);
    out.push(lerp(lerp(A1, A2, t0, t2), lerp(A2, A3, t1, t3), t1, t2));
  }
  return out;
}

/**
 * השביל הראשי: קו שמשורטט על הכבישים של המפה (נקודות 0–1). העצירות יושבות עליו והמסלול נוסע לאורכו.
 * כל המידות כאן בפיקסלים של המפה.
 */
export function makeTrail(raw: Array<[number, number]>, w: number, h: number) {
  const P = raw.map(([x, y]) => ({ x: x * w, y: y * h }));
  const line: Pt[] = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p1 = P[i];
    const p2 = P[i + 1];
    const p0 = P[i - 1] ?? { x: 2 * p1.x - p2.x, y: 2 * p1.y - p2.y };
    const p3 = P[i + 2] ?? { x: 2 * p2.x - p1.x, y: 2 * p2.y - p1.y };
    line.push(...crSegment(p0, p1, p2, p3, 10));
  }
  line.push(P[P.length - 1]);
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y));
  const total = cum[cum.length - 1];

  function at(s: number): Pt {
    s = Math.max(0, Math.min(total, s));
    let lo = 0;
    let hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    const t = cum[hi] === cum[lo] ? 0 : (s - cum[lo]) / (cum[hi] - cum[lo]);
    return { x: line[lo].x + (line[hi].x - line[lo].x) * t, y: line[lo].y + (line[hi].y - line[lo].y) * t };
  }
  /** הנקודה הקרובה ביותר על השביל: המרחק לאורכו (s) והמרחק ממנו (d) */
  function nearest(p: Pt) {
    let best = { s: 0, d: Infinity };
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i];
      const b = line[i + 1];
      const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2));
      const d = Math.hypot(p.x - (a.x + (b.x - a.x) * t), p.y - (a.y + (b.y - a.y) * t));
      if (d < best.d) best = { s: cum[i] + (cum[i + 1] - cum[i]) * t, d };
    }
    return best;
  }
  /** נקודות השביל מ-s0 עד s1 (גם אחורה), כולל ההתחלה ובלי הסוף */
  function between(s0: number, s1: number): Pt[] {
    const out: Pt[] = [at(s0)];
    if (s1 >= s0) {
      for (let i = 0; i < line.length; i++) if (cum[i] > s0 && cum[i] < s1) out.push(line[i]);
    } else {
      for (let i = line.length - 1; i >= 0; i--) if (cum[i] < s0 && cum[i] > s1) out.push(line[i]);
    }
    return out;
  }
  const path = line.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('');
  return { at, nearest, between, total, path, w, h };
}
export type Trail = ReturnType<typeof makeTrail>;

/** כמה עצירות ממלאות את השביל במרווח הרגיל; מעבר לזה המרווחים מצטמצמים */
const TRAIL_STOPS = 110;

/**
 * קובע מיקום לכל עצירה.
 * עם שביל: עצירה בלי מיקום ממשיכה לאורך השביל במרווח קבוע; עצירה שסומנה ליד השביל נצמדת אליו,
 * ועצירה שסומנה רחוק ממנו נשארת איפה שסומנה (והמסלול יוצא אליה מהכביש).
 * בלי שביל (מפה שהועלתה): בין שתי נקודות ידועות – אינטרפולציה; אחרי האחרונה – ממשיכים באותו כיוון.
 */
export function placeAll(missions: Mission[], trail?: Trail | null): Placed[] {
  const known = missions.map((m) => (m.map_x != null && m.map_y != null ? { x: m.map_x, y: m.map_y } : null));
  if (trail) return placeOnTrail(known, trail);
  const idx = known.flatMap((p, i) => (p ? [i] : []));
  const STEP = 0.045;
  if (!idx.length) return missions.map((_, i) => ({ x: 0.35 + i * 0.02, y: 0.2 + i * STEP }));
  const out: Pt[] = known.map((p) => p ?? { x: 0, y: 0 });
  for (let i = 0; i < missions.length; i++) {
    if (known[i]) continue;
    const prev = [...idx].reverse().find((k) => k < i);
    const next = idx.find((k) => k > i);
    if (prev != null && next != null) {
      const t = (i - prev) / (next - prev);
      out[i] = { x: out[prev].x + (out[next].x - out[prev].x) * t, y: out[prev].y + (out[next].y - out[prev].y) * t };
    } else if (prev != null) {
      const before = [...idx].reverse().find((k) => k < prev);
      let dx = 0;
      let dy = STEP;
      if (before != null) {
        const l = Math.hypot(out[prev].x - out[before].x, out[prev].y - out[before].y) || 1;
        dx = ((out[prev].x - out[before].x) / l) * STEP;
        dy = ((out[prev].y - out[before].y) / l) * STEP;
      }
      out[i] = { x: clamp01(out[i - 1].x + dx), y: clamp01(out[i - 1].y + dy) };
    } else if (next != null) {
      out[i] = { x: out[next].x, y: clamp01(out[next].y - STEP * (next - i)) };
    }
  }
  return out;
}

function placeOnTrail(known: Array<Pt | null>, trail: Trail): Placed[] {
  const { w, h, total } = trail;
  const STEP = total / TRAIL_STOPS;
  const SNAP = Math.min(w, h) * 0.045;
  const n = known.length;
  // s לכל עצירה; near = ה-s הקרוב על השביל גם לעצירה שלא נצמדה (כדי להמשיך ממנה)
  const s: Array<number | null> = new Array(n).fill(null);
  const near: number[] = new Array(n).fill(0);
  const free: Array<Pt | null> = new Array(n).fill(null);
  known.forEach((p, i) => {
    if (!p) return;
    const px = { x: p.x * w, y: p.y * h };
    const q = trail.nearest(px);
    near[i] = q.s;
    if (q.d <= SNAP) s[i] = q.s;
    else free[i] = p;
  });
  const lastKnown = known.reduce((a, p, i) => (p ? i : a), -1);
  for (let i = 0; i < n; i++) {
    if (known[i]) continue;
    const next = known.findIndex((p, k) => k > i && p);
    const prevS = i > 0 ? (s[i - 1] ?? near[i - 1]) : null;
    if (prevS != null && next >= 0) s[i] = prevS + (near[next] - prevS) / (next - i + 1);
    else if (prevS != null) s[i] = prevS + STEP;
    else if (next >= 0) s[i] = Math.max(0, near[next] - STEP * (next - i));
    else s[i] = total * 0.004;
    near[i] = s[i]!;
  }
  // הזנב האוטומטי (אחרי העצירה האחרונה שסומנה) לא יוצא מקצה השביל: מצמצמים מרווחים
  const lim = total * 0.985;
  const base = lastKnown >= 0 ? near[lastKnown] : (s[0] ?? 0);
  const max = Math.max(...near.slice(lastKnown + 1), base);
  if (max > lim && max > base) {
    const f = Math.max(0, lim - base) / (max - base);
    for (let i = lastKnown + 1; i < n; i++) if (s[i] != null) s[i] = base + (s[i]! - base) * f;
  }
  return known.map((_, i) => {
    if (free[i]) return free[i]!;
    const p = trail.at(s[i]!);
    return { x: p.x / w, y: p.y / h, s: s[i]! };
  });
}

/** הקו דרך העצירות: לאורך השביל כששתי עצירות יושבות עליו, אחרת עקומת Catmull-Rom. + אורך מצטבר ומיקום כל עצירה */
export function buildCurve(pts: Placed[], w: number, h: number, trail?: Trail | null) {
  const P: Placed[] = pts.map((p) => ({ x: p.x * w, y: p.y * h, s: p.s }));
  const n = P.length;
  // המשך אחרי העצירה האחרונה, לתוך "הלא ידוע": לאורך השביל אם יש, אחרת בכיוון הקטעים האחרונים
  const ext = Math.min(w, h) * 0.1;
  const lastS = n ? P[n - 1].s : undefined;
  if (trail && lastS != null && trail.total - lastS > ext * 0.25) {
    P.push({ ...trail.at(Math.min(trail.total, lastS + ext)), s: Math.min(trail.total, lastS + ext) });
  } else if (n >= 2) {
    const a = P[Math.max(0, n - 4)];
    const b = P[n - 1];
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    P.push({ x: b.x + ((b.x - a.x) / l) * ext, y: b.y + ((b.y - a.y) / l) * ext });
  } else if (n === 1) {
    P.push({ x: P[0].x, y: P[0].y + h * 0.06 });
  }
  const line: Pt[] = [];
  const stopAt: number[] = []; // אינדקס בקו לכל עצירה
  for (let i = 0; i < P.length - 1; i++) {
    const p1 = P[i];
    const p2 = P[i + 1];
    stopAt.push(line.length);
    if (trail && p1.s != null && p2.s != null) {
      line.push(...trail.between(p1.s, p2.s));
      continue;
    }
    const p0 = i > 0 ? P[i - 1] : { x: 2 * p1.x - p2.x, y: 2 * p1.y - p2.y };
    const p3 = i + 2 < P.length ? P[i + 2] : { x: 2 * p2.x - p1.x, y: 2 * p2.y - p1.y };
    line.push(...crSegment(p0, p1, p2, p3, 24));
  }
  line.push(P[P.length - 1]);
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y));
  const stopS = stopAt.slice(0, pts.length).map((i) => cum[i]);
  const total = cum[cum.length - 1];

  function at(s: number): Pt {
    s = Math.max(0, Math.min(total, s));
    let lo = 0;
    let hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    const t = cum[hi] === cum[lo] ? 0 : (s - cum[lo]) / (cum[hi] - cum[lo]);
    return { x: line[lo].x + (line[hi].x - line[lo].x) * t, y: line[lo].y + (line[hi].y - line[lo].y) * t };
  }

  /** מרחק לאורך הקו עבור אינדקס עצירה שברי */
  function sOf(f: number) {
    if (!stopS.length) return 0;
    if (f <= 0) return 0;
    const n = stopS.length;
    if (f >= n - 1) return stopS[n - 1] + (f - (n - 1)) * (total - stopS[n - 1]);
    const i = Math.floor(f);
    return stopS[i] + (stopS[i + 1] - stopS[i]) * (f - i);
  }

  /** נתיב SVG מ-s0 עד s1 */
  function path(s0: number, s1: number) {
    const pts: Pt[] = [at(s0)];
    for (let i = 0; i < line.length; i++) if (cum[i] > s0 && cum[i] < s1) pts.push(line[i]);
    pts.push(at(s1));
    return pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('');
  }

  /** נקודה על גרסה מוחלקת של הקו – בשביל המצלמה, כדי שלא תזוז ימינה-שמאלה בכל פיתול */
  function atSmooth(s: number) {
    const win = Math.min(total * 0.12, Math.min(w, h) * 0.12);
    let x = 0;
    let y = 0;
    let n = 0;
    for (let k = -6; k <= 6; k++) {
      const p = at(s + (win * k) / 6);
      const wt = 7 - Math.abs(k);
      x += p.x * wt;
      y += p.y * wt;
      n += wt;
    }
    return { x: x / n, y: y / n };
  }

  return { at, atSmooth, sOf, path, total, stopS, stops: P.slice(0, pts.length), end: P[P.length - 1] };
}

export type Curve = ReturnType<typeof buildCurve>;

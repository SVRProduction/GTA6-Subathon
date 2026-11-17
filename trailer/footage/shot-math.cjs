// הגיאומטריה של שוטי ה-GTA: חלון הצילום בתוך תמונת המקור לכל פריים, כפונקציה טהורה של (שוט, יחס, פריים).
// קובץ אחד שנטען גם ב-node (make-shots.cjs: תכנון, בדיקת כיסוי, גודל ההכנה) וגם בדף (still.html: ה-transform של כל פריים),
// כדי שמה שנבדק הוא בדיוק מה שמצויר.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShotMath = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const SIZE = { '16x9': [1920, 1080], '9x16': [1080, 1920] };
  const FPS = 30;
  const TAU = Math.PI * 2;
  const lerp = (a, b, t) => a + (b - a) * t;

  /** גיבוב קבוע של שם השוט: זרע לפאזות של הרחף ולגרעין */
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  const unit = (seed, k) => ((Math.imul(seed ^ (k * 0x9e3779b1), 0x85ebca6b) >>> 0) % 100000) / 100000; // 0..1 קבוע

  /**
   * מאחד defaults + השוט + ההגדרות של היחס למפרט שטוח אחד.
   * natural = [רוחב, גובה] של קובץ המקור (נמדד ב-make-shots, לא כתוב ב-shots.json).
   */
  function resolve(shots, name, aspect, natural) {
    const shot = shots[name];
    if (!shot) throw new Error(`shots.json: no shot "${name}"`);
    const d = shots.defaults || {};
    const f = (shot.focus || {})[aspect];
    if (!f) throw new Error(`shots.json: ${name} has no focus for ${aspect}`);
    const m = { ...(d.motion || {}), ...(shot.motion || {}), ...(f.motion || {}) };
    const look = { ...(d.look || {}), ...(shot.look || {}), ...(f.look || {}) };
    const [W, H] = SIZE[aspect];
    const [nw, nh] = natural;
    const a = f.active || shot.active || [0, 0, nw, nh]; // [x, y, w, h] – אזור התמונה בלי פסים שחורים
    const active = { x0: a[0], y0: a[1], x1: a[0] + a[2], y1: a[1] + a[3] };
    // חלון הכיסוי בזום 1: המלבן הגדול ביותר ביחס של הפלט שנכנס באזור הפעיל
    const w0 = Math.min(a[2], (a[3] * W) / H);
    const h0 = (w0 * H) / W;
    return {
      name, aspect, W, H, src: shot.src, natural: [nw, nh], active, w0, h0,
      fx: f.x, fy: f.y,
      zoom: m.zoom || [1, 1.08],
      pan: m.pan || [0, 0, 0, 0],
      ease: m.ease == null ? 0.3 : m.ease,
      drift: m.drift == null ? 0 : m.drift,
      roll: m.roll == null ? 0 : m.roll,
      look,
      keep: f.keep || shot.keep || [],
      avoid: f.avoid || shot.avoid || [],
      seed: hash(name),
    };
  }

  /**
   * התקדמות התנועה 0..1. ease=0: קצב קבוע. ease>0: דחיפה מהירה מיד אחרי החיתוך (על הפעימה) שנרגעת לקצב קבוע –
   * אף פעם לא נעצרת (השוט נחתך באמצע התנועה).
   */
  function progress(t, ease) {
    const tau = 0.16;
    const k = (1 - Math.exp(-t / tau)) / (1 - Math.exp(-1 / tau));
    return (1 - ease) * t + ease * k;
  }

  /** החלון של פריים i מתוך n, בפיקסלים של המקור: מרכז, רוחב, גובה, סיבוב (רדיאנים) והגדלה (פיקסל פלט לפיקסל מקור) */
  function view(s, i, n) {
    const t = n > 1 ? i / (n - 1) : 0;
    const p = progress(t, s.ease);
    const z = s.zoom[0] * Math.pow(s.zoom[1] / s.zoom[0], p); // זום מעריכי: מהירות נראית קבועה
    const w = s.w0 / z;
    const h = s.h0 / z;
    const mag = s.W / w;
    // רחף "מצלמת יד" עדין: סכום סינוסים איטיים (פחות מ-1Hz), פאזות קבועות לפי שם השוט. לא תלוי ב-n.
    const sec = i / FPS;
    const ph = (k) => unit(s.seed, k);
    const dx = s.drift * (0.62 * Math.sin(TAU * (0.31 * sec + ph(1))) + 0.38 * Math.sin(TAU * (0.73 * sec + ph(2))));
    const dy = s.drift * (0.62 * Math.sin(TAU * (0.27 * sec + ph(3))) + 0.38 * Math.sin(TAU * (0.61 * sec + ph(4))));
    const rot = ((s.roll * Math.PI) / 180) * Math.sin(TAU * (0.23 * sec + ph(5)));
    return {
      cx: s.fx + s.w0 * lerp(s.pan[0], s.pan[2], p) + dx / mag,
      cy: s.fy + s.h0 * lerp(s.pan[1], s.pan[3], p) + dy / mag,
      w, h, rot, mag, z, p,
    };
  }

  /** ארבע פינות החלון (המסובב) בפיקסלים של המקור */
  function corners(v) {
    const c = Math.cos(v.rot), sn = Math.sin(v.rot);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
      const x = (a * v.w) / 2, y = (b * v.h) / 2;
      return [v.cx + x * c - y * sn, v.cy + x * sn + y * c];
    });
  }

  /** נקודה במקור -> קואורדינטות החלון (מרכז החלון = 0,0; הצירים לאורך צלעות החלון), בפיקסלים של המקור */
  function local(v, x, y) {
    const c = Math.cos(-v.rot), sn = Math.sin(-v.rot);
    const dx = x - v.cx, dy = y - v.cy;
    return [dx * c - dy * sn, dx * sn + dy * c];
  }

  /**
   * עובר על כל הפריימים ומחזיר:
   * margin = המרווח הקטן ביותר בין החלון לקצה האזור הפעיל (שלילי = שוליים שחורים), box = המלבן שמכיל את כל החלונות,
   * magMax = ההגדלה המקסימלית, keepMargin = המרווח הקטן ביותר בין מלבן keep לקצה החלון (שלילי = נחתך),
   * avoidGap = המרחק הקטן ביותר בין מלבן avoid לחלון (שלילי = נכנס לפריים).
   */
  function plan(s, n) {
    let margin = Infinity, magMax = 0, worst = 0, keepMargin = Infinity, avoidGap = Infinity;
    const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const rc = ([x, y, w, h]) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    for (let i = 0; i < n; i++) {
      const v = view(s, i, n);
      magMax = Math.max(magMax, v.mag);
      for (const [x, y] of corners(v)) {
        const m = Math.min(x - s.active.x0, s.active.x1 - x, y - s.active.y0, s.active.y1 - y);
        if (m < margin) { margin = m; worst = i; }
        box.x0 = Math.min(box.x0, x); box.x1 = Math.max(box.x1, x);
        box.y0 = Math.min(box.y0, y); box.y1 = Math.max(box.y1, y);
      }
      for (const r of s.keep) for (const [x, y] of rc(r)) {
        const [lx, ly] = local(v, x, y);
        keepMargin = Math.min(keepMargin, v.w / 2 - Math.abs(lx), v.h / 2 - Math.abs(ly));
      }
      for (const r of s.avoid) {
        const pts = rc(r).map(([x, y]) => local(v, x, y));
        const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
        // המרחק בין התיבה החוסמת של המלבן לחלון, לאורך הציר שמפריד ביניהם (שלילי אם אין ציר כזה)
        const gx = Math.max(Math.min(...xs) - v.w / 2, -v.w / 2 - Math.max(...xs));
        const gy = Math.max(Math.min(...ys) - v.h / 2, -v.h / 2 - Math.max(...ys));
        avoidGap = Math.min(avoidGap, Math.max(gx, gy));
      }
    }
    return { margin, worst, magMax, box, keepMargin, avoidGap, first: view(s, 0, n), last: view(s, n - 1, n) };
  }

  /**
   * מטריצת ה-CSS של התמונה המוכנה (prep = { x0, y0, kx, ky }: הפינה שלה במקור, ופיקסלים שלה לכל פיקסל מקור) לפריים נתון.
   * q = הגדלה נוספת סביב מרכז הפלט (לשוליים הכרומטיים: כל ערוץ צבע בקנה מידה מעט שונה).
   */
  function matrix(s, v, prep, q) {
    const c = Math.cos(-v.rot) * v.mag * q, sn = Math.sin(-v.rot) * v.mag * q;
    // פלט = R(-rot) * mag * q * (מקור - מרכז החלון) + מרכז הפלט ; מקור = (x0 + u/kx, y0 + v/ky)
    const ox = prep.x0 - v.cx, oy = prep.y0 - v.cy;
    return [c / prep.kx, sn / prep.kx, -sn / prep.ky, c / prep.ky, c * ox - sn * oy + s.W / 2, sn * ox + c * oy + s.H / 2];
  }

  return { SIZE, FPS, hash, unit, resolve, progress, view, corners, local, plan, matrix };
});

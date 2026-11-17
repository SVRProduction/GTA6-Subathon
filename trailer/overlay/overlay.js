/* שכבת הכתוביות והגרפיקה של הטריילר (שקופה, מעל הווידאו).
   הכול נבנה פעם אחת מתוך /__timeline.json, ואחר כך window.seek(frame) קובע שקיפות ו-transform לכל רכיב.
   seek היא פונקציה טהורה של מספר הפריים: בלי טיימרים, בלי transition, בלי מצב שנשאר מפריים קודם.
   window.captionBoxes(frame) מחזיר את תיבות הטקסט הנראות בפריים (לבדיקת האזור הבטוח), window.overlayInfo() נתונים לבדיקה. */
(async function main() {
  'use strict';

  // ── נתונים ──────────────────────────────────────────────────────────────────────────────
  const ASPECT = new URLSearchParams(location.search).get('aspect') === '9x16' ? '9x16' : '16x9';
  const V = ASPECT === '9x16'; // לאורך
  const T = await (await fetch('/__timeline.json')).json();
  let TAPS = [];
  let tapsStatus = 'missing';
  try {
    const r = await fetch('/__work/scenes/phone/taps.json'); // עדיין לא קיים בזמן הבנייה: 404 זה בסדר
    if (r.ok) {
      const j = await r.json();
      if (Array.isArray(j)) { TAPS = j; tapsStatus = 'loaded'; } else tapsStatus = 'invalid';
    }
  } catch (e) { tapsStatus = 'missing'; }

  const FPB = (T.fps * 60) / T.bpm; // 14.0625 פריימים לפעימה
  const fob = (beat) => Math.round(beat * FPB); // זהה ל-lib/timeline.cjs
  const TOTAL = fob(T.bars * 4);
  const L = T.layout[ASPECT];
  const W = L.w, H = L.h, S = L.safe, PH = L.phone;
  const scenes = T.scenes.map((s) => ({ ...s, start: fob(s.beat), end: fob(s.beat + s.beats) }));
  const scene = (name) => scenes.find((s) => s.name === name);
  const sceneAt = (f) => scenes.find((s) => f >= s.start && f < s.end);

  // שני חילופי המראה בתוך tod: שליש ושני שליש של הסצנה (56 ו-113 פריימים מתחילתה = 787 ו-844), כמו ב-scenes/tod.cjs
  const tod = scene('tod');
  const LOOKS = tod ? [tod.start + Math.round((tod.end - tod.start) / 3), tod.start + Math.round(((tod.end - tod.start) * 2) / 3)] : [];
  // פעימה 56 מתעגלת ל-788 אבל המראה מתחלף ב-787: כתובית שמתחילה/נגמרת פריים אחד ליד חילוף מראה נצמדת אליו
  const snap = (fr) => { for (const c of LOOKS) if (Math.abs(fr - c) <= 1) return c; return fr; };
  // הבזק לבן בדיוק על הפריים הראשון של הסצנות האלה (ועל שני חילופי המראה)
  const FLASH_SCENES = ['gta2', 'gta3', 'map-title', 'map-journey', 'gta4', 'gta5', 'gta6', 'gta7', 'endcard'];
  const CUTS = [...FLASH_SCENES.map((n) => scene(n)).filter(Boolean).map((s) => s.start), ...LOOKS].sort((a, b) => a - b);
  // תג "הדמיה" רק בסצנות האלה
  const DEMO_SCENES = ['map-journey', 'milestone', 'fx-death', 'fx-arrest', 'fx-fail', 'poll', 'tod', 'phone-home', 'phone-story', 'phone-reel', 'phone-stats'];

  // ── גופנים ותמונות: הכול נטען לפני שמודדים ובונים ──────────────────────────────────────────
  const DISPLAY = "'Karantina', 'Rubik', sans-serif";
  const BODY = "'Rubik', sans-serif";
  const F = {
    disp: { family: DISPLAY, weight: 700 },
    b9: { family: BODY, weight: 900 },
    b8: { family: BODY, weight: 800 },
    b6: { family: BODY, weight: 600 },
  };
  const SAMPLE = "הסאבתון של עודד 19.11 · GTA 6 kick.com/odedsvr ב-Kick והצ'אט";
  const FONT_SPECS = ['700 100px Karantina', '600 40px Rubik', '800 40px Rubik', '900 40px Rubik'];
  await Promise.all(FONT_SPECS.map((f) => document.fonts.load(f, SAMPLE)));
  await document.fonts.ready;
  const fontsOk = FONT_SPECS.every((f) => document.fonts.check(f, SAMPLE));
  const LOGO_SRC = '/icons/oded-512.png';
  const logoImg = new Image();
  logoImg.src = LOGO_SRC;
  let logoOk = true;
  try { await logoImg.decode(); } catch (e) { logoOk = false; }

  // ── עזרים ───────────────────────────────────────────────────────────────────────────────
  const stage = document.getElementById('stage');
  stage.style.width = `${W}px`;
  stage.style.height = `${H}px`;
  const CX = V ? 520 : 960; // מרכז התוכן: לאורך, 20 פיקסלים שמאלה מהמרכז כדי שרוחב 760 יישאר בתוך האזור הבטוח (עד x=900)
  const CW = V ? 760 : 1728; // הרוחב המרבי של תוכן ממורכז

  const px = (n) => `${Math.round(n * 100) / 100}px`;
  const r3 = (n) => Math.round(n * 1000) / 1000;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = (t) => 1 - Math.pow(1 - clamp(t), 3);
  const easeOutBack = (t, c = 1.3) => { t = clamp(t); return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

  function el(tag, cls, parent, css, vars) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (css) Object.assign(e.style, css);
    if (vars) for (const k of Object.keys(vars)) e.style.setProperty(k, vars[k]);
    (parent || stage).appendChild(e);
    return e;
  }

  // טקסט -> HTML: רצפים של לטינית/ספרות ("GTA 6", "19.11", כתובות) נעטפים ב-span dir=ltr מבודד, כדי שלא יתהפכו בתוך העברית
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const LTR_RE = /[A-Za-z0-9][A-Za-z0-9 .,:\/_-]*[A-Za-z0-9]|[A-Za-z0-9]/g;
  const plain = (s) => esc(s).replace(/·/g, '<span class="sep">·</span>');
  function html(text) {
    let out = '';
    let last = 0;
    text.replace(LTR_RE, (m, i) => { out += `${plain(text.slice(last, i))}<span class="ltr" dir="ltr">${esc(m)}</span>`; last = i + m.length; return m; });
    return out + plain(text.slice(last));
  }
  // מילים לשבירת שורות: רצף לטיני עם רווח ("GTA 6") נשאר מילה אחת
  function words(text) {
    return text.replace(LTR_RE, (m) => m.replace(/ /g, '\u0001')).split(' ').filter(Boolean).map((w) => w.replace(/\u0001/g, ' '));
  }
  const meas = el('span', 'measure');
  function unitW(text, font) { // רוחב הטקסט בגודל 100px
    meas.style.fontFamily = font.family;
    meas.style.fontWeight = font.weight;
    meas.style.letterSpacing = font.ls || 'normal';
    meas.innerHTML = html(text);
    return meas.getBoundingClientRect().width;
  }
  function partitions(ws, k) {
    const out = [];
    (function rec(start, left, acc) {
      if (left === 1) { out.push([...acc, ws.slice(start)]); return; }
      for (let i = start + 1; i <= ws.length - (left - 1); i++) rec(i, left - 1, [...acc, ws.slice(start, i)]);
    })(0, k, []);
    return out;
  }
  const trimSep = (g) => { g = g.slice(); while (g.length && g[0] === '·') g.shift(); while (g.length && g[g.length - 1] === '·') g.pop(); return g; };
  /**
   * מתאים טקסט לרוחב: בוחר חלוקה מאוזנת לשורות וגודל גופן.
   * o: { font, cap (מספר או מערך לכל שורה), maxW, minLines=1, maxLines=1, justify=false (כל שורה ממלאת את הרוחב בגודל משלה), lineH, maxH }
   */
  function fit(text, o) {
    const ws = words(text);
    const minL = Math.min(o.minLines || 1, ws.length);
    const maxL = Math.min(Math.max(o.maxLines || 1, minL), ws.length);
    const capOf = (i) => (Array.isArray(o.cap) ? o.cap[Math.min(i, o.cap.length - 1)] : o.cap);
    const maxW = o.maxW * 0.995;
    let best = null;
    for (let k = minL; k <= maxL; k++) {
      let cand = null;
      let parts = partitions(ws, k);
      // אם אפשר לשבור בדיוק על המפרידים ("19.11 · יום חמישי" -> "19.11" / "יום חמישי"), שוברים רק שם
      const atSeps = parts.filter((p) => p.every((g, i) => i === 0 || g[0] === '·' || p[i - 1][p[i - 1].length - 1] === '·'));
      if (k > 1 && atSeps.length) parts = atSeps;
      for (const p of parts) {
        const lines = p.map(trimSep).filter((g) => g.length).map((g) => g.join(' '));
        if (lines.length !== k) continue;
        const us = lines.map((l) => unitW(l, o.font));
        const mu = Math.max(...us);
        if (!cand || mu < cand.mu) cand = { lines, us, mu, k };
      }
      if (!cand) continue;
      if (o.justify) cand.sizes = cand.us.map((u, i) => Math.min(capOf(i), (maxW / u) * 100));
      else {
        let size = Math.min(capOf(0), (maxW / cand.mu) * 100);
        if (o.maxH) size = Math.min(size, o.maxH / (k * (o.lineH || 1)));
        cand.sizes = cand.us.map(() => size);
      }
      cand.size = Math.min(...cand.sizes);
      if (!best || cand.size > best.size * 1.15) best = cand; // עוד שורה רק אם היא מגדילה את הטקסט באופן ניכר
    }
    best.w = Math.max(...best.us.map((u, i) => (u * best.sizes[i]) / 100));
    return best;
  }
  // קו מתאר עבה ועגול מסביב לטקסט (טבעת של צלליות) + צל רך: לטקסט גדול שיושב ישר על הווידאו
  function outline(size, k = 0.026) {
    const r = Math.max(3, size * k);
    const sh = [];
    for (const [rad, n] of [[r, 28], [r * 0.55, 14]]) {
      for (let i = 0; i < n; i++) { const t = (i / n) * Math.PI * 2; sh.push(`${(Math.cos(t) * rad).toFixed(2)}px ${(Math.sin(t) * rad).toFixed(2)}px 0 #14110a`); }
    }
    sh.push(`0 ${px(r * 1.7)} 0 #14110a`, `0 ${px(r * 2.6)} ${px(r * 4)} rgba(0,0,0,0.55)`);
    return sh.join(', ');
  }
  /** ממלא רכיב טקסט בשורות (כל שורה בגודל שלה). opts.outline = עובי יחסי לקו מתאר */
  function setText(node, fr, font, opts = {}) {
    node.classList.add('txt');
    node.style.fontFamily = font.family;
    node.style.fontWeight = font.weight;
    if (font.ls) node.style.letterSpacing = font.ls;
    node.innerHTML = fr.lines.map((l, i) => `<span class="ln" style="font-size:${px(fr.sizes[i])}${opts.outline ? `;text-shadow:${outline(fr.sizes[i], opts.outline)}` : ''}">${opts.html ? opts.html(l) : html(l)}</span>`).join('');
    return node;
  }
  function logoEl(parent, size, border) {
    const d = el('div', 'logo', parent, { width: px(size), height: px(size), borderWidth: px(border) });
    if (logoOk) { const i = document.createElement('img'); i.src = LOGO_SRC; i.alt = ''; d.appendChild(i); }
    return d;
  }

  // ── תנועה: כל פונקציה מחזירה מצב { o, s, x, y, settled } לפריים f, או null כשהרכיב לא על המסך ──────────
  // פאנץ': נכנס גדול ומתכווץ ל-1 תוך inN פריימים (עם חריגה קלה), נשאר, ויוצא מהר ב-outN הפריימים האחרונים
  function punch(f, a, b, o = {}) {
    if (f < a || f >= b) return null;
    const inN = o.inN ?? 4, outN = o.outN ?? 3, from = o.from ?? 1.5;
    const k = f - a, r = b - f;
    const st = { o: 1, s: 1, x: 0, y: 0, settled: true };
    if (k < inN) { st.s = from - (from - 1) * easeOutBack(k / inN); st.o = k === 0 ? 0.6 : k === 1 ? 0.9 : 1; st.settled = false; }
    if (outN && r <= outN) { const t = (outN - r + 1) / (outN + 1); st.s *= 1 + 0.1 * t; st.o *= 1 - t; st.settled = false; }
    return st;
  }
  // החלקה: נכנס ב-inN פריימים (שקיפות + הזזה), יוצא ב-outN האחרונים
  function slide(f, a, b, o = {}) {
    if (f < a || f >= b) return null;
    const inN = o.inN ?? 5, outN = o.outN ?? 4, dx = o.dx ?? 0, dy = o.dy ?? 36;
    const k = f - a, r = b - f;
    const st = { o: 1, s: 1, x: 0, y: 0, settled: true };
    if (k < inN - 1) { const e = easeOut((k + 1) / inN); st.o = e; st.x = dx * (1 - e); st.y = dy * (1 - e); st.settled = false; }
    if (outN && r <= outN) { const t = r / (outN + 1); st.o *= t; st.y += (o.outDy ?? dy * 0.4) * (1 - t); st.settled = false; }
    return st;
  }
  // קפיצה: גדל מקטן ל-1 עם חריגה (ללוגו ולתגים)
  function pop(f, a, b, o = {}) {
    if (f < a || f >= b) return null;
    const inN = o.inN ?? 7, outN = o.outN ?? 3, from = o.from ?? 0.25;
    const k = f - a, r = b - f;
    const st = { o: 1, s: 1, x: 0, y: 0, settled: true };
    if (k < inN) { st.s = from + (1 - from) * easeOutBack((k + 1) / (inN + 1), 2.2); st.o = clamp((k + 1) / 2.5); st.settled = false; }
    if (outN && r <= outN) { const t = r / (outN + 1); st.o *= t; st.s *= 0.9 + 0.1 * t; st.settled = false; }
    return st;
  }
  const fade = (f, a, b, inN = 6, outN = 3) => {
    if (f < a || f >= b) return null;
    let o = clamp((f - a + 1) / inN);
    if (outN && b - f <= outN) o *= (b - f) / (outN + 1);
    return { o, s: 1, x: 0, y: 0, settled: o === 1 };
  };

  const items = []; // { el, fn } או { custom }
  const texts = []; // { el, text, kind, st(f) } – ל-captionBoxes
  const anim = (node, fn) => { items.push({ el: node, fn }); return fn; };
  const custom = (fn) => items.push({ custom: fn });
  const reg = (node, text, kind, st) => texts.push({ el: node, text, kind, st });
  function apply(node, st) {
    const s = node.style;
    if (!st || st.o <= 0.001) { s.visibility = 'hidden'; s.opacity = '0'; s.transform = 'none'; return; }
    s.visibility = 'visible';
    s.opacity = String(r3(st.o));
    s.transform = st.x || st.y || st.s !== 1 ? `translate(${r3(st.x)}px, ${r3(st.y)}px) scale(${r3(st.s)})` : 'none';
  }
  const END = TOTAL + 10000; // "עד הסוף, בלי יציאה"

  // ── 1. רקעים כהים (scrim) נבנים ראשונים = הכי למטה ───────────────────────────────────────────
  const caps = T.captions.map((c) => ({ ...c, a: snap(fob(c.beat)), b: snap(fob(c.beat + c.beats)) }));
  for (const c of caps) c.scene = sceneAt(c.a);
  const TITLE_CY = V ? 835 : 540;
  const SLAM_CY = V ? 860 : 540;
  for (const c of caps) {
    if (c.style === 'title') {
      const sc = el('div', 'fill scrim-title', stage, null, { '--cx': `${(CX / W) * 100}%`, '--cy': `${(TITLE_CY / H) * 100}%` });
      anim(sc, (f) => fade(f, c.a, c.b, 6, 3));
    } else if (c.style === 'slam') {
      const sc = el('div', 'fill scrim-slam', stage, null, { '--cx': `${(CX / W) * 100}%`, '--cy': `${(SLAM_CY / H) * 100}%` });
      anim(sc, (f) => fade(f, c.a, c.b, 3, 3));
    }
  }
  const E = T.endcard;
  const endA = E ? fob(E.beat) : END;
  if (E) {
    const sc = el('div', 'fill scrim-end', stage, null, { '--cx': `${(CX / W) * 100}%`, '--cy': V ? '44%' : '46%' });
    anim(sc, (f) => fade(f, endA, END, 6, 0));
  }

  // ── 2. הבזק לבן בחיתוכים ──────────────────────────────────────────────────────────────────
  const flash = el('div', 'fill flash');
  const FLASH_N = 4;
  const flashAt = (f) => { for (const c of CUTS) { const k = f - c; if (k >= 0 && k < FLASH_N) return 0.8 * Math.pow(1 - k / FLASH_N, 1.6); } return 0; };
  anim(flash, (f) => { const o = flashAt(f); return o ? { o, s: 1, x: 0, y: 0 } : null; });

  // ── 3. טלפון: מסגרת (רק ב-16x9, שם הווידאו של הטלפון מונח במלבן layout.phone) ולחיצות ─────────────
  const phoneScenes = scenes.filter((s) => s.kind === 'phone');
  const phA = phoneScenes.length ? Math.min(...phoneScenes.map((s) => s.start)) : END;
  const phB = phoneScenes.length ? Math.max(...phoneScenes.map((s) => s.end)) : END;
  const PSCALE = PH.w / 1080;
  if (!V && phoneScenes.length) {
    const TH = 14; // עובי המסגרת
    const o = { x: PH.x - TH, y: PH.y - TH, w: PH.w + 2 * TH, h: PH.h + 2 * TH, r: 42 };
    // הפתח חופף פיקסל אחד לווידאו מכל צד, והפינות שלו (רדיוס 38) מכסות את הפינות הישרות של הווידאו
    const i = { x: PH.x + 1, y: PH.y + 1, w: PH.w - 2, h: PH.h - 2, r: 38 };
    const rr = (q) => `M${q.x + q.r},${q.y} h${q.w - 2 * q.r} a${q.r},${q.r} 0 0 1 ${q.r},${q.r} v${q.h - 2 * q.r} a${q.r},${q.r} 0 0 1 ${-q.r},${q.r} h${-(q.w - 2 * q.r)} a${q.r},${q.r} 0 0 1 ${-q.r},${-q.r} v${-(q.h - 2 * q.r)} a${q.r},${q.r} 0 0 1 ${q.r},${-q.r} z`;
    const g = el('div', 'fill bezel');
    el('div', 'bezel-shadow', g, { left: px(o.x), top: px(o.y), width: px(o.w), height: px(o.h), borderRadius: px(o.r) });
    const nw = 118, nh = 15, nx = PH.x + PH.w / 2 - nw / 2, ny = PH.y;
    g.insertAdjacentHTML('beforeend', `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="position:absolute;left:0;top:0">
      <rect x="${o.x + o.w - 1}" y="${o.y + 190}" width="5" height="92" rx="2.5" fill="#0a0d15"/>
      <rect x="${o.x - 4}" y="${o.y + 170}" width="5" height="52" rx="2.5" fill="#0a0d15"/>
      <rect x="${o.x - 4}" y="${o.y + 240}" width="5" height="52" rx="2.5" fill="#0a0d15"/>
      <path d="${rr(o)} ${rr(i)}" fill="#0c1019" fill-rule="evenodd"/>
      <path d="${rr({ x: o.x + 1.25, y: o.y + 1.25, w: o.w - 2.5, h: o.h - 2.5, r: o.r - 1.25 })}" fill="none" stroke="rgba(243,239,230,0.26)" stroke-width="2.5"/>
      <path d="${rr({ x: i.x - 0.75, y: i.y - 0.75, w: i.w + 1.5, h: i.h + 1.5, r: i.r + 0.75 })}" fill="none" stroke="rgba(0,0,0,0.75)" stroke-width="1.5"/>
      <path d="M${nx},${ny} h${nw} v${nh - 9} a9,9 0 0 1 -9,9 h${-(nw - 18)} a9,9 0 0 1 -9,-9 z" fill="#0c1019"/>
      <circle cx="${nx + nw - 22}" cy="${ny + 5}" r="3.2" fill="#232a3a"/>
    </svg>`);
    anim(g, (f) => (f >= phA && f < phB ? { o: 1, s: 1, x: 0, y: 0 } : null));
  }
  const TAP_N = 12;
  let tapCount = 0;
  for (const t of TAPS) {
    const sc = t && scene(t.scene);
    if (!sc || !Number.isFinite(t.frame) || !Number.isFinite(t.x) || !Number.isFinite(t.y)) continue;
    const a = sc.start + Math.round(t.frame);
    if (a < sc.start || a >= sc.end) continue;
    tapCount++;
    const k = PSCALE; // 16x9: חצי גודל
    const node = el('div', 'tap', stage, { left: px(PH.x + t.x * PSCALE), top: px(PH.y + t.y * PSCALE) });
    const ring = el('i', 'ring', node);
    const dot = el('i', 'dotc', node);
    custom((f) => {
      const n = f - a;
      if (n < 0 || n >= TAP_N || f >= sc.end) { node.style.visibility = 'hidden'; return; }
      node.style.visibility = 'visible';
      const p = n / (TAP_N - 1);
      const rr = lerp(30, 112, easeOut(p)) * k, bw = Math.max(2, lerp(12, 3, p) * k);
      Object.assign(ring.style, { width: px(rr * 2), height: px(rr * 2), left: px(-rr), top: px(-rr), borderWidth: px(bw), opacity: String(r3(Math.pow(1 - p, 1.3))) });
      const dr = 27 * k * (n === 0 ? 1.25 : n === 1 ? 1.1 : lerp(1, 0.8, p));
      Object.assign(dot.style, { width: px(dr * 2), height: px(dr * 2), left: px(-dr), top: px(-dr), opacity: String(r3(n < 7 ? 1 : 1 - (n - 6) / (TAP_N - 6))) });
    });
  }

  // ── 4. כתוביות ───────────────────────────────────────────────────────────────────────────
  // slam: ענק, במרכז, מעל תמונות GTA
  function buildSlam(c) {
    const P = V ? { cap: 560, maxW: 730, maxLines: 2, from: 1.3 } : { cap: 540, maxW: 1560, maxLines: 1, from: 1.5 };
    const fr = fit(c.text, { font: F.disp, cap: P.cap, maxW: P.maxW, maxLines: P.maxLines, justify: V, lineH: 0.84 });
    const box = el('div', 'box', stage, { left: px(CX - CW / 2), width: px(CW), top: px(SLAM_CY - 500), height: '1000px' });
    const t = setText(el('div', 'slam', box), fr, F.disp, { outline: 0.024 });
    const cuts = scenes.map((s) => s.start).filter((s) => s > c.a && s < c.b); // חיתוך באמצע הכתובית: דחיפה קטנה על הפעימה
    const fn = anim(t, (f) => {
      const st = punch(f, c.a, c.b, { from: P.from });
      if (st) for (const q of cuts) { const k = f - q; if (k >= 0 && k < 5) { st.s *= 1 + 0.07 * Math.pow(1 - k / 5, 2); st.settled = false; } }
      return st;
    });
    reg(t, c.text, 'slam', fn);
  }

  // title: לוגו -> שם -> שורת משנה
  function buildTitle(c) {
    const P = V
      ? { logo: 236, border: 9, cap: 330, maxW: 730, lines: 2, justify: true, subCap: 58, subMaxW: 640, subLines: 2, subPad: [14, 34], gap: 22, subGap: 26 }
      : { logo: 210, border: 8, cap: 300, maxW: 1500, lines: 1, justify: false, subCap: 54, subMaxW: 1300, subLines: 1, subPad: [12, 40], gap: 14, subGap: 22 };
    const box = el('div', 'box', stage, { left: px(CX - CW / 2), width: px(CW), top: px(TITLE_CY - 700), height: '1400px' });
    const tA = c.logo ? fob(c.beat + 1) : c.a; // הלוגו על הפעימה הראשונה, השם על הבאה
    const sA = fob(c.subBeat ?? c.beat + 3);
    if (c.logo) {
      const lg = logoEl(box, P.logo, P.border);
      lg.style.marginBottom = px(P.gap);
      anim(lg, (f) => pop(f, c.a, c.b));
    }
    const fr = fit(c.text, { font: F.disp, cap: P.cap, maxW: P.maxW, minLines: P.lines, maxLines: P.lines, justify: P.justify, lineH: 0.86 });
    const t = setText(el('div', 'title', box), fr, F.disp, { outline: 0.02 });
    reg(t, c.text, 'title', anim(t, (f) => punch(f, tA, c.b, { from: V ? 1.35 : 1.5 })));
    if (c.sub) {
      const sfr = fit(c.sub, { font: F.b8, cap: P.subCap, maxW: P.subMaxW, maxLines: P.subLines, lineH: 1.15 });
      const sp = el('div', 'subpill', box, { padding: `${P.subPad[0]}px ${P.subPad[1]}px`, marginTop: px(P.subGap), borderRadius: sfr.k > 1 ? '30px' : '999px' });
      const st = setText(el('div', '', sp), sfr, F.b8);
      reg(st, c.sub, 'title-sub', anim(sp, (f) => slide(f, sA, c.b, { dy: 34, outN: 3 })));
    }
  }

  // lower: לוחית כהה בתחתית (ושורת משנה צהובה שקופצת ב-subBeat)
  function buildLower(c) {
    const ovr = (LOWER_OVR[ASPECT] || {})[c.scene ? c.scene.name : ''] || {};
    const P = { ...(V ? { cap: 80, padX: 34, padY: 20, bar: 16, bottom: S.y1 - 6, maxLines: 2, subK: 0.8 } : { cap: 64, padX: 42, padY: 17, bar: 14, bottom: S.y1 - 14, maxLines: 1, subK: 0.8 }), ...ovr };
    const left = P.align === 'left'; // צמוד לשמאל האזור הבטוח (כשבצד ימין יש משהו בצילום)
    const wrap = el('div', 'row', stage, { left: px(left ? S.x0 : CX - CW / 2), width: px(left ? S.x1 - S.x0 : CW), bottom: px(H - P.bottom), alignItems: left ? 'flex-end' : 'center' });
    const plate = el('div', 'plate lower', wrap, { padding: `${P.padY}px ${P.padX + P.bar}px ${P.padY}px ${P.padX}px` }, { '--bar': `${P.bar}px` });
    const fr = fit(c.text, { font: F.b9, cap: P.cap, maxW: (P.maxPlateW || CW) - 2 * P.padX - P.bar, maxLines: P.maxLines, lineH: 1.14 });
    const t = setText(el('div', '', plate), fr, F.b9);
    const wfn = anim(wrap, (f) => slide(f, c.a, c.b, { dy: 44 }));
    if (!c.sub) { reg(t, c.text, 'lower', wfn); return; }
    const sA = fob(c.subBeat ?? c.beat + c.beats / 2);
    const sfr = fit(c.sub, { font: F.b9, cap: fr.size * P.subK, maxW: CW - 2 * P.padX, lineH: 1.14 });
    const sub = el('div', 'lsub', wrap, { padding: `${Math.round(P.padY * 0.6)}px ${P.padX}px`, marginTop: '-10px', position: 'relative', zIndex: '1' });
    const stx = setText(el('div', '', sub), sfr, F.b9);
    const shift = sub.getBoundingClientRect().height - 10; // עד ששורת המשנה מגיעה, הלוחית הראשית יושבת למטה
    const pfn = anim(plate, (f) => {
      if (f < c.a || f >= c.b) return null;
      const k = f - sA;
      const y = k < 0 ? shift : k < 5 ? shift * (1 - easeOutBack((k + 1) / 5, 1.6)) : 0;
      return { o: 1, s: 1, x: 0, y, settled: k < 0 || k >= 5 };
    });
    const sfn = anim(sub, (f) => pop(f, sA, c.b, { inN: 5, outN: 0, from: 0.6 }));
    const both = (f) => { const w = wfn(f), p = pfn(f); return w && p ? { o: w.o, settled: w.settled && p.settled } : null; };
    reg(t, c.text, 'lower', both);
    reg(stx, c.sub, 'lower-sub', (f) => { const w = wfn(f), s = sfn(f); return w && s ? { o: w.o * s.o, settled: w.settled && s.settled } : null; });
  }
  // התאמות לסצנה מסוימת (מה שכבר יושב שם בצילום)
  const LOWER_OVR = {
    '9x16': {
      poll: { maxLines: 1 }, // סיכת הסקר ב-y≈1250: שורה אחת נמוכה, מתחתיה
      // הטלפון ממלא את כל הפריים, אז הלוחית יושבת איפה שהמסך של הטלפון פנוי (לפי work/scenes/phone/*.mkv):
      'phone-story': { bottom: 1030 }, // על תמונת המפה, מעל הכותרת והטקסט של הסטורי (y 1065 ומטה)
      'phone-reel': { bottom: 1244 }, // ברווח הכהה בין הקליפ (עד y 945) לכותרת שלו (y 1340)
      'phone-stats': { bottom: 838, align: 'left', cap: 66, maxPlateW: 640 }, // בחלק הריק של הכרטיס "כמה פעמים עודד מת", משמאל למספר
    },
  };

  // kicker: שורה קטנה קבועה למעלה. ב-16x9 בצד ימין (במרכז יושבים הגולגולת ותג ה-WANTED), לאורך במרכז האזור הבטוח
  let kickerH = 0;
  const kickers = [];
  function buildKicker(c) {
    const P = V ? { cap: 46, padX: 26, padY: 12, dot: 16, gap: 14, bw: 3 } : { cap: 36, padX: 24, padY: 10, dot: 14, gap: 13, bw: 3 };
    const safeW = S.x1 - S.x0;
    const maxW = (V ? safeW : 600) - 2 * P.padX - P.dot - P.gap - 2 * P.bw;
    const wrap = el('div', 'row', stage, { left: px(S.x0), width: px(safeW), top: px(S.y0), alignItems: V ? 'center' : 'flex-start' });
    const pill = el('div', 'kicker', wrap, { padding: `${P.padY}px ${P.padX}px`, borderWidth: px(P.bw) });
    const dot = el('i', 'dot', pill, { width: px(P.dot), height: px(P.dot), marginLeft: px(P.gap) });
    const fr = fit(c.text, { font: F.b8, cap: P.cap, maxW, lineH: 1.15 });
    const t = setText(el('div', '', pill), fr, F.b8);
    kickerH = Math.max(kickerH, pill.getBoundingClientRect().height);
    kickers.push(c);
    const fn = anim(wrap, (f) => slide(f, c.a, c.b, { dy: -30, outN: 3 }));
    custom((f) => { // הנקודה הוורודה פועמת על כל פעימה
      const ph = (f - c.a) % FPB;
      dot.style.transform = f >= c.a && f < c.b && ph < 5 ? `scale(${r3(1 + 0.4 * Math.pow(1 - ph / 5, 2))})` : 'none';
    });
    reg(t, c.text, 'kicker', fn);
  }

  // label: מילה גדולה על הפעימה, בתחתית (מתחת למה שקורה בצילום)
  function buildLabel(c, idx) {
    const P = V ? { cap: 220, maxW: 590, padX: 44, padY: 14, bottom: S.y1 - 16, bw: 7, r: 20 } : { cap: 170, maxW: 1100, padX: 50, padY: 12, bottom: S.y1 - 22, bw: 7, r: 18 };
    const wrap = el('div', 'row', stage, { left: px(CX - CW / 2), width: px(CW), bottom: px(H - P.bottom), transformOrigin: '50% 55%' });
    const plate = el('div', 'label', wrap, { padding: `${P.padY}px ${P.padX}px`, borderWidth: px(P.bw), borderRadius: px(P.r), transform: `rotate(${idx % 2 ? 1.6 : -1.6}deg)` });
    const fr = fit(c.text, { font: F.disp, cap: P.cap, maxW: P.maxW, lineH: 0.86 });
    const t = setText(el('div', '', plate), fr, F.disp);
    reg(t, c.text, 'label', anim(wrap, (f) => punch(f, c.a, c.b, { from: 1.5, outN: 2 })));
  }

  // כתובית של סצנת טלפון ב-16x9: טקסט גדול בצד הימני הפנוי, כל שורה בלוחית משלה (האחרונה צהובה)
  function buildPhoneSide(c) {
    const x0 = PH.x + PH.w + 60, x1 = S.x1, w = x1 - x0;
    const P = { cap: 215, padX: 34, padY: 9, gap: 10 };
    const fr = fit(c.text, { font: F.disp, cap: P.cap, maxW: w - 2 * P.padX - 40, minLines: 2, maxLines: 3, lineH: 0.86 });
    const box = el('div', 'box', stage, { left: px(x0), width: px(w), top: px(H / 2 - 500), height: '1000px' });
    const rot = el('div', 'row', box, { transform: 'rotate(-2deg)' });
    const fns = [];
    fr.lines.forEach((line, i) => {
      const last = i === fr.lines.length - 1;
      const p = el('div', `pcap ${last ? 'gold' : 'dark'}`, rot, { padding: `${P.padY}px ${P.padX}px`, borderRadius: '16px', marginTop: i ? px(P.gap) : '0', position: 'relative', zIndex: String(i + 1) });
      const t = setText(el('div', '', p), { lines: [line], sizes: [fr.sizes[i]] }, F.disp);
      const fn = anim(p, (f) => punch(f, c.a + i * 3, c.b, { from: 1.45, outN: 3 }));
      fns.push({ t, fn });
    });
    // תיבה אחת לכל הכתובית (לבדיקת האזור הבטוח): הבלוק כולו
    reg(rot, c.text, 'lower', (f) => { const sts = fns.map((q) => q.fn(f)); if (!sts[0]) return null; return { o: sts[0].o, settled: sts.every((q) => q && q.settled) }; });
  }

  let labelIdx = 0;
  for (const c of caps) {
    const isPhone = c.scene && c.scene.kind === 'phone';
    if (c.style === 'slam') buildSlam(c);
    else if (c.style === 'title') buildTitle(c);
    else if (c.style === 'kicker') buildKicker(c);
    else if (c.style === 'label') buildLabel(c, labelIdx++);
    else if (c.style === 'lower') { if (isPhone && !V) buildPhoneSide(c); else buildLower(c); }
  }

  // ── 5. מסך הסיום ─────────────────────────────────────────────────────────────────────────
  function buildTicker(text) {
    const K = V ? { h: 76, font: 38, tagFont: 36, tagPad: 24, v: 2.4, bottom: S.y1, lead: 26, gap: 22, fadeW: 60 } : { h: 78, font: 40, tagFont: 40, tagPad: 34, v: 3, bottom: S.y1 - 6, lead: 34, gap: 28, fadeW: 110 };
    const x0 = S.x0, x1 = S.x1, top = K.bottom - K.h;
    const bar = el('div', 'ticker', stage, { left: px(x0), width: px(x1 - x0), top: px(top), height: px(K.h) });
    // המחרוזת מתחילה ב"מבזק ·": החלק הראשון הוא התג האדום, השאר נגלל
    const segs = text.split('·').map((s) => s.trim()).filter(Boolean);
    const tagText = segs.length > 1 ? segs.shift() : 'מבזק';
    const tag = el('div', 'tk-tag', bar, { fontSize: px(K.tagFont), padding: `0 ${K.tagPad}px`, zIndex: '2' });
    const tagT = el('span', '', tag);
    tagT.innerHTML = html(tagText);
    const tagW = tag.getBoundingClientRect().width;
    const clipW = x1 - x0 - tagW;
    const clip = el('div', 'tk-clip', bar, { width: px(clipW), webkitMaskImage: `linear-gradient(to right, transparent 0, #000 ${K.fadeW}px)`, maskImage: `linear-gradient(to right, transparent 0, #000 ${K.fadeW}px)` });
    const track = el('div', 'tk-track', clip);
    const cycle = () => segs.map((s) => `<span class="tk-seg" style="font-size:${px(K.font)};margin:0 ${px(K.gap)}">${html(s)}</span><i class="tk-dia"></i>`).join('');
    track.innerHTML = cycle();
    const cycleW = track.getBoundingClientRect().width;
    // עברית נגללת משמאל לימין. בפריים האחרון מחזור אחד מתחיל בדיוק ליד התג (פוסטר נקי); לפניו מחזורים שכבר עברו ימינה
    const dur = TOTAL - endA;
    const nRight = Math.ceil((K.lead + K.v * dur) / cycleW) + 1;
    const nLeft = Math.ceil(clipW / cycleW) + 1;
    track.innerHTML = Array.from({ length: nRight + nLeft }, cycle).join('');
    const base = clipW - K.lead + K.gap - (nRight + nLeft) * cycleW + nRight * cycleW; // left של המסילה בפריים האחרון: המחזור ה-nRight מימין מתחיל lead פיקסלים משמאל לתג
    custom((f) => { track.style.transform = `translateX(${r3(base - K.v * (TOTAL - 1 - f))}px)`; });
    const fn = anim(bar, (f) => slide(f, endA + 2, END, { dy: 46, inN: 5, outN: 0 }));
    reg(tagT, tagText, 'ticker-tag', fn);
    reg(clip, segs.join(' · '), 'ticker', fn);
    return { top };
  }

  function endColumn(k, top, avail) {
    const Z = V
      ? { row: false, logo: 168, border: 7, headGap: 8, titleCap: 190, titleMaxW: 740, gameFont: 100, gamePad: [1, 30], gameMt: 18, dateCap: [330, 196], dateMaxW: 720, dateLines: 2, dateMt: 14, linkCap: 70, linkMaxW: CW - 2 * 30 - 10, linkPad: [12, 30], linkMt: 12, urlCap: 34, urlMaxW: CW - 2 * 18 - 4, urlPad: [8, 18], urlMt: 12 }
      : { row: true, logo: 150, border: 6, headGap: 30, titleCap: 190, titleMaxW: 1200, gameFont: 96, gamePad: [1, 34], gameMt: 20, dateCap: [330], dateMaxW: 1560, dateLines: 1, dateMt: 12, linkCap: 76, linkMaxW: 1400, linkPad: [13, 46], linkMt: 12, urlCap: 34, urlMaxW: 1400, urlPad: [9, 26], urlMt: 14 };
    const col = el('div', 'endcol', stage, { left: px(CX - CW / 2), width: px(CW), top: px(top), height: px(avail) });
    const inner = el('div', 'row', col);
    const parts = [];
    for (const ln of E.lines) {
      const a = fob(ln.beat);
      if (ln.style === 'title') {
        const head = el('div', 'endhead', inner, { flexDirection: Z.row ? 'row' : 'column' });
        if (ln.logo) {
          const lg = logoEl(head, Z.logo * k, Z.border * k);
          lg.style[Z.row ? 'marginLeft' : 'marginBottom'] = px(Z.headGap * k);
          parts.push({ el: lg, fn: (f) => pop(f, a, END, { outN: 0 }) });
        }
        const fr = fit(ln.text, { font: F.disp, cap: Z.titleCap * k, maxW: Z.titleMaxW, lineH: 0.86 });
        const t = setText(el('div', 'endtitle', head), fr, F.disp, { outline: 0.02 });
        parts.push({ el: t, fn: (f) => punch(f, a + (ln.logo ? 3 : 0), END, { from: 1.4, outN: 0 }), text: ln.text, kind: 'end-title', tel: t });
      } else if (ln.style === 'game') {
        const w = el('div', 'endwrap', inner, { marginTop: px(Z.gameMt * k) });
        const p = el('div', 'endgame', w, { padding: `${Z.gamePad[0] * k}px ${Z.gamePad[1] * k}px`, borderRadius: px(14 * k), transform: 'rotate(-2deg)' });
        const fr = fit(ln.text, { font: F.disp, cap: Z.gameFont * k, maxW: CW, lineH: 0.86 });
        const t = setText(el('div', '', p), fr, { ...F.disp, ls: '0.03em' });
        parts.push({ el: w, fn: (f) => punch(f, a, END, { from: 1.7, outN: 0 }), text: ln.text, kind: 'end-game', tel: t });
      } else if (ln.style === 'date') {
        const fr = fit(ln.text, { font: F.disp, cap: Z.dateCap.map((c) => c * k), maxW: Z.dateMaxW, minLines: Z.dateLines, maxLines: Z.dateLines, justify: true, lineH: 0.84 });
        const t = setText(el('div', 'enddate', inner, { marginTop: px(Z.dateMt * k) }), fr, F.disp, { outline: 0.022 });
        parts.push({ el: t, fn: (f) => punch(f, a, END, { from: 1.5, outN: 0 }), text: ln.text, kind: 'end-date', tel: t });
      } else if (ln.style === 'link') {
        const p = el('div', 'endlink', inner, { padding: `${Z.linkPad[0] * k}px ${Z.linkPad[1] * k}px`, marginTop: px(Z.linkMt * k), borderWidth: px(5 * k) });
        const fr = fit(ln.text, { font: F.b9, cap: Z.linkCap * k, maxW: Z.linkMaxW, lineH: 1.15 });
        // שם הערוץ (אחרי ה-/) בוורוד
        const hl = (s) => { const i = s.lastIndexOf('/'); return i < 0 ? html(s) : `<span class="ltr" dir="ltr">${esc(s.slice(0, i + 1))}<span class="hl">${esc(s.slice(i + 1))}</span></span>`; };
        const t = setText(el('div', '', p), fr, F.b9, { html: hl });
        parts.push({ el: p, fn: (f) => pop(f, a, END, { inN: 5, outN: 0, from: 0.6 }), text: ln.text, kind: 'end-link', tel: t });
      } else {
        const p = el('div', 'endurl', inner, { padding: `${Z.urlPad[0] * k}px ${Z.urlPad[1] * k}px`, marginTop: px(Z.urlMt * k) });
        const fr = fit(ln.text, { font: F.b6, cap: Z.urlCap * Math.max(k, 0.94), maxW: Z.urlMaxW, lineH: 1.2 });
        const t = setText(el('div', '', p), fr, { ...F.b6, ls: '0.01em' });
        parts.push({ el: p, fn: (f) => slide(f, a, END, { dy: 14, inN: 3, outN: 0 }), text: ln.text, kind: 'end-url', tel: t }); // כניסה קצרה: השורה מגיעה מאוחר (פעימה 91)
      }
    }
    return { col, inner, parts };
  }
  let endScale = 1;
  if (E) {
    const tk = buildTicker(E.ticker || '');
    const top = S.y0, avail = tk.top - (V ? 14 : 22) - top;
    let built = null;
    for (let it = 0; it < 6; it++) {
      if (built) built.col.remove();
      built = endColumn(endScale, top, avail);
      const h = built.inner.getBoundingClientRect().height;
      if (h <= avail) break;
      endScale *= (avail / h) * 0.985; // גבוה מדי: מקטינים הכול באותו יחס ובונים שוב
    }
    for (const p of built.parts) { anim(p.el, p.fn); if (p.text) reg(p.tel, p.text, p.kind, p.fn); }
  }

  // ── 6. תג "הדמיה": בפינה עליונה פנויה, לפי הסצנה ───────────────────────────────────────────
  // איפה שהפינה השמאלית-העליונה של האזור הבטוח תפוסה בצילום
  const DEMO_OVR = {
    '16x9': { 'map-journey': { side: 'right' }, milestone: { side: 'right' } }, // בשמאל: ה-HUD של האתר / כפתור הסגירה
    '9x16': {
      'map-journey': { side: 'right' }, // בשמאל: השעון של ה-HUD
      'phone-home': { y: 494 }, // מתחת לשורת הסטוריז (ב-y 250 יושבות הטבעות)
      'phone-story': { y: 494 },
    },
  };
  if (T.demoTag && T.demoTag.text) {
    const P = V ? { font: 26, pad: [6, 18] } : { font: 22, pad: [5, 16] };
    for (const name of DEMO_SCENES) {
      const sc = scene(name);
      if (!sc) continue;
      const withKicker = kickers.some((c) => c.a < sc.end && c.b > sc.start);
      let side = 'left', y = S.y0;
      if (withKicker) { if (V) y = S.y0 + kickerH + 12; } // ה-kicker תופס את הימין (16x9) או את כל השורה העליונה (לאורך)
      const ovr = (DEMO_OVR[ASPECT] || {})[name];
      if (ovr) { side = ovr.side || side; y = ovr.y ?? y; }
      const d = el('div', 'demo', stage, { top: px(y), [side]: px(side === 'left' ? S.x0 : W - S.x1), fontSize: px(P.font), padding: `${P.pad[0]}px ${P.pad[1]}px` });
      const t = el('span', '', d);
      t.innerHTML = html(T.demoTag.text);
      const fn = anim(d, (f) => (f >= sc.start && f < sc.end ? { o: 1, s: 1, x: 0, y: 0, settled: true } : null));
      reg(t, T.demoTag.text, 'demo', fn);
    }
  }

  // ── API ─────────────────────────────────────────────────────────────────────────────────
  let current = null;
  function seek(frame) {
    const f = Math.round(Number(frame));
    for (const it of items) { if (it.custom) it.custom(f); else apply(it.el, it.fn(f)); }
    current = f;
    return f;
  }
  window.seek = seek;
  /** תיבות הטקסט שנראות בפריים: [{ text, x, y, w, h, kind, settled }]. settled=false בזמן כניסה/יציאה (הטקסט עוד בתנועה) */
  window.captionBoxes = (frame) => {
    const f = Math.round(Number(frame));
    const prev = current;
    seek(f);
    const out = [];
    for (const t of texts) {
      const st = t.st(f);
      if (!st || st.o < 0.05) continue;
      const r = t.el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      out.push({ text: t.text, x: Math.round(r.left * 10) / 10, y: Math.round(r.top * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, kind: t.kind, settled: !!st.settled });
    }
    if (prev !== null && prev !== f) seek(prev);
    return out;
  };
  window.overlayInfo = () => ({ aspect: ASPECT, w: W, h: H, frames: TOTAL, fontsOk, logoOk, taps: tapCount, tapsStatus, cuts: CUTS, looks: LOOKS, endScale: r3(endScale), kickerH: Math.round(kickerH), texts: texts.length });
  seek(0);
  window.__overlayReady = true;
})().catch((e) => { window.__overlayError = String((e && e.stack) || e); throw e; });

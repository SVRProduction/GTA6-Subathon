// שכבת הכתוביות/גרפיקה של הטריילר. נטענת כ- /__trailer/overlay/index.html?aspect=16x9|9x16
// הכול נבנה פעם אחת מתוך /__timeline.json (+ /__work/scenes/phone/taps.json אם קיים), ואז
//   window.seek(frame)         – פונקציה טהורה של מספר הפריים: קובעת לכל אלמנט visibility/opacity/transform בסטייל inline.
//   window.captionBoxes(frame) – [{ text, style, x, y, w, h, settled }] של הטקסטים שנראים בפריים (לבדיקת אזור בטוח).
//                                settled=false בפריימים של כניסה/יציאה: פאנץ' שמתחיל גדול חורג מהאזור הבטוח לפריים אחד (33ms).
//   window.overlayInfo()       – מידע לסקריפט הצילום (גופנים, מספר לחיצות, פריימים).
// אין כאן טיימרים, transition או animation: כל התנועה מחושבת מהפריים עם פונקציות easing.
(() => {
  'use strict';

  const ASPECT = new URLSearchParams(location.search).get('aspect') === '9x16' ? '9x16' : '16x9';
  const V = ASPECT === '9x16'; // לאורך
  const C = { gold: '#f6c81e', ink: '#14110a', pink: '#ff5c8a', navy: '#070b14', white: '#f3efe6' };
  // התג "הדמיה" מופיע רק בסצנות האלה (צילומי אתר עם נתוני דמו)
  const DEMO_SCENES = ['map-journey', 'milestone', 'fx-death', 'fx-arrest', 'fx-fail', 'poll', 'tod', 'phone-home', 'phone-story', 'phone-reel', 'phone-stats'];
  // הבזק לבן בתחילת הסצנות האלה (+ שני חילופי המראה בתוך tod)
  const FLASH_SCENES = ['gta2', 'gta3', 'map-title', 'gta4', 'gta5', 'gta6', 'gta7', 'endcard'];
  const FLASH_ALPHA = [0.8, 0.5, 0.26, 0.09];
  const TAP_FRAMES = 12;
  // רק כש-layout.phone הוא כל הפריים (טלפון במסך מלא, 1080x1920): הלוחית של הכתובית יושבת מעל התוכן שלו. לכל סצנה: ה-y של
  // תחתית הלוחית, במקום שלא מסתיר את מה שהסצנה מראה (בסטורי: מעל הכותרת של הסטורי; בקליפים: בין התמונה לכותרת הקליפ).
  // ברירת המחדל: תחתית האזור הבטוח. כשהטלפון ממוסגר (layout.phone קטן מהפריים) הכתובית בצד או מעליו ולא נוגעת בתוכן.
  const PHONE_BOTTOM_FULL = { 'phone-story': 968, 'phone-reel': 1292 };
  // לאורך: בסצנת הסקר סיכת הסקר יושבת ב-y≈1140-1240, אז הכתובית שם בשורה אחת נמוכה (ולא בשתיים) כדי לא לכסות אותה
  const LOWER_LINES_9x16 = { poll: 1 };

  // ── מתמטיקה ──
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const outCubic = (t) => 1 - Math.pow(1 - t, 3);
  const outBack = (t, k = 1.70158) => 1 + (k + 1) * Math.pow(t - 1, 3) + k * Math.pow(t - 1, 2);
  /** כניסה: כבר בפריים s יש צעד ראשון, ואחרי d פריימים = 1 */
  const tin = (f, s, d) => clamp((f - s + 1) / d);
  /** יציאה ב-d הפריימים האחרונים לפני e (בפריים e-1 עוד נשאר מעט, ב-e האלמנט כבר מוסתר) */
  const tout = (f, e, d) => clamp((f - (e - d) + 1) / (d + 1));
  /** punch: מ-0 בפריים s ל-1 אחרי d פריימים */
  const tp = (f, s, d) => clamp((f - s) / d);
  const n3 = (x) => (Math.abs(x) < 0.0005 ? '0' : x.toFixed(3));

  // ── DOM ──
  const stage = document.getElementById('stage');
  const parts = []; // (frame) => void
  const caps = []; // { text, style, nodes, host }
  const PXLESS = new Set(['opacity', 'zIndex', 'fontWeight', 'lineHeight', 'flex']);
  function css(e, o) {
    for (const k in o) e.style[k] = typeof o[k] === 'number' && !PXLESS.has(k) ? `${o[k]}px` : o[k];
    return e;
  }
  function el(tag, cls, parent, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    parent.appendChild(e);
    return e;
  }
  /** מצב של אלמנט בפריים: null = מוסתר; אחרת { op, tf, anim } (anim = באמצע כניסה/יציאה) */
  function put(e, o) {
    if (!o || !(o.op > 0.002)) {
      e.style.visibility = 'hidden';
      e.style.opacity = '0';
      e.style.transform = 'none';
      e._vis = false;
      e._anim = false;
      return;
    }
    e.style.visibility = 'visible';
    e.style.opacity = o.op >= 0.999 ? '1' : o.op.toFixed(4);
    e.style.transform = o.tf || 'none';
    e._vis = true;
    e._anim = !!o.anim;
  }
  const tf = (o) => {
    const a = [];
    if (o.x || o.y) a.push(`translate(${n3(o.x || 0)}px, ${n3(o.y || 0)}px)`);
    if (o.r) a.push(`rotate(${n3(o.r)}deg)`);
    if (o.s != null && Math.abs(o.s - 1) > 0.0004) a.push(`scale(${o.s.toFixed(4)})`);
    return a.join(' ') || 'none';
  };
  const reg = (text, style, nodes, host) => caps.push({ text, style, nodes: [].concat(nodes), host });

  // ── טקסט: כיווניות, מדידה והתאמת גודל ──
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const LTR_RUN = /[A-Za-z0-9](?:[A-Za-z0-9.\/:_\- ]*[A-Za-z0-9])?/g;
  /** מפרק למילים (HTML). רצף לטיני/מספרי ("GTA 6", "19.11", כתובות) נעטף ב-span dir=ltr ונשאר מילה אחת */
  function words(text) {
    const runs = [];
    const marked = text.replace(LTR_RUN, (m) => {
      runs.push(m);
      return `${String.fromCharCode(0xe100 + runs.length - 1)}`;
    });
    return marked.split(' ').filter(Boolean).map((w) => {
      if (w === '·') return '<span class="sep">·</span>';
      return esc(w).replace(/(.)/g, (_, c) => `<span dir="ltr" class="ltr">${esc(runs[c.charCodeAt(0) - 0xe100])}</span>`);
    });
  }
  let measurer = null;
  const measureCache = new Map();
  /** רוחב של שורה (HTML) בגודל גופן 100px */
  function measure(html, o) {
    const key = `${o.family}|${o.weight}|${o.cls || ''}|${html}`;
    if (measureCache.has(key)) return measureCache.get(key);
    if (!measurer) measurer = el('div', 'measure', stage);
    measurer.className = `measure ${o.cls || ''}`; // אותן מחלקות כמו הטקסט עצמו (ריווח אותיות/מילים משפיע על הרוחב)
    css(measurer, { fontFamily: `'${o.family}'`, fontWeight: o.weight });
    measurer.innerHTML = html;
    const w = measurer.getBoundingClientRect().width;
    measureCache.set(key, w);
    return w;
  }
  function partitions(n, k) {
    // כל הדרכים לחלק n מילים ל-k שורות רצופות (k קטן)
    const out = [];
    const rec = (start, left, acc) => {
      if (left === 0) return out.push(acc);
      for (let i = start; i <= n - left; i++) rec(i + 1, left - 1, acc.concat(i));
    };
    rec(1, k - 1, []);
    return out;
  }
  /**
   * מתאים טקסט לרוחב: בוחר מספר שורות (עד maxLines) ונקודות שבירה מאוזנות כך שהגופן יהיה הכי גדול (עד maxSize).
   * שורה נוספת נבחרת רק אם היא מגדילה את הגופן ב-prefer לפחות.
   * מחזיר { lines: [html], size, width }.
   */
  function fitText(text, o) {
    const ws = Array.isArray(text) ? text : words(text);
    let best = null;
    for (let n = 1; n <= Math.min(o.maxLines || 1, ws.length); n++) {
      let bp = null;
      for (const cuts of partitions(ws.length, n)) {
        const idx = [0, ...cuts, ws.length];
        const lines = [];
        let mw = 0;
        for (let i = 0; i < n; i++) {
          const h = ws.slice(idx[i], idx[i + 1]).join(' ');
          lines.push(h);
          mw = Math.max(mw, measure(h, o));
        }
        if (!bp || mw < bp.mw - 0.01) bp = { lines, mw };
      }
      const size = Math.min(o.maxSize, (o.maxW / bp.mw) * 100);
      if (!best || size > best.size * (o.prefer || 1.1)) best = { lines: bp.lines, size, mw: bp.mw };
    }
    best.size = Math.floor(best.size * 2) / 2;
    best.width = (best.mw * best.size) / 100;
    return best;
  }
  function textEl(parent, cls, fit) {
    const d = el('div', `txt ${cls || ''}`, parent);
    d.style.fontSize = `${fit.size}px`;
    for (const ln of fit.lines) el('span', 'ln', d, ln);
    return d;
  }
  /** קו מתאר עגול (טבעת של צלליות) + צל נופל: לטקסט גדול שיושב ישר על וידאו */
  function outline(size, k = 0.03) {
    const r = Math.max(3, size * k);
    const a = [];
    for (const [rad, n] of [[r, 32], [r * 0.55, 14]]) {
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2;
        a.push(`${(Math.cos(t) * rad).toFixed(2)}px ${(Math.sin(t) * rad).toFixed(2)}px 0 ${C.ink}`);
      }
    }
    a.push(`0 ${(r * 1.5).toFixed(1)}px ${(r * 2.4).toFixed(1)}px rgba(0,0,0,0.6)`);
    return a.join(', ');
  }

  // ───────────────────────────────────────────────────────────────────────────
  async function init() {
    const [T, tapsRaw] = await Promise.all([
      fetch('/__timeline.json').then((r) => r.json()),
      fetch('/__work/scenes/phone/taps.json').then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ]);
    // גופנים: טוענים במפורש כל משקל שבשימוש (עברית + לטינית + ספרות), אחרת פנים שנדרשות רק באמצע הרינדור יופיעו ריקות
    const SAMPLE = 'אבגדהוזחטיכלמנסעפצקרשתךםןףץ GTA 6 19.11 · kick.com/odedsvr -,.\'';
    const FACES = ['700 100px Karantina', '600 40px Rubik', '800 40px Rubik', '900 40px Rubik'];
    await Promise.all(FACES.map((f) => document.fonts.load(f, SAMPLE)));
    await document.fonts.ready;
    const fontsOk = FACES.every((f) => document.fonts.check(f, SAMPLE));

    // ── ציר הזמן ──
    const FPB = (T.fps * 60) / T.bpm;
    const F = (beat) => Math.round(beat * FPB);
    const TOTAL = F(T.bars * 4);
    const scenes = T.scenes.map((s) => ({ ...s, start: F(s.beat), end: F(s.beat + s.beats) }));
    const scene = (name) => scenes.find((s) => s.name === name);
    const sceneAt = (f) => scenes.find((s) => f >= s.start && f < s.end);
    // חילופי המראה בתוך tod: 4 ו-8 פעימות מתחילת הסצנה (פריימים 787 ו-844), כמו שהסצנה עצמה מצולמת
    const tod = scene('tod');
    const TOD_LOOK = tod ? [tod.start + Math.round(4 * FPB), tod.start + Math.round(8 * FPB)] : [];
    const CUTS = [...scenes.map((s) => s.start), ...TOD_LOOK, TOTAL];
    /** פריים של פעימה, מוצמד לחיתוך אם הוא במרחק פריים אחד (פעימה 56 = 787.5) */
    const FS = (beat) => {
      const f = F(beat);
      const c = CUTS.find((x) => Math.abs(x - f) <= 1);
      return c == null ? f : c;
    };

    // ── פריסה ──
    const Lay = T.layout[ASPECT];
    const W = Lay.w;
    const H = Lay.h;
    const S = Lay.safe;
    const P = Lay.phone;
    const SW = S.x1 - S.x0;
    const SH = S.y1 - S.y0;
    const CX = (S.x0 + S.x1) / 2;
    const CY = (S.y0 + S.y1) / 2;
    css(stage, { width: W, height: H });
    const layers = {};
    for (const n of ['scrim', 'flash', 'phone', 'taps', 'caps']) layers[n] = el('div', `fill layer layer-${n}`, stage);
    const pct = (v, total) => `${((v / total) * 100).toFixed(2)}%`;

    // ── לחיצות (קואורדינטות טלפון 1080x1920 -> מלבן הטלפון בפריים) ──
    const taps = (Array.isArray(tapsRaw) ? tapsRaw : [])
      .filter((t) => t && scene(t.scene) && [t.frame, t.x, t.y].every(Number.isFinite))
      .map((t) => ({ f: scene(t.scene).start + Math.round(t.frame), x: P.x + (t.x * P.w) / 1080, y: P.y + (t.y * P.h) / 1920 }));

    // ═══ הבזקי חיתוך ═══
    {
      const frames = [...FLASH_SCENES.map((n) => scene(n)).filter(Boolean).map((s) => s.start), ...TOD_LOOK];
      const d = el('div', 'fill flash', layers.flash);
      parts.push((f) => {
        let a = 0;
        for (const c of frames) {
          const k = f - c;
          if (k >= 0 && k < FLASH_ALPHA.length) a = Math.max(a, FLASH_ALPHA[k]);
        }
        put(d, a ? { op: a } : null);
      });
    }

    // ── הטלפון: איפה הוא יושב בפריים, ואיפה יש מקום לכתובית שלו ──
    const BEZEL = 16; // עובי המסגרת
    const phoneScenes = scenes.filter((s) => s.kind === 'phone');
    const inPhone = (f) => phoneScenes.some((s) => f >= s.start && f < s.end);
    const phoneInset = !(P.x === 0 && P.y === 0 && P.w === W && P.h === H); // הווידאו של הטלפון מונח במלבן (עם מסגרת) ולא על כל הפריים
    const sideRoom = S.x1 - (P.x + P.w + BEZEL); // מקום פנוי מימין לטלפון
    const topRoom = P.y - BEZEL - S.y0; // מקום פנוי מעל הטלפון, בתוך האזור הבטוח
    const phoneCaption = !phoneInset ? 'over' : sideRoom >= 620 ? 'side' : topRoom >= 100 ? 'above' : 'over';

    // ═══ תג "הדמיה" ═══
    {
      // בסצנות טלפון שבהן הכתובית יושבת ברצועה שמעל הטלפון, התג עובר לרצועה שמשמאל לטלפון (הפינה העליונה תפוסה)
      const beside = phoneCaption === 'above' && P.x - BEZEL - S.x0 >= 90;
      const mk = (names, pos) => {
        const ranges = [];
        for (const s of scenes) {
          if (!names.includes(s.name)) continue;
          const last = ranges[ranges.length - 1];
          if (last && last[1] === s.start) last[1] = s.end;
          else ranges.push([s.start, s.end]);
        }
        if (!ranges.length) return;
        const d = el('div', 'demo', layers.caps, esc(T.demoTag.text));
        const { fit: fitW, ...st } = pos;
        css(d, st);
        // רצועה צרה: מקטינים את התג עד שהוא נכנס ברוחב
        if (fitW) for (let fs = st.fontSize; fs > 14 && d.offsetWidth > fitW; fs -= 0.5) css(d, { fontSize: fs, padding: `${Math.round(fs * 0.24)}px ${Math.round(fs * 0.55)}px ${Math.round(fs * 0.28)}px` });
        reg(T.demoTag.text, 'demo', d, d);
        parts.push((f) => {
          const r = ranges.find(([a, b]) => f >= a && f < b);
          if (!r) return put(d, null);
          const op = Math.min(tin(f, r[0], 4), 1 - tout(f, r[1], 3));
          put(d, { op, anim: op < 1 });
        });
      };
      const corner = V ? { left: S.x0, top: S.y0, fontSize: 27, padding: '7px 22px 8px' } : { right: W - S.x1, top: S.y0, fontSize: 25, padding: '6px 20px 7px' };
      const isPhone = (n) => phoneScenes.some((s) => s.name === n);
      mk(DEMO_SCENES.filter((n) => !(beside && isPhone(n))), corner);
      if (beside) mk(DEMO_SCENES.filter(isPhone), { left: S.x0, top: P.y + 26, fontSize: 25, padding: '6px 14px 7px', fit: P.x - BEZEL - S.x0 - 6 });
    }

    // ═══ slam ═══
    function buildSlam(c, s, e) {
      const scrim = el('div', 'fill scrim-slam', layers.scrim);
      scrim.style.setProperty('--cx', pct(CX, W));
      scrim.style.setProperty('--cy', pct(CY, H));
      const box = el('div', 'box', layers.caps);
      css(box, { left: S.x0, top: S.y0, width: SW, height: SH });
      const fit = fitText(c.text, { family: 'Karantina', weight: 700, cls: 'kar slam', maxW: V ? SW * 0.9 : 1480, maxSize: V ? 580 : 520, maxLines: V ? 2 : 1 });
      const t = textEl(box, 'kar slam', fit);
      t.style.textShadow = outline(fit.size, 0.03);
      reg(c.text, c.style, t, t);
      const bumps = CUTS.filter((x) => x > s && x < e); // חיתוך באמצע הכתובית -> דחיפה קטנה
      parts.push((f) => {
        if (f < s || f >= e) {
          put(scrim, null);
          return put(t, null);
        }
        const k = f - s;
        const o = tout(f, e, 3);
        put(scrim, { op: clamp(tin(f, s, 3)) * (1 - o) });
        let sc = lerp(1.5, 1, outBack(tp(f, s, 4), 1.4));
        sc *= 1 + 0.035 * clamp((k - 4) / (e - s - 4)); // זחילה איטית בזמן ההחזקה
        for (const b of bumps) if (f >= b) sc *= 1 + 0.07 * Math.pow(1 - clamp((f - b) / 5), 2);
        sc *= 1 - 0.08 * o;
        put(t, { op: (k === 0 ? 0.72 : 1) * (1 - o), tf: tf({ s: sc }), anim: k < 5 || o > 0 });
      });
    }

    // ═══ כותרת: לוגו, שם, שורת משנה ═══
    const logos = [];
    function logoEl(parent, size) {
      const d = el('div', 'logo', parent);
      css(d, { width: size, height: size });
      const img = el('img', '', d);
      img.alt = '';
      img.src = '/icons/oded-512.png';
      logos.push(img);
      return d;
    }
    function buildTitle(c, s, e) {
      const scrim = el('div', 'fill scrim-title', layers.scrim);
      scrim.style.setProperty('--cx', pct(CX, W));
      scrim.style.setProperty('--cy', pct(CY, H));
      const box = el('div', 'box', layers.caps);
      css(box, { left: S.x0, top: S.y0, width: SW, height: SH });
      const logo = c.logo ? logoEl(box, V ? 250 : 200) : null;
      const fit = fitText(c.text, { family: 'Karantina', weight: 700, cls: 'kar title', maxW: V ? SW * 0.94 : 1500, maxSize: V ? 270 : 250, maxLines: V ? 2 : 1 });
      const t = textEl(box, 'kar title', fit);
      css(t, { textShadow: outline(fit.size, 0.03), marginTop: V ? 34 : 14 });
      reg(c.text, c.style, t, t);
      let sub = null;
      if (c.sub) {
        const sf = fitText(c.sub, { family: 'Rubik', weight: 800, maxW: V ? SW - 2 * 34 - 10 : 1400, maxSize: V ? 46 : 50, maxLines: 1 });
        sub = el('div', 'subpill', box);
        css(sub, { padding: V ? '14px 34px 15px' : '13px 44px 14px', marginTop: V ? 40 : 26 });
        reg(c.sub, 'title-sub', textEl(sub, '', sf), sub);
      }
      const sT = F(c.beat + 1);
      const sS = F(c.beat + 2);
      parts.push((f) => {
        if (f < s || f >= e) {
          put(scrim, null);
          if (logo) put(logo, null);
          put(t, null);
          if (sub) put(sub, null);
          return;
        }
        const o = tout(f, e, 4);
        const out = 1 - o;
        put(scrim, { op: lerp(0.35, 1, outCubic(tin(f, s, 8))) * out });
        if (logo) put(logo, { op: clamp(tin(f, s, 3)) * out, tf: tf({ s: lerp(0.25, 1, outBack(tp(f, s, 8), 2.2)) * (1 - 0.06 * o) }), anim: f - s < 9 || o > 0 });
        if (f < sT) put(t, null);
        else put(t, { op: (f === sT ? 0.72 : 1) * out, tf: tf({ s: lerp(1.42, 1, outBack(tp(f, sT, 4), 1.4)) * (1 - 0.06 * o) }), anim: f - sT < 5 || o > 0 });
        if (sub) {
          if (f < sS) put(sub, null);
          else {
            const a = tin(f, sS, 5);
            put(sub, { op: clamp(a * 1.3) * out, tf: tf({ y: (1 - outCubic(a)) * 30, s: 1 - 0.06 * o }), anim: a < 1 || o > 0 });
          }
        }
      });
    }

    // ═══ כתובית תחתונה (lower) ═══
    /**
     * o.bottoms: רשימת מועמדים ל-y של תחתית הלוחית; נבחר הראשון שאין לחיצה (tap) מתחתיו בזמן הכתובית.
     * o.band: [y0, y1] – במקום זה, לוחית של שורה אחת שממורכזת ברצועה (מעל הטלפון). o.maxLines: מספר שורות מרבי.
     */
    function buildLower(c, s, e, o) {
      const bar = 14;
      const padX = V ? 38 : 46;
      const padY = V ? [18, 20] : [15, 17];
      const band = o.band || null;
      const maxSize = band ? Math.min(V ? 74 : 72, (band[1] - band[0] - padY[0] - padY[1] - 8) / 1.14) : V ? 74 : 72;
      const fit = fitText(c.text, { family: 'Rubik', weight: 900, maxW: V ? SW - 2 * padX - bar - 12 : 1500, maxSize, maxLines: band ? 1 : o.maxLines || (V ? 2 : 1), prefer: 1.02 });
      const row = el('div', 'row', layers.caps);
      css(row, { left: S.x0, width: SW });
      const main = el('div', 'plate lower', row);
      main.style.setProperty('--bar', `${bar}px`);
      css(main, { padding: `${padY[0]}px ${padX + bar}px ${padY[1]}px ${padX}px` });
      reg(c.text, c.style, textEl(main, '', fit), main);
      let sub = null;
      let shift = 0;
      let sSub = 0;
      if (c.sub) {
        const sf = fitText(c.sub, { family: 'Rubik', weight: 900, maxW: SW - 100, maxSize: V ? 58 : 54, maxLines: 1 });
        sub = el('div', 'lsub', row);
        css(sub, { padding: V ? '9px 34px 11px' : '8px 34px 10px', marginTop: -8 });
        reg(c.sub, 'lower-sub', textEl(sub, '', sf), sub);
        sSub = c.subBeat != null ? FS(c.subBeat) : s;
        shift = sub.offsetHeight - 8; // עד ששורת המשנה מופיעה, הלוחית הראשית יושבת בתחתית
      }
      const w = main.offsetWidth;
      const h = row.offsetHeight;
      const hits = taps.filter((t) => t.f > s - TAP_FRAMES && t.f < e);
      const clear = (b) => !hits.some((t) => Math.abs(t.x - CX) < w / 2 + 120 && t.y > b - h - 120 && t.y < b + 120);
      const bottom = band ? Math.round((band[0] + band[1] + h) / 2) : o.bottoms.find(clear) || o.bottoms[0];
      css(row, { bottom: H - bottom });
      const dir = band ? -0.3 : 1; // ברצועה העליונה הלוחית יורדת מעט למקומה (ולא עולה מלמטה), כדי להישאר בתוך האזור הבטוח
      parts.push((f) => {
        if (f < s || f >= e) {
          put(main, null);
          if (sub) put(sub, null);
          return;
        }
        const a = tin(f, s, 5);
        const q = tout(f, e, 4);
        let y = dir * ((1 - outCubic(a)) * 46 + q * 22);
        if (sub) {
          const b = f >= sSub ? tin(f, sSub, 6) : 0;
          y += shift * (1 - outCubic(b));
          if (f < sSub) put(sub, null);
          else put(sub, { op: clamp(b * 1.6) * (1 - q), tf: tf({ y: dir * q * 22, r: -1.6, s: lerp(0.6, 1, outBack(tp(f, sSub, 6), 1.9)) }), anim: f - sSub < 7 || q > 0 });
        }
        put(main, { op: clamp(a * 1.3) * (1 - q), tf: tf({ y }), anim: a < 1 || q > 0 });
      });
      return bottom;
    }

    // ═══ כיתוב גדול ליד הטלפון (16x9) ═══
    function buildPhoneSide(c, s, e) {
      const x0 = P.x + P.w + BEZEL + 44;
      const x1 = S.x1;
      const padX = 50;
      const fit = fitText(c.text, { family: 'Karantina', weight: 700, cls: 'kar', maxW: x1 - x0 - 2 * padX - 90, maxSize: 215, maxLines: 2, prefer: 1.1 });
      const box = el('div', 'box', layers.caps);
      css(box, { left: x0, top: S.y0, width: x1 - x0, height: SH });
      const lines = fit.lines.map((ln, i) => {
        const gold = fit.lines.length > 1 && i === fit.lines.length - 1; // השורה האחרונה מודגשת
        const p = el('div', `pcap ${gold ? 'gold' : 'dark'}`, box);
        css(p, { padding: `${Math.round(fit.size * 0.05)}px ${padX}px ${Math.round(fit.size * 0.1)}px`, borderRadius: 26, marginTop: i ? -Math.round(fit.size * 0.06) : 0, zIndex: i + 1, position: 'relative' });
        const t = textEl(p, 'kar', { size: fit.size, lines: [ln] });
        return { p, t, rot: i % 2 ? 1.6 : -2.2, x: i % 2 ? -22 : 14 };
      });
      reg(c.text, c.style, lines.map((l) => l.t), lines[0].p);
      parts.push((f) => {
        lines.forEach((l, i) => {
          const ls = s + i * 3; // השורה השנייה נוחתת 3 פריימים אחרי הראשונה
          if (f < ls || f >= e) return put(l.p, null);
          const o = tout(f, e, 4);
          const sc = lerp(1.3, 1, outBack(tp(f, ls, 4), 1.4)) * (1 - 0.05 * o);
          put(l.p, { op: (f === ls ? 0.72 : 1) * (1 - o), tf: tf({ x: l.x + o * 40, r: l.rot, s: sc }), anim: f - ls < 5 || o > 0 });
        });
      });
    }

    // ═══ kicker ═══
    function buildKicker(c, s, e) {
      const size = V ? 42 : 40;
      const fit = fitText(c.text, { family: 'Rubik', weight: 800, maxW: SW - 2 * 34 - 40, maxSize: size, maxLines: 1 });
      const row = el('div', 'row', layers.caps);
      css(row, { left: S.x0, width: SW, top: V ? S.y0 + 64 : S.y0 });
      const k = el('div', 'kicker', row);
      css(k, { padding: V ? '11px 30px 12px 34px' : '10px 30px 11px 34px', gap: 16 });
      const dot = css(el('i', 'dot', k), { width: fit.size * 0.42, height: fit.size * 0.42 });
      reg(c.text, c.style, textEl(k, '', fit), k);
      parts.push((f) => {
        // הנקודה הוורודה פועמת על כל פעימה של המוזיקה
        const ph = f - F(Math.floor((f + 0.5) / FPB));
        dot.style.transform = f >= s && f < e && ph >= 0 && ph < 5 ? `scale(${(1 + 0.45 * Math.pow(1 - ph / 5, 2)).toFixed(3)})` : 'none';
        if (f < s || f >= e) return put(k, null);
        const a = tin(f, s, 6);
        const o = tout(f, e, 4);
        put(k, { op: clamp(a * 1.3) * (1 - o), tf: tf({ y: -(1 - outCubic(a)) * 12, s: lerp(0.88, 1, outCubic(a)) * (1 - 0.06 * o) }), anim: a < 1 || o > 0 });
      });
    }

    // ═══ label ═══
    const LABEL_COLORS = { 'שקיעה.': C.pink, 'לילה.': C.white };
    function buildLabel(c, s, e) {
      const fit = fitText(c.text, { family: 'Karantina', weight: 700, cls: 'kar', maxW: SW - 180, maxSize: V ? 230 : 210, maxLines: 1 });
      const row = el('div', 'row', layers.caps);
      css(row, { left: S.x0, width: SW, bottom: H - (S.y1 - (V ? 26 : 24)) });
      const p = el('div', 'label', row);
      css(p, { padding: `${Math.round(fit.size * 0.03)}px ${Math.round(fit.size * 0.3)}px ${Math.round(fit.size * 0.085)}px`, borderRadius: 28 });
      const t = textEl(p, 'kar', fit);
      const col = LABEL_COLORS[c.text];
      if (col) {
        t.style.color = col;
        p.style.borderColor = col;
      }
      reg(c.text, c.style, t, p);
      parts.push((f) => {
        if (f < s || f >= e) return put(p, null);
        const q = tp(f, s, 4);
        const o = tout(f, e, 3);
        const sc = lerp(1.55, 1, outBack(q, 1.5)) * (1 - 0.1 * o);
        put(p, { op: (f === s ? 0.72 : 1) * (1 - o), tf: tf({ r: lerp(-8, -2.5, outCubic(q)), s: sc }), anim: f - s < 5 || o > 0 });
      });
    }

    // ═══ טלפון: מסגרת (16x9) ולחיצות ═══
    if (phoneInset && phoneScenes.length) {
      // מסגרת כהה סביב מלבן הווידאו. עובי 16, רדיוס פנימי 36, רדיוס חיצוני 48: מרכז הקשת החיצונית במרחק 32√2≈45 מפינת הווידאו (<48),
      // כך שהפינות המרובעות של הווידאו מכוסות לגמרי. החור קטן בפיקסל מכל צד כדי שלא יציץ קו בהיר בשוליים.
      const t = BEZEL;
      const u = P.w / 540; // קנה מידה של הפרטים הקטנים (מגרעת, כפתורים) לפי גודל הטלפון
      const rr = (x, y, w, h, r) => `M${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h - r}A${r},${r} 0 0 1 ${x + w - r},${y + h}H${x + r}A${r},${r} 0 0 1 ${x},${y + h - r}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}Z`;
      const outer = rr(P.x - t, P.y - t, P.w + 2 * t, P.h + 2 * t, 48);
      const hole = rr(P.x + 1, P.y + 1, P.w - 2, P.h - 2, 36);
      const shadow = rr(P.x - t, P.y - t + 26, P.w + 2 * t, P.h + 2 * t, 48);
      const cx = P.x + P.w / 2;
      const notch = `M${cx - 62 * u},${P.y - 1}H${cx + 62 * u}V${P.y + 6 * u}a${13 * u},${13 * u} 0 0 1 ${-13 * u},${13 * u}H${cx - 49 * u}a${13 * u},${13 * u} 0 0 1 ${-13 * u},${-13 * u}Z`;
      const d = el('div', 'fill', layers.phone, `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block">
        <defs>
          <filter id="bz-blur" x="-40%" y="-25%" width="180%" height="150%"><feGaussianBlur stdDeviation="30"/></filter>
          <clipPath id="bz-out"><path clip-rule="evenodd" d="M0,0H${W}V${H}H0Z ${outer}"/></clipPath>
          <linearGradient id="bz-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#262a36"/><stop offset="0.5" stop-color="#0b0d13"/><stop offset="1" stop-color="#1a1d27"/></linearGradient>
        </defs>
        <g clip-path="url(#bz-out)"><path d="${shadow}" fill="rgba(0,0,0,0.62)" filter="url(#bz-blur)"/></g>
        <rect x="${P.x + P.w + t - 2}" y="${P.y + 210 * u}" width="7" height="${96 * u}" rx="3.5" fill="#0b0d13"/>
        <rect x="${P.x - t - 5}" y="${P.y + 170 * u}" width="7" height="${54 * u}" rx="3.5" fill="#0b0d13"/>
        <rect x="${P.x - t - 5}" y="${P.y + 240 * u}" width="7" height="${54 * u}" rx="3.5" fill="#0b0d13"/>
        <path fill-rule="evenodd" d="${outer} ${hole}" fill="url(#bz-g)"/>
        <path d="${outer}" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="2"/>
        <path d="${rr(P.x - 5, P.y - 5, P.w + 10, P.h + 10, 41)}" fill="none" stroke="rgba(0,0,0,0.55)" stroke-width="3"/>
        <path d="${notch}" fill="#0b0d13"/>
        <circle cx="${cx + 34 * u}" cy="${P.y + 8 * u}" r="${4 * u}" fill="#232838"/>
        <rect x="${cx - 26 * u}" y="${P.y + 5.5 * u}" width="${40 * u}" height="${5 * u}" rx="${2.5 * u}" fill="#1b1f2b"/>
      </svg>`);
      parts.push((f) => put(d, inPhone(f) ? { op: 1 } : null));
    }
    {
      const k = P.w / 1080; // קנה מידה של הטלפון בפריים
      for (const tap of taps) {
        const d = el('div', 'tap', layers.taps);
        css(d, { left: tap.x, top: tap.y });
        const ring = el('i', 'ring', d);
        const dot = el('i', 'dotc', d);
        parts.push((f) => {
          const n = f - tap.f;
          if (n < 0 || n >= TAP_FRAMES) return put(d, null);
          const q = n / TAP_FRAMES;
          const r = lerp(26, 104, outCubic(q)) * k; // רדיוס הטבעת
          const bw = Math.max(2, lerp(12, 4, q) * k);
          css(ring, { left: -r, top: -r, width: 2 * r, height: 2 * r, borderWidth: bw, opacity: (1 - q).toFixed(3) });
          const dr = lerp(30, 20, outCubic(clamp(q * 2))) * k;
          css(dot, { left: -dr, top: -dr, width: 2 * dr, height: 2 * dr, opacity: (1 - Math.pow(q, 3)).toFixed(3) });
          put(d, { op: 1 });
        });
      }
    }

    // ═══ מסך הסיום ═══
    function buildEnd(E) {
      const s0 = FS(E.beat);
      const scrim = el('div', 'fill scrim-end', layers.scrim);
      scrim.style.setProperty('--cx', pct(CX, W));
      scrim.style.setProperty('--cy', pct(V ? CY - 60 : CY - 40, H));
      const th = V ? 84 : 74; // גובה שורת המבזק
      const ty = S.y1 - th;
      const col = el('div', 'endcol', layers.caps);
      css(col, { left: S.x0, top: S.y0, width: SW, height: ty - (V ? 30 : 14) - S.y0, gap: V ? 34 : 22 });
      const anims = [];
      let head = null;
      for (const ln of E.lines) {
        const s = FS(ln.beat);
        if (ln.style === 'title') {
          head = el('div', 'endhead', col);
          css(head, { flexDirection: V ? 'column' : 'row', gap: V ? 14 : 36 });
          const logo = ln.logo ? logoEl(head, V ? 220 : 168) : null;
          const fit = fitText(ln.text, { family: 'Karantina', weight: 700, cls: 'kar endtitle', maxW: V ? SW * 0.9 : 1100, maxSize: V ? 148 : 190, maxLines: 1 });
          const t = textEl(head, 'kar endtitle', fit);
          t.style.textShadow = outline(fit.size, 0.035);
          reg(ln.text, 'end-title', t, t);
          anims.push((f) => {
            if (logo) put(logo, { op: clamp(tin(f, s, 3)), tf: tf({ s: lerp(0.25, 1, outBack(tp(f, s, 8), 2.2)) }), anim: f - s < 9 });
            const st = s + 3;
            if (f < st) put(t, null);
            else put(t, { op: clamp(tin(f, st, 2)), tf: tf({ s: lerp(0.6, 1, outBack(tp(f, st, 6), 1.8)) }), anim: f - st < 7 });
          });
        } else if (ln.style === 'game') {
          const size = V ? 124 : 104;
          const p = el('div', 'endgame', col);
          css(p, { padding: `${Math.round(size * 0.04)}px ${Math.round(size * 0.42)}px ${Math.round(size * 0.09)}px`, borderRadius: 20 });
          reg(ln.text, 'end-game', textEl(p, 'kar', { size, lines: [words(ln.text).join(' ')] }), p);
          anims.push((f) => {
            if (f < s) return put(p, null);
            put(p, { op: clamp(tin(f, s, 2)), tf: tf({ r: -3, s: lerp(0.3, 1, outBack(tp(f, s, 6), 2.4)) }), anim: f - s < 7 });
          });
        } else if (ln.style === 'date') {
          const fit = fitText(ln.text, { family: 'Karantina', weight: 700, cls: 'kar enddate', maxW: V ? SW * 0.93 : 1500, maxSize: 300, maxLines: 1 });
          const t = textEl(col, 'kar enddate', fit);
          t.style.textShadow = `${outline(fit.size, 0.032)}, 0 0 ${Math.round(fit.size * 0.3)}px rgba(246,200,30,0.35)`;
          reg(ln.text, 'end-date', t, t);
          anims.push((f) => {
            if (f < s) return put(t, null);
            let sc = lerp(V ? 1.3 : 1.45, 1, outBack(tp(f, s, 4), 1.4));
            // פעימה קטנה על כל פעימה של המוזיקה אחרי הכניסה
            if (f - s > 6) sc *= 1 + 0.02 * Math.exp(-Math.max(0, f - F(Math.floor((f + 0.5) / FPB))) / 2.2);
            put(t, { op: f === s ? 0.72 : 1, tf: tf({ s: sc }), anim: f - s < 5 });
          });
        } else if (ln.style === 'link') {
          const padX = V ? 40 : 52;
          const m = ln.text.match(/^(.*\/)([^/]+)$/);
          const html = m ? `<span dir="ltr" class="ltr"><span class="hl">${esc(m[1])}</span>${esc(m[2])}</span>` : words(ln.text).join(' ');
          const fit = fitText([html], { family: 'Rubik', weight: 900, maxW: SW - 2 * padX - 24, maxSize: V ? 74 : 72, maxLines: 1 });
          const p = el('div', 'endlink', col);
          css(p, { padding: `${V ? 16 : 13}px ${padX}px ${V ? 18 : 15}px` });
          reg(ln.text, 'end-link', textEl(p, '', fit), p);
          anims.push((f) => {
            if (f < s) return put(p, null);
            const a = tin(f, s, 5);
            put(p, { op: clamp(a * 1.5), tf: tf({ y: (1 - outCubic(a)) * 44, s: lerp(0.86, 1, outBack(tp(f, s, 6), 2)) }), anim: f - s < 7 });
          });
        } else {
          const padX = V ? 26 : 30;
          const fit = fitText(ln.text, { family: 'Rubik', weight: 600, maxW: SW - 2 * padX - 16, maxSize: V ? 37 : 34, maxLines: 1 });
          const p = el('div', 'endurl', col);
          css(p, { padding: V ? '9px 26px 10px' : '8px 30px 9px' });
          reg(ln.text, 'end-url', textEl(p, '', fit), p);
          // נכנסת מהר (נקראת כבר בפריים הראשון): הפעימה שלה מאוחרת, והיא צריכה להיות על המסך כמה שיותר זמן
          anims.push((f) => {
            if (f < s) return put(p, null);
            put(p, { op: 1, tf: tf({ s: lerp(0.9, 1, outCubic(tp(f, s, 3))) }), anim: f - s < 3 });
          });
        }
      }
      // שורת המבזק: התג האדום הוא המקטע הראשון של הטקסט ("מבזק"), והשאר נע לאט משמאל לימין (כמו מבזק בעברית)
      const segs = E.ticker.split(' · ');
      const tagText = segs.length > 1 ? segs[0] : 'מבזק';
      const body = segs.length > 1 ? segs.slice(1).join(' · ') : E.ticker;
      const bar = el('div', 'ticker', layers.caps);
      css(bar, { left: S.x0, top: ty, width: SW, height: th });
      const fs = V ? 40 : 36;
      const tag = el('div', 'tk-tag', bar, `<span>${esc(tagText)}</span>`);
      css(tag, { zIndex: 2, fontSize: fs + 2, padding: V ? '0 26px 0 34px' : '0 30px 0 38px', clipPath: 'polygon(18px 0, 100% 0, 100% 100%, 0 100%)' });
      const tagW = tag.offsetWidth;
      const clipW = SW - tagW + 6;
      const clip = el('div', 'tk-clip', bar);
      const fadeW = V ? 56 : 110; // הטקסט הנע נמוג בקצה השמאלי במקום להיחתך
      css(clip, { width: clipW, maskImage: `linear-gradient(to right, transparent 0, #000 ${fadeW}px)`, webkitMaskImage: `linear-gradient(to right, transparent 0, #000 ${fadeW}px)` });
      const track = el('div', 'tk-track', clip);
      const segHtml = `${words(body).join(' ')} <span class="sep">·</span>`;
      const first = el('span', 'tk-seg', track, segHtml);
      css(first, { fontSize: fs, paddingLeft: fs * 0.3 });
      const w = first.getBoundingClientRect().width;
      const copies = Math.ceil(clipW / w) + 2;
      for (let i = 1; i < copies; i++) css(el('span', 'tk-seg', track, segHtml), { fontSize: fs, paddingLeft: fs * 0.3 });
      const speed = V ? 2.4 : 3; // פיקסלים לפריים
      // הפאזה נבחרת כך שבפריים האחרון (הפוסטר) מקטע מתחיל בדיוק ליד התג
      const mod = (x) => ((x % w) + w) % w;
      const phase = mod(clipW - 30 - (TOTAL - 1 - s0) * speed);
      reg(tagText, 'ticker-tag', tag.firstChild, bar);
      reg(body, 'ticker', clip, bar);
      parts.push((f) => {
        track.style.transform = `translateX(${(-w + mod(phase + (f - s0) * speed)).toFixed(2)}px)`;
        if (f < s0) {
          put(scrim, null);
          put(bar, null);
          if (head) for (const c of head.children) put(c, null);
          for (const c of col.children) if (c !== head) put(c, null);
          return;
        }
        put(scrim, { op: lerp(0.45, 1, outCubic(tin(f, s0, 8))) });
        for (const a of anims) a(f);
        const a = tin(f, s0 + 2, 6);
        put(bar, f < s0 + 2 ? null : { op: clamp(a * 1.4), tf: tf({ y: -(1 - outCubic(a)) * 16 }), anim: a < 1 });
      });
    }

    // ── בנייה לפי timeline.captions ──
    const lowers = [];
    for (const c of T.captions) {
      const s = FS(c.beat);
      const e = FS(c.beat + c.beats);
      if (c.style === 'slam') buildSlam(c, s, e);
      else if (c.style === 'title') buildTitle(c, s, e);
      else if (c.style === 'kicker') buildKicker(c, s, e);
      else if (c.style === 'label') buildLabel(c, s, e);
      else if (c.style === 'lower') {
        const sc = sceneAt(s);
        const phone = !!sc && sc.kind === 'phone';
        const def = S.y1 - (V ? 14 : 16);
        if (phone && phoneCaption === 'side') buildPhoneSide(c, s, e);
        else if (phone && phoneCaption === 'above') {
          // הטלפון ממוסגר ואין מקום בצד (לאורך): לוחית של שורה אחת ברצועה שמעל הטלפון
          buildLower(c, s, e, { band: [S.y0, P.y - BEZEL] });
          lowers.push({ text: c.text, scene: sc.name, where: 'above' });
        } else if (phone) {
          // הטלפון על כל הפריים: הלוחית מעל התוכן שלו. מקום לפי הסצנה, ואם יש שם לחיצה – המועמד הבא
          const bottom = buildLower(c, s, e, { bottoms: [PHONE_BOTTOM_FULL[sc.name] || def, def, 1292, 968, 640] });
          lowers.push({ text: c.text, scene: sc.name, where: bottom });
        } else buildLower(c, s, e, { bottoms: [def], maxLines: V && sc ? LOWER_LINES_9x16[sc.name] : 0 });
      }
    }
    if (T.endcard) buildEnd(T.endcard);

    await Promise.all(logos.map((img) => img.decode().catch(() => {})));
    const logosOk = logos.every((img) => img.naturalWidth > 0);

    // ── ה-API ──
    let current = -1;
    window.seek = (frame) => {
      const f = Math.round(Number(frame));
      for (const p of parts) p(f);
      current = f;
      return f;
    };
    /** האם האלמנט (או אחד מאבותיו) מוסתר / באמצע כניסה-יציאה בפריים הנוכחי */
    const chain = (n, key) => {
      for (let e = n; e && e !== stage; e = e.parentElement) if (e[key] === (key === '_vis' ? false : true)) return true;
      return false;
    };
    window.captionBoxes = (frame) => {
      window.seek(frame);
      const r1 = (v) => Math.round(v * 10) / 10;
      const out = [];
      for (const c of caps) {
        if (chain(c.host, '_vis')) continue;
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        let anim = chain(c.host, '_anim');
        for (const n of c.nodes) {
          if (chain(n, '_vis')) continue;
          anim = anim || chain(n, '_anim');
          const r = n.getBoundingClientRect();
          x0 = Math.min(x0, r.left);
          y0 = Math.min(y0, r.top);
          x1 = Math.max(x1, r.right);
          y1 = Math.max(y1, r.bottom);
        }
        if (!(x1 > x0)) continue;
        out.push({ text: c.text, style: c.style, x: r1(x0), y: r1(y0), w: r1(x1 - x0), h: r1(y1 - y0), settled: !anim });
      }
      return out;
    };
    window.overlayInfo = () => ({ aspect: ASPECT, frames: TOTAL, fontsOk, logosOk, taps: taps.length, todLook: TOD_LOOK, captions: caps.length, phoneCaption, phoneCaptionAt: lowers.map((l) => `${l.scene}:${l.where}`), frame: current });
    window.seek(0);
    window.__overlayReady = true;
  }

  init().catch((e) => {
    window.__overlayError = String((e && e.stack) || e);
    throw e;
  });
})();

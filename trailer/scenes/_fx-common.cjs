// משותף לארבע סצנות "אירועים חיים על המפה": fx-death, fx-arrest, fx-fail, poll.
// השיטה: מצלמים את האתר בקנה מידה גדול (dsf) וחותכים חלון בגודל הפלט סביב הדמות של עודד ("מצלמה וירטואלית").
// כך הדמות, האפקטים והכרטיסים גדולים וחדים, והמפה נשארת אותה מפה. שכבות שממורכזות על המסך כולו
// (ההבזק "מתת", הבאנר MISSION FAILED) מונחות ב-CSS של הצילום בדיוק על החלון שנחתך, כאילו הוא המסך.
const path = require('path');
const fs = require('fs');
const { open, WORK, DIST, MAP_CSS, MAP_READY } = require('../lib/harness.cjs');
const { slot } = require('../lib/timeline.cjs');

const OUT = { '16x9': { w: 1920, h: 1080 }, '9x16': { w: 1080, h: 1920 } };
const URL = '/?demo&fx&time=12'; // אור יום
// לבדיקות: TRAILER_FX_OUT=<dir> מפנה את הפלט לתיקייה אחרת (ברירת מחדל work/scenes)
const SCENES = process.env.TRAILER_FX_OUT || path.join(WORK, 'scenes');

/** CSS לצילום: בלי HUD (נחתך ממילא), בלי הכרטיס הקטן של העצירה ובלי התווית "ההמשך עוד לא נכתב" שיושבים על הדמות */
const CLEAN_CSS = `${MAP_CSS}
.pin__card,.ahead-tag{display:none!important}
.hud,.onair{visibility:hidden!important}`;
/** בשלושת האפקטים הסקר עוד לא על המסך (הוא מגיע בסצנה משלו) */
const NO_POLL_CSS = '.mk--poll,.poll-line{display:none!important}';

/** מצב המצלמה והדמות, נקרא מה-DOM (אותה מתמטיקה כמו world.project באתר) */
const READ_STATE = () => {
  const num = (s, re) => { const m = (s || '').match(re); return m ? m.slice(1).map(Number) : null; };
  const world = document.querySelector('.world');
  const tiltEl = document.querySelector('.tilt');
  const stage = document.querySelector('.journey__stage');
  const me = document.querySelector('.player');
  const b = me.getBoundingClientRect();
  const tr = num(world.style.transform, /translate3d\(([-\d.]+)px,\s*([-\d.]+)px,\s*0(?:px)?\)\s*scale\(([-\d.]+)\)/);
  const tl = num(tiltEl.style.transform, /perspective\(([-\d.]+)px\)\s*rotateX\(([-\d.]+)deg\)/);
  return {
    avatar: { x: b.left, y: b.top },
    vw: stage.clientWidth, vh: stage.clientHeight,
    W: parseFloat(world.style.width), H: parseFloat(world.style.height),
    tx: tr ? tr[0] : NaN, ty: tr ? tr[1] : NaN, z: tr ? tr[2] : NaN,
    persp: tl ? tl[0] : 0, tilt: tl ? tl[1] : 0,
    hdPending: [...document.querySelectorAll('.world__hd img')].filter((i) => i.dataset.on && !(i.complete && i.naturalWidth > 0 && i.classList.contains('is-loaded'))).length,
    hdOn: [...document.querySelectorAll('.world__hd img')].filter((i) => i.dataset.on).length,
    faceOk: (() => { const f = document.querySelector('.player__face'); return f.complete && f.naturalWidth >= 192; })(),
  };
};

/** נקודה על המסך (CSS px) → מיקום במפה כשבר 0..1 (ההפך של world.project, לנקודה על הקרקע) */
function unproject(st, sx, sy) {
  const a = (st.tilt * Math.PI) / 180;
  const P = st.persp || 1e9;
  const dy = sy - st.vh / 2;
  const Y = (dy * P) / (P * Math.cos(a) + dy * Math.sin(a));
  const s = P / (P - Y * Math.sin(a));
  const X = (sx - st.vw / 2) / s;
  const cx = (st.vw / 2 - st.tx) / st.z;
  const cy = (st.vh / 2 - st.ty) / st.z;
  return { x: (cx + X / st.z) / st.W, y: (cy + Y / st.z) / st.H };
}

/** מחכה שהמצלמה תעמוד ושהאריחים ותמונת הדמות ייטענו: שתי קריאות זהות בהפרש 10 פריימים */
async function settle(cap) {
  let st = await cap.eval(READ_STATE);
  let stable = 0;
  for (let i = 0; i < 40 && stable < 2; i++) {
    await cap.step(10);
    const n = await cap.eval(READ_STATE);
    const same = Math.abs(n.avatar.x - st.avatar.x) < 0.05 && Math.abs(n.avatar.y - st.avatar.y) < 0.05 && n.tx === st.tx && n.ty === st.ty && n.z === st.z && n.tilt === st.tilt && n.hdPending === 0 && n.hdOn === st.hdOn && n.faceOk;
    stable = same ? stable + 1 : 0;
    st = n;
  }
  if (stable < 2) throw new Error(`camera did not settle: ${JSON.stringify(st)}`);
  return st;
}

/**
 * מדליק את אריחי ה-HD המלאים (9048px) באזור של המפה שנכנס לחלון החיתוך.
 * האתר אמור לטעון אותם לבד בזום עמוק במחשב (viewport ברוחב 900 ומעלה), אבל הסף שלו מחושב לפני שתמונת המפה נטענה
 * (world.setHd רץ כש-W עדיין 1), ולכן הרמה המלאה לא נדלקת אף פעם; בתקריב המפה נשארת ברמה הנמוכה ונמרחת.
 * כאן מדליקים את אותם אלמנטים של האתר (אותם קבצים, אותו מיקום), רק את אלה שמתחת לחלון.
 */
const FORCE_HD = ({ area, tiles, grid }) => {
  const size = 100 / grid;
  let n = 0;
  for (const el of document.querySelectorAll('.world__hd .world__tile')) {
    if (Math.abs(parseFloat(el.style.width) - size) > 0.01) continue; // רק הרמה המלאה
    const col = Math.round(parseFloat(el.style.left) / size);
    const row = Math.round(parseFloat(el.style.top) / size);
    if (col / grid > area.x1 || (col + 1) / grid < area.x0 || row / grid > area.y1 || (row + 1) / grid < area.y0) continue;
    if (el.dataset.on) continue;
    el.dataset.on = '1';
    el.src = `./${tiles[row * grid + col]}`;
    n++;
  }
  return n;
};

/**
 * פותח את המפה בעצירה הנוכחית (לא מצולם), סוגר את הפאנל, מחכה שהמצלמה תתייצב, ומחשב את חלון החיתוך.
 * o: { aspect, view: { cssW, cssH, dsf }, anchor: { x, y } – איפה מרכז הדמות בפלט (פיקסלים של הפלט),
 *      mapZoom (זום המפה של האתר, ברירת מחדל 3), css (CSS נוסף לצילום), initScript,
 *      face (קובץ הלוגו של הדמות מתוך icons/, ברירת מחדל oded-192.png) }
 * מחזיר { cap, D, out, win (החלון ב-CSS px), crop (בפיקסלים של הצילום), vf, state, avatar }
 */
async function prepare(o) {
  const out = OUT[o.aspect];
  if (!out) throw new Error(`aspect must be 16x9 or 9x16, got "${o.aspect}"`);
  const D = o.view.dsf;
  const zoomInit = o.mapZoom
    ? `try { const d = JSON.parse(localStorage.getItem('journey-demo-v9')); d.settings = { ...d.settings, map_zoom: ${Number(o.mapZoom)} }; localStorage.setItem('journey-demo-v9', JSON.stringify(d)); } catch {}`
    : '';
  const cap = await open({ url: URL, ...o.view, initScript: `${zoomInit}\n${o.initScript || ''}` });
  try {
    await cap.ready(MAP_READY);
    await cap.css(`${CLEAN_CSS}\n${o.css || ''}`);
    await cap.eval(() => document.querySelector('[data-jump-now]').click());
    await cap.step(75);
    await cap.eval(() => document.querySelector('[data-panel-close]')?.click());
    await cap.step(30);
    // תמונת הדמות ברזולוציה גבוהה (אותו לוגו; 96px היה נמרח בתקריב)
    await cap.eval((file) => {
      const img = document.querySelector('.player__face');
      const hi = new Image();
      hi.onload = () => { img.src = hi.src; };
      hi.src = img.src.replace('oded-96.png', file);
    }, o.face || 'oded-192.png');
    let st = await settle(cap);
    if (!(st.z > 0) || !st.W) throw new Error(`cannot read camera: ${JSON.stringify(st)}`);
    // חלון החיתוך: מרכז הדמות יושב ב-anchor (בפיקסלים של הפלט), בתוך גבולות הצילום
    const capW = Math.round(o.view.cssW * D);
    const capH = Math.round(o.view.cssH * D);
    if (capW < out.w || capH < out.h) throw new Error(`capture ${capW}x${capH} smaller than output ${out.w}x${out.h}`);
    const want = { x: st.avatar.x * D - o.anchor.x, y: st.avatar.y * D - o.anchor.y };
    const crop = { x: Math.round(Math.min(capW - out.w, Math.max(0, want.x))), y: Math.round(Math.min(capH - out.h, Math.max(0, want.y))) };
    const clamped = Math.abs(crop.x - want.x) > 1 || Math.abs(crop.y - want.y) > 1;
    const win = { x: crop.x / D, y: crop.y / D, w: out.w / D, h: out.h / D };
    // אריחי ה-HD המלאים של המפה, רק לאזור שבחלון (ראה FORCE_HD), ואז מחכים שייטענו וייכנסו
    const corners = [[win.x, win.y], [win.x + win.w, win.y], [win.x, win.y + win.h], [win.x + win.w, win.y + win.h]].map(([x, y]) => unproject(st, x, y));
    const area = { x0: Math.min(...corners.map((c) => c.x)) - 0.02, x1: Math.max(...corners.map((c) => c.x)) + 0.02, y0: Math.min(...corners.map((c) => c.y)) - 0.02, y1: Math.max(...corners.map((c) => c.y)) + 0.02 };
    const full = JSON.parse(fs.readFileSync(path.join(DIST, 'map.json'), 'utf8')).hd?.full;
    const forced = full ? await cap.eval(FORCE_HD, { area, tiles: full.tiles, grid: full.grid }) : -1;
    st = await settle(cap);
    await cap.step(16); // האריחים נכנסים בהדרגה (0.5 שנ') אחרי הטעינה
    const ctx = { cap, D, out, win, crop, state: st, avatar: st.avatar, aspect: o.aspect, vf: `crop=${out.w}:${out.h}:${crop.x}:${crop.y}` };
    console.log(`[${o.aspect}] capture ${capW}x${capH} (css ${o.view.cssW}x${o.view.cssH} @${D}), map z=${st.z.toFixed(4)} (${(st.z * D).toFixed(2)} px per map px) tilt=${st.tilt}, hd tiles on=${st.hdOn} (full-res forced: ${forced}), avatar css (${st.avatar.x.toFixed(1)}, ${st.avatar.y.toFixed(1)}), crop ${ctx.vf}${clamped ? ' [CLAMPED – the avatar is not at the requested anchor]' : ''}`);
    ctx.clamped = clamped;
    return ctx;
  } catch (e) {
    await cap.close();
    throw e;
  }
}

/** CSS שמניח שכבה של "מסך מלא" בדיוק על חלון החיתוך */
const boxCss = (sel, win) => `${sel}{inset:auto!important;left:${win.x}px!important;top:${win.y}px!important;width:${win.w}px!important;height:${win.h}px!important}`;

/** מלבן של אלמנט בפיקסלים של הפלט (אחרי החיתוך), לבדיקות מיקום */
async function outRect(ctx, sel) {
  const r = await ctx.cap.eval((s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return b.width || b.height ? [b.left, b.top, b.width, b.height] : null; }, sel);
  if (!r) return null;
  const { D, crop } = ctx;
  return { x: Math.round(r[0] * D - crop.x), y: Math.round(r[1] * D - crop.y), w: Math.round(r[2] * D), h: Math.round(r[3] * D) };
}

/** מצלם את ה-take (מספר הפריימים המדויק מ-timeline.json) לקובץ הביניים, חתוך לגודל הפלט */
async function record(ctx, name, before) {
  const s = slot(name);
  const file = path.join(SCENES, ctx.aspect, `${name}.mkv`);
  await ctx.cap.record(file, s.frames, before, { vf: ctx.vf });
  if (ctx.cap.errors.length) throw new Error(`page errors during ${name} ${ctx.aspect}: ${ctx.cap.errors.join(' | ')}`);
  console.log(`[${ctx.aspect}] ${name}: ${s.frames} frames -> ${file}`);
  return file;
}

/** מריץ סצנה לפי הארגומנט: 16x9 | 9x16 | both */
function main(run) {
  const arg = process.argv[2] || 'both';
  const aspects = arg === 'both' ? ['16x9', '9x16'] : [arg];
  if (!aspects.every((a) => OUT[a])) { console.error('usage: node scenes/<name>.cjs 16x9|9x16|both'); process.exit(2); }
  (async () => { for (const a of aspects) await run(a); })().then(() => process.exit(0), (e) => { console.error('FAIL', e); process.exit(1); });
}

module.exports = { prepare, record, main, boxCss, outRect, unproject, READ_STATE, OUT, CLEAN_CSS, NO_POLL_CSS, SCENES };

// עזרים משותפים לארבע סצנות הטלפון: phone-home, phone-story, phone-reel, phone-stats
// כל הסצנות מצולמות ב-VIEW.phone (360x640 CSS בקנה מידה 3 -> 1080x1920) ונשמרות ב-work/scenes/phone/<name>.mkv
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { open, WORK, VIEW, PHONE_CSS } = require('../lib/harness.cjs');
const { slot } = require('../lib/timeline.cjs');

const OUT = path.join(WORK, 'scenes', 'phone');
const TMP = path.join(WORK, 'tmp', 'phone');
const TAPS = path.join(OUT, 'taps.json');
const DSF = VIEW.phone.dsf; // פיקסל CSS אחד = 3 פיקסלים בפלט
const SIZE = [VIEW.phone.cssW * DSF, VIEW.phone.cssH * DSF]; // 1080x1920
const SCENES = ['phone-home', 'phone-story', 'phone-reel', 'phone-stats'];

/**
 * CSS לצילום בלבד (בנוסף ל-PHONE_CSS של המנגנון):
 * - שורת הסטוריז: בלי scroll-snap. ברוחב 360 ה-snap מצמיד את הטבעת הראשונה לקצה המסך (נראית חתוכה),
 *   וגם לא נותן לגלול את השורה למיקום מדויק. הרווחים והגדלים נשארים כמו באתר.
 * - שורת המשנה בכרטיס הלייב ("סאבתון GTA 6 – יום 3 | 2,140 צופים"): ברוחב 360 חסרים לה 5 פיקסלים והיא נחתכת ל-"2,140 צו…".
 *   חצי פיקסל פחות בגודל הגופן (13 -> 12.5) והיא נכנסת כולה.
 * - הערת "תצוגה מקדימה" בפיד הקליפים: לא מופיעה בטעינה רגילה של הקישור, מוסתרת ליתר ביטחון.
 */
const CSS = `${PHONE_CSS}
.rings{scroll-snap-type:none!important}
.card--live__txt small{font-size:12.5px!important}
.feed__note{display:none!important}`;

// ── מצב הבית: phone-home מסתיימת בו, phone-story מתחילה בדיוק ממנו (חיתוך בלי קפיצה) ──
/** הסטורי שנפתח ב-phone-story: מיילסטון 65. יש לו כותרת, תקציר וציטוט, והשורה "לפני 10 שע'" בראשו נקראת טוב */
const STORY = { stop: 64, title: 'הלילה הארוך', quote: 'עוד ניסיון אחד ואני הולך לישון', label: 'סטורי: הלילה הארוך' };
/** גלילת הבית למטה בסוף phone-home (פיקסלי CSS): הכותרת הגדולה יוצאת, שורת הטבעות נשארת כולה מתחת לבר העליון */
const HOME_SCROLL = 60;

/** הבית מוכן: טבעות, כרטיס "עכשיו" עם צילום מפה, כרטיס לייב ונתוני הלייב (שעות משחק) */
const HOME_READY = () => {
  const q = (s) => document.querySelector(s);
  const play = q('.quick__item--play b');
  const snaps = [...document.querySelectorAll('.ring__pic .snap, .card--now__map .snap')];
  return document.querySelectorAll('.ring').length >= 6 && !!q('.card--live') && !!q('.card--now h2') && !!play && play.textContent !== '–' && !q('[data-live]').hidden
    && snaps.length >= 7 && snaps.every((s) => (s.tagName === 'IMG' ? s.complete && s.naturalWidth > 0 : s.width > 0)) && !!q('.card--now__map .st-pin');
};

/**
 * מודד את שורת הטבעות ומחזיר שתי הזזות אופקיות (פיקסלי CSS; scrollLeft = -ההזזה, כי הדף RTL):
 * x0 – התחלה: ארבע הטבעות הראשונות שלמות, עם שוליים שווים משני הצדדים.
 * x1 – סוף ההחלקה: הטבעת של STORY בדיוק במרכז (שלוש טבעות שלמות, ושתי חצאי טבעות מציצות בצדדים).
 */
const RINGS_GEOMETRY = (label) => {
  const rings = document.querySelector('.rings');
  rings.scrollLeft = 0;
  const pics = [...document.querySelectorAll('.ring')].map((r) => ({ label: r.getAttribute('aria-label'), b: r.querySelector('.ring__pic').getBoundingClientRect() }));
  const target = pics.findIndex((p) => p.label === label);
  if (target < 0 || pics.length < 5) return null;
  const x0 = (innerWidth - pics[0].b.right - pics[3].b.left) / 2;
  const x1 = innerWidth / 2 - (pics[target].b.left + pics[target].b.right) / 2;
  return { x0, x1, target, pitch: pics[0].b.left - pics[1].b.left, max: rings.scrollWidth - rings.clientWidth };
};

/** מציב את הבית: גלילה אנכית y וגלילת הטבעות x (מיידי, בלי אנימציית גלילה של הדפדפן) */
const SET_HOME = ({ x, y }) => {
  const home = document.querySelector('#view-home');
  if (y != null) home.scrollTo({ top: y, behavior: 'instant' });
  if (x != null) document.querySelector('.rings').scrollTo({ left: -x, behavior: 'instant' });
};

/** מלבנים (פיקסלי פלט) של הבר העליון, הטבעות והכרטיסים – לבדיקה שכלום לא עולה על כלום ולא נחתך */
const HOME_STATE = () => {
  const b = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map((v) => Math.round(v * devicePixelRatio)); };
  const q = (s) => document.querySelector(s);
  const view = q('#view-home').getBoundingClientRect();
  return {
    name: q('.bar__name').textContent, nameBox: b(q('.bar__name')), logoBox: b(q('.bar__logo')), liveBox: b(q('[data-live]')), liveTxt: q('[data-live]').textContent,
    installShown: getComputedStyle(q('.bar__install')).display !== 'none',
    hello: q('.hello').textContent, liveCard: q('.card--live').innerText.replace(/\n/g, ' / '), liveCardBox: b(q('.card--live')),
    liveSubFits: q('.card--live__txt small').scrollWidth <= q('.card--live__txt small').clientWidth,
    eyebrow: q('.card--now .eyebrow').textContent, now: q('.card--now h2').textContent, nowBox: b(q('.card--now h2')), mapBox: b(q('.card--now__map')),
    scrollTop: q('#view-home').scrollTop, ringsLeft: q('.rings').scrollLeft, viewBox: [view.left, view.top, view.right, view.bottom].map((v) => Math.round(v * devicePixelRatio)),
    rings: [...document.querySelectorAll('.ring')].map((r) => ({ label: r.getAttribute('aria-label'), box: b(r.querySelector('.ring__pic')), nameBox: b(r.querySelector('.ring__name')) })),
    dir: getComputedStyle(document.documentElement).direction, font: getComputedStyle(document.body).fontFamily, rubik: document.fonts.check("800 18px 'Rubik'"),
    frame: [Math.round(innerWidth * devicePixelRatio), Math.round(innerHeight * devicePixelRatio)],
  };
};

// ── עקומות תנועה ──
const clamp01 = (t) => Math.max(0, Math.min(1, t));
/** גלילה רכה: מתחילה ונגמרת לאט */
const easeInOut = (t) => { t = clamp01(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
/** החלקת אצבע: יוצאת מהר ונעצרת בהדרגה */
function bezier(x1, y1, x2, y2) {
  const f = (a, b, s) => 3 * a * (1 - s) * (1 - s) * s + 3 * b * (1 - s) * s * s + s * s * s;
  return (x) => {
    x = clamp01(x);
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (f(x1, x2, mid) < x) lo = mid; else hi = mid; }
    return f(y1, y2, (lo + hi) / 2);
  };
}
const swipe = bezier(0.3, 0.0, 0.15, 1);

function probe(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames,width,height,r_frame_rate,pix_fmt', '-of', 'json', file], { encoding: 'utf8' });
  const s = JSON.parse(out).streams[0];
  return { frames: Number(s.nb_read_frames), w: s.width, h: s.height, fps: s.r_frame_rate, pix: s.pix_fmt };
}

/** בודק שהקובץ הוא בדיוק מה שהחוזה דורש: מספר פריימים, 1080x1920 ו-30fps */
function verify(file, frames) {
  const p = probe(file);
  if (p.frames !== frames || p.w !== SIZE[0] || p.h !== SIZE[1] || p.fps !== '30/1') throw new Error(`bad take ${file}: ${JSON.stringify(p)} (expected ${frames} frames, ${SIZE[0]}x${SIZE[1]}, 30/1)`);
  console.log(`ok ${path.relative(path.join(WORK, '..'), file)}: ${p.frames} frames, ${p.w}x${p.h}, ${p.fps} fps, ${p.pix}`);
  return p;
}

function assert(cond, msg) {
  if (!cond) throw new Error(`assert: ${msg}`);
}

/** שומר לחיצה ב-taps.json (רשומה אחת לכל סצנה; סצנות אחרות נשארות). x,y בפיקסלי פלט 1080x1920, frame יחסי לתחילת הסצנה */
function saveTap(tap) {
  fs.mkdirSync(OUT, { recursive: true });
  let list = [];
  try {
    const cur = JSON.parse(fs.readFileSync(TAPS, 'utf8'));
    if (Array.isArray(cur)) list = cur;
  } catch {
    /* עוד אין קובץ */
  }
  const rec = { scene: tap.scene, frame: tap.frame, x: Math.round(tap.x), y: Math.round(tap.y) };
  assert(SCENES.includes(rec.scene) && Number.isInteger(rec.frame) && rec.frame >= 0 && rec.frame < slot(rec.scene).frames, `bad tap ${JSON.stringify(rec)}`);
  assert(rec.x >= 0 && rec.x <= SIZE[0] && rec.y >= 0 && rec.y <= SIZE[1], `tap outside the frame ${JSON.stringify(rec)}`);
  list = list.filter((t) => t && t.scene !== rec.scene).concat(rec).sort((a, b) => SCENES.indexOf(a.scene) - SCENES.indexOf(b.scene));
  const tmp = `${TAPS}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `[\n${list.map((t) => `  ${JSON.stringify(t)}`).join(',\n')}\n]\n`);
  fs.renameSync(tmp, TAPS);
  console.log(`tap ${JSON.stringify(rec)} -> ${path.relative(path.join(WORK, '..'), TAPS)}`);
  return rec;
}

/** מריץ סצנה אחת: פותח דף טלפון, מריץ את take(cap, s, out), בודק שגיאות דף ומספר פריימים. לא משאיר קובץ חלקי ותמיד סוגר את הדפדפן */
function main(name, openOpts, take) {
  const s = slot(name);
  const out = path.join(OUT, `${name}.mkv`);
  (async () => {
    const cap = await open({ ...VIEW.phone, ...openOpts });
    try {
      const after = await take(cap, s, out);
      assert(!cap.errors.length, `page errors: ${cap.errors.join(' | ')}`);
      verify(out, s.frames);
      if (after) await after();
    } catch (e) {
      fs.rmSync(out, { force: true });
      throw e;
    } finally {
      await cap.close();
    }
  })().catch((e) => {
    console.error(`FAIL ${name}:`, e);
    process.exit(1);
  });
}

module.exports = { OUT, TMP, TAPS, DSF, SIZE, CSS, STORY, HOME_SCROLL, HOME_READY, RINGS_GEOMETRY, SET_HOME, HOME_STATE, easeInOut, swipe, bezier, probe, verify, assert, saveTap, main, fs, path };

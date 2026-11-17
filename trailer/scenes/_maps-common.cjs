// עזרים משותפים לשלוש סצנות המפה: map-title, map-journey, milestone
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { WORK } = require('../lib/harness.cjs');

const TMP = path.join(WORK, 'tmp', 'maps');
const SIZE = { '16x9': [1920, 1080], '9x16': [1080, 1920] };

/**
 * כרטיס הפתיחה של האתר מוסתר, והמפה במבט הכללי ממורכזת בדיוק.
 * מצלמת המבט הכללי נגזרת מהמלבן של הכרטיס (free.x0 = rect.right + 16), ולכן במקום display:none
 * הכרטיס "חונה" מחוץ למסך עם right = -16: כך השטח הפנוי הוא כל המסך והמפה יושבת בדיוק במרכז.
 */
const OPENING_OFF = `.opening{display:block!important;position:fixed!important;visibility:hidden!important;pointer-events:none!important;left:-416px!important;right:auto!important;top:0!important;bottom:auto!important;width:400px!important;height:10px!important;min-height:0!important;margin:0!important;padding:0!important;border:0!important;box-sizing:border-box!important;overflow:hidden!important}`;

/** main.ts: אירוע resize קורא ל-frame(true) – מחשב מחדש את המצלמה (במבט הכללי frame() לא רץ כשהכול עומד) */
const RECENTER = () => window.dispatchEvent(new Event('resize'));

/** מצב המסע בדף. shown = המיקום המוחלק של המצלמה (באינדקס עצירות), נקרא מהסמן של פס ההתקדמות (מתעדכן גם כשהפס מוסתר) */
const STATE = () => {
  const pct = parseFloat(document.querySelector('[data-progress-now]').style.insetInlineStart);
  const n = document.querySelectorAll('.pin').length;
  const panel = document.querySelector('.panel');
  const near = document.querySelector('.pin--near');
  const stage = document.querySelector('.journey__stage');
  const cam = (document.querySelector('.world').style.transform.match(/translate3d\(([-\d.]+)px, ([-\d.]+)px/) || []).slice(1).map(Number);
  return {
    cam, // ההזזה של שכבת המפה בפיקסלי CSS: מרכז המסך פחות מיקום המצלמה כפול הזום (לבדיקת חלקות התנועה)
    shown: +((pct / 100) * (n + 1) - 1).toFixed(4),
    panelOpen: !panel.hidden || panel.hasAttribute('data-open'),
    panelCls: panel.className,
    odo: document.querySelector('[data-odo-stop]').textContent,
    near: near ? [...document.querySelectorAll('.pin')].indexOf(near) : -1,
    tod: stage.dataset.tod,
    overview: stage.classList.contains('is-overview'),
    hud: document.querySelector('.hud').classList.contains('is-on'),
    onair: !!document.querySelector('.onair') && getComputedStyle(document.querySelector('.onair')).display !== 'none',
  };
};

function probe(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames,width,height,r_frame_rate,pix_fmt', '-of', 'json', file], { encoding: 'utf8' });
  const s = JSON.parse(out).streams[0];
  return { frames: Number(s.nb_read_frames), w: s.width, h: s.height, fps: s.r_frame_rate, pix: s.pix_fmt };
}

/** בודק שהקובץ שנוצר הוא בדיוק מה שהחוזה דורש: מספר פריימים, גודל ו-30fps */
function verify(file, frames, aspect) {
  const p = probe(file);
  const [w, h] = SIZE[aspect];
  if (p.frames !== frames || p.w !== w || p.h !== h || p.fps !== '30/1') throw new Error(`bad take ${file}: ${JSON.stringify(p)} (expected ${frames} frames, ${w}x${h}, 30/1)`);
  console.log(`ok ${path.relative(path.join(WORK, '..'), file)}: ${p.frames} frames, ${p.w}x${p.h}, ${p.fps} fps, ${p.pix}`);
  return p;
}

function assert(cond, msg) {
  if (!cond) throw new Error(`assert: ${msg}`);
}

/** מריץ את הסצנה ליחס אחד או לשניהם, אחד אחרי השני (משבצת צילום אחת בכל רגע) */
function main(name, run) {
  const arg = process.argv[2] || 'both';
  const list = arg === 'both' ? ['16x9', '9x16'] : [arg];
  if (list.some((a) => !SIZE[a])) {
    console.error(`usage: node scenes/${name}.cjs 16x9|9x16|both`);
    process.exit(2);
  }
  (async () => {
    for (const a of list) await run(a);
  })().catch((e) => {
    console.error(`FAIL ${name}:`, e);
    process.exit(1);
  });
}

module.exports = { TMP, SIZE, OPENING_OFF, RECENTER, STATE, probe, verify, assert, main, fs, path };

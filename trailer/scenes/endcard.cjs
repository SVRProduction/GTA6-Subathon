// endcard: המפה בלילה עם כל הפנסים, מבט כללי ממורכז, התקרבות איטית מאוד – הרקע למסך הסיום (169 פריימים).
// node scenes/endcard.cjs 16x9|9x16|both
//
// אותה שיטה כמו map-title: המצלמה של האתר עומדת (הסירות, העננים, המים והניאון זזים לבד), הצילום גדול מהפלט,
// וכל פריים נחתך ומוקטן עם חלון צף (PIL, Lanczos). ההתקרבות חלקה ברמת תת-פיקסל, בלי שוליים שחורים, והתמונה תמיד מוקטנת – חדה עד הפריים האחרון.
const { spawn } = require('child_process');
const { open, WORK, MAP_CSS, MAP_READY } = require('../lib/harness.cjs');
const { slot } = require('../lib/timeline.cjs');
const { SIZE, OPENING_OFF, RECENTER, verify, assert, main, fs, path } = require('./_maps-common.cjs');

const NAME = 'endcard';
const TMP = path.join(WORK, 'tmp', 'tod-endcard');
// התקרבות של 7% על פני כל הסצנה, בקצב קבוע (מסך הסיום נשאר "חי" עד הפריים האחרון).
// ב-16x9 המפה במבט הכללי תופסת 94% מגובה הפריים; ב-8% הפנסים של האי הדרומי כבר נוגעים בקצה התחתון בפריים האחרון.
const ZOOM = 1.07;
// צילום ב-2560x1440 / 1440x2560 (פי 1.333 מהפלט): אותה פריסה כמו VIEW.map16 / VIEW.map9, רק עם יותר פיקסלים
const CAPTURE = { '16x9': { cssW: 1280, cssH: 720, dsf: 2 }, '9x16': { cssW: 864, cssH: 1536, dsf: 5 / 3 } };
// נקי: בלי כרטיס הפתיחה, ה-HUD, תג הלייב, התווית שבסוף הקו והכרטיסים הקטנים של הסיכות.
// גם כרטיס הסקר והקו המקווקו אליו מוסתרים: הם יושבים בדיוק מתחת לכותרת של מסך הסיום. הסיכות הזהובות, המסלול והדמות של עודד נשארים.
const CSS = `${MAP_CSS}
.hud,.onair,.ahead-tag,.pin__card,.mk--poll,.poll-line{display:none!important}
${OPENING_OFF}`;

/** מצב הדף לפני הצילום (ולבדיקה אחריו) */
const STATE = () => {
  const m = document.querySelector('.world__map').getBoundingClientRect();
  const stage = document.querySelector('.journey__stage');
  const lamps = [...document.querySelectorAll('.lamps circle')].map((c) => Number(getComputedStyle(c).opacity));
  return {
    map: { x: m.left, y: m.top, w: m.width, h: m.height },
    dx: (m.left + m.right) / 2 - innerWidth / 2,
    dy: (m.top + m.bottom) / 2 - innerHeight / 2,
    tod: stage.dataset.tod,
    dark: Number(stage.style.getPropertyValue('--dark')),
    overview: stage.classList.contains('is-overview'),
    tilt: document.querySelector('.tilt').style.transform,
    tint: Number(getComputedStyle(document.querySelector('.world > .tod__tint')).opacity),
    lamps: lamps.length,
    lampsDim: lamps.filter((o) => o < 0.8).length,
    pins: [...document.querySelectorAll('.pin')].filter((p) => !p.hidden && getComputedStyle(p).display !== 'none').length,
    player: getComputedStyle(document.querySelector('.player')).display !== 'none',
    panel: !document.querySelector('.panel').hidden,
    boats: [...document.querySelectorAll('.life > .boat')].filter((b) => !b.hidden).map((b) => b.style.transform).join(';'),
    ms: performance.now(),
  };
};

// חיתוך והקטנה עם חלון צף, ואז קידוד באותו פורמט ביניים ש-cap.record מייצר
const PUSH_IN = `
import subprocess, sys
from PIL import Image
src, out, n, ow, oh, zoom = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5]), float(sys.argv[6])
ff = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '%dx%d' % (ow, oh), '-framerate', '30', '-i', '-',
                       '-frames:v', str(n), '-c:v', 'libx264rgb', '-crf', '10', '-preset', 'veryfast', '-g', '15', out], stdin=subprocess.PIPE)
for i in range(n):
    im = Image.open('%s/%05d.png' % (src, i)).convert('RGB')
    W, H = im.size
    s = zoom ** (i / (n - 1.0))          # קצב קבוע (מעריכי): 1.0 בפריים הראשון, zoom באחרון
    bw, bh = W / s, H / s                 # החלון במקור, סביב המרכז, בקואורדינטות צפות
    assert bw >= ow and bh >= oh, 'window smaller than output: would upscale'
    box = ((W - bw) / 2.0, (H - bh) / 2.0, (W + bw) / 2.0, (H + bh) / 2.0)
    ff.stdin.write(im.resize((ow, oh), Image.LANCZOS, box=box).tobytes())
ff.stdin.close()
sys.exit(ff.wait())
`;

function pushIn(src, out, n, [ow, oh]) {
  return new Promise((resolve, reject) => {
    const p = spawn('python3', ['-c', PUSH_IN, src, out, String(n), String(ow), String(oh), String(ZOOM)], { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`push-in (python3 + Pillow) exit ${code}`))));
  });
}

async function run(aspect) {
  const s = slot(NAME);
  const out = path.join(WORK, 'scenes', aspect, `${NAME}.mkv`);
  const seq = path.join(TMP, `${NAME}-${aspect}-png`);
  fs.rmSync(seq, { recursive: true, force: true });
  const cap = await open({ url: '/?demo&time=21', ...CAPTURE[aspect] });
  try {
    await cap.ready(MAP_READY);
    await cap.css(CSS);
    await cap.eval(RECENTER);
    await cap.step(20);
    const pre = await cap.eval(STATE);
    // זוהר הניאון של הלילה מוגדר באתר באחוזים מהמסך; במבט הכללי המפה תופסת רק חלק ממנו (ב-16x9 פחות מחצי מהרוחב),
    // ואחד הכתמים יוצא על הים הפתוח. כאן השכבה מונחת בדיוק על מלבן המפה, כך שהזוהר יושב על העיר בשני הפורמטים.
    await cap.css(`.tod__neon{inset:auto!important;left:${pre.map.x.toFixed(1)}px!important;top:${pre.map.y.toFixed(1)}px!important;width:${pre.map.w.toFixed(1)}px!important;height:${pre.map.h.toFixed(1)}px!important}`);
    await cap.step(4);
    const st = await cap.eval(STATE);
    console.log(`${NAME} ${aspect}: ${JSON.stringify({ ...st, boats: undefined })}`);
    assert(Math.abs(st.dx) < 1 && Math.abs(st.dy) < 1, 'map is not centred');
    assert(st.tod === 'night' && st.dark === 1 && st.tint === 1 && st.overview && !st.tilt && !st.panel, 'not the flat night overview');
    assert(st.lamps > 100 && st.lampsDim === 0, `street lamps are not all lit (${st.lampsDim} of ${st.lamps} dim)`);
    assert(st.pins >= 9 && st.player, 'milestone pins / avatar missing');
    assert(cap.outW >= SIZE[aspect][0] * ZOOM && cap.outH >= SIZE[aspect][1] * ZOOM, 'capture too small for the push-in');
    await cap.record('', s.frames, null, { png: seq });
    const end = await cap.eval(STATE);
    assert(end.tod === 'night' && end.dark === 1 && end.lampsDim === 0 && end.overview, 'the night look changed during the take');
    assert(end.map.x === st.map.x && end.map.y === st.map.y && end.map.w === st.map.w, 'the site camera moved during the take');
    assert(end.boats !== st.boats, 'boats did not move: ambient life is frozen');
    assert(!cap.errors.length, `page errors: ${cap.errors.join(' | ')}`);
  } finally {
    await cap.close();
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await pushIn(seq, out, s.frames, SIZE[aspect]);
  verify(out, s.frames, aspect);
  fs.rmSync(seq, { recursive: true, force: true });
}

main(NAME, run);

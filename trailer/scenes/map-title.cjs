// map-title: המפה בשקיעה, מבט כללי, התקרבות איטית – הרקע לכרטיס הכותרת.
// node scenes/map-title.cjs 16x9|9x16|both
//
// איך ההתקרבות עשויה: המצלמה של האתר עומדת (הסירות, העננים והמים זזים לבד), הצילום נעשה גדול מהפלט,
// ואז כל פריים נחתך ומוקטן עם חלון צף (PIL, Lanczos) – כך ההתקרבות חלקה ברמת תת-פיקסל, אין שוליים שחורים,
// והתמונה תמיד מוקטנת (אף פעם לא מוגדלת) ולכן חדה מהפריים הראשון עד האחרון.
// (scale ב-CSS על הבמה נבדק ונפסל: כרום מותח את השכבה שכבר צוירה, והפריים האחרון יוצא רך.)
const { spawn } = require('child_process');
const { open, WORK, MAP_CSS, MAP_READY } = require('../lib/harness.cjs');
const { slot } = require('../lib/timeline.cjs');
const { TMP, SIZE, OPENING_OFF, RECENTER, verify, assert, main, fs, path } = require('./_maps-common.cjs');

const NAME = 'map-title';
const ZOOM = 1.1; // התקרבות של 10% לאורך הסצנה, בקצב קבוע (הסצנה נחתכת בשני הקצוות, אז בלי האטה)
// צילום ב-2560x1440 / 1440x2560 (פי 1.333 מהפלט): אותה פריסה בדיוק כמו VIEW.map16 / VIEW.map9, רק עם יותר פיקסלים
const CAPTURE = { '16x9': { cssW: 1280, cssH: 720, dsf: 2 }, '9x16': { cssW: 864, cssH: 1536, dsf: 5 / 3 } };
// נקי: בלי כרטיס הפתיחה, ה-HUD, תג הלייב והתווית שבסוף הקו. גם כרטיס הסקר והקו המקווקו אליו מוסתרים:
// הכרטיס יושב בקצה העליון של המסך, נחתך בהתקרבות ומתחרה בכותרת. הסיכות, המסלול והדמות של עודד נשארים.
const CSS = `${MAP_CSS}
.hud,.onair,.ahead-tag,.mk--poll,.poll-line{display:none!important}
${OPENING_OFF}`;

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
  const cap = await open({ url: '/?demo&time=18', ...CAPTURE[aspect] });
  try {
    await cap.ready(MAP_READY);
    await cap.css(CSS);
    await cap.eval(RECENTER);
    await cap.step(20);
    const st = await cap.eval(() => {
      const m = document.querySelector('.world__map').getBoundingClientRect();
      const stage = document.querySelector('.journey__stage');
      return {
        dx: (m.left + m.right) / 2 - innerWidth / 2,
        dy: (m.top + m.bottom) / 2 - innerHeight / 2,
        mapH: m.height / innerHeight,
        mapW: m.width / innerWidth,
        tod: stage.dataset.tod,
        overview: stage.classList.contains('is-overview'),
        tilt: document.querySelector('.tilt').style.transform,
        pins: [...document.querySelectorAll('.pin')].filter((p) => !p.hidden && getComputedStyle(p).display !== 'none').length,
        player: getComputedStyle(document.querySelector('.player')).display !== 'none',
        panel: !document.querySelector('.panel').hidden,
      };
    });
    console.log(`${NAME} ${aspect}: ${JSON.stringify(st)}`);
    assert(Math.abs(st.dx) < 1 && Math.abs(st.dy) < 1, 'map is not centred');
    assert(st.tod === 'sunset' && st.overview && !st.tilt && !st.panel, 'not the flat sunset overview');
    assert(st.pins >= 9 && st.player, 'milestone pins / avatar missing');
    assert(cap.outW >= SIZE[aspect][0] * ZOOM && cap.outH >= SIZE[aspect][1] * ZOOM, 'capture too small for the push-in');
    await cap.record('', s.frames, null, { png: seq });
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

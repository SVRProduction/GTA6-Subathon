// tod (169 פריימים = 3 תיבות): אותו פריים בדיוק ביום, בשקיעה ובלילה – והפנסים נדלקים אחד-אחד.
// node scenes/tod.cjs 16x9|9x16|both      (TOD_SUNSET / TOD_NIGHT = הפריים שבו מתחלף השלב, ברירת מחדל 56 ו-113)
//
// המצלמה עומדת מעל העיר הצפופה (עצירה 36, מפה מוטה בתלת-ממד); הסירות, העננים, המים והשחפים ממשיכים לזוז.
// המראה נשלט ידנית בכל פריים: stage.dataset.tod ו-‎--dark. גוון הרקע מתחלף מיד בפריים של החלפת השלב
// (שכבת הכתוביות מוסיפה שם הבזק לבן), והפנסים נדלקים לפי ‎--dark: לכל פנס סף משלו, אז עלייה קבועה מדליקה אותם בקצב אחיד.
const { open, WORK, DIST, VIEW, MAP_CSS, MAP_READY, WHEEL } = require('../lib/harness.cjs');
const { slot } = require('../lib/timeline.cjs');
const { verify, assert, main, fs, path } = require('./_maps-common.cjs');

const NAME = 'tod';
const SUNSET_AT = Number(process.env.TOD_SUNSET || 56); // פריימים 0-55 יום
const NIGHT_AT = Number(process.env.TOD_NIGHT || 113); // 56-112 שקיעה, 113-168 לילה
const RAMP = 42; // על פני כמה פריימים ‎--dark עולה בלילה מ-0.3 ל-1.0 (אחר כך כל הפנסים דולקים עד סוף הסצנה)
// הפריים: עצירה 36 (מרכז העיר, הנמל והאיים). ב-16x9 זום המפה 4 במקום 3: בזום 3 חצי מהפריים ים פתוח והפנסים קטנים;
// בזום 4 העיר ממלאת את הפריים, בקנה מידה דומה לזה של 9x16 (שם זום 3 כבר ממלא את הרוחב).
const FRAMING = { '16x9': { stop: 36, mapZoom: 4 }, '9x16': { stop: 36, mapZoom: 0 } };

// נקי: בלי HUD, תג הלייב, התווית שבסוף הקו והכרטיס הקטן של הסיכה; גם סיכת הסקר והקו המקווקו אליה (יוצא מהפריים באמצע).
// המעברים של האתר איטיים מדי לקצב הזה (גוון 4 שנ', פנסים 2.5 שנ') – מקוצרים לצילום.
const CSS = `${MAP_CSS}
.hud,.onair,.ahead-tag,.pin__card,.mk--poll,.poll-line{display:none!important}
.tod i,.world > .tod__tint{transition:opacity .45s ease!important}
.lamps circle{transition:opacity .45s ease!important}`;

/** המראה של פריים i: יום; שקיעה (‎--dark עולה לאט 0.12→0.2, רק הפנסים הראשונים); לילה (0.3→1.0 על פני RAMP פריימים, ואז נשאר) */
function look(i) {
  if (i < SUNSET_AT) return { tod: 'day', dark: 0 };
  if (i < NIGHT_AT) return { tod: 'sunset', dark: 0.12 + (0.08 * (i - SUNSET_AT)) / (NIGHT_AT - 1 - SUNSET_AT) };
  return { tod: 'night', dark: Math.min(1, 0.3 + (0.7 * (i - NIGHT_AT)) / RAMP) };
}
const SET_LOOK = ({ tod, dark }) => {
  const stage = document.querySelector('.journey__stage');
  if (stage.dataset.tod !== tod) stage.dataset.tod = tod;
  stage.style.setProperty('--dark', dark.toFixed(4));
};

/**
 * אריחי ה-HD של האתר (רמת lite, 4524px): האתר מדליק אותם רק כשהזום כפול ה-DPR עובר 0.9 – ב-9x16 (0.896) זה לא קורה,
 * והחלק הקרוב של המפה המוטה (שמוגדל בפרספקטיבה) יוצא רך. כאן מדליקים את אותם אלמנטים של האתר, עם אותם קבצים.
 */
const FORCE_HD = ({ tiles, grid }) => {
  const size = 100 / grid;
  let n = 0;
  for (const el of document.querySelectorAll('.world__hd .world__tile')) {
    if (Math.abs(parseFloat(el.style.width) - size) > 0.01 || el.dataset.on) continue; // רק הרמה הזאת, ורק מה שעוד לא דולק
    const col = Math.round(parseFloat(el.style.left) / size);
    const row = Math.round(parseFloat(el.style.top) / size);
    el.dataset.on = '1';
    el.src = `./${tiles[row * grid + col]}`;
    n++;
  }
  return n;
};

/** מצב המצלמה, המראה והפנסים. lit = כמה מהפנסים שבתוך הפריים דולקים כרגע (אטימות מעל 0.5) */
const STATE = () => {
  const stage = document.querySelector('.journey__stage');
  const near = document.querySelector('.pin--near');
  const panel = document.querySelector('.panel');
  const hd = [...document.querySelectorAll('.world__hd img')].filter((i) => i.dataset.on);
  if (!window.__todLamps) {
    window.__todLamps = [...document.querySelectorAll('.lamps circle')].filter((c) => {
      const r = c.getBoundingClientRect();
      const x = (r.left + r.right) / 2;
      const y = (r.top + r.bottom) / 2;
      return x >= 0 && x <= innerWidth && y >= 0 && y <= innerHeight;
    });
  }
  return {
    world: document.querySelector('.world').style.transform,
    tilt: document.querySelector('.tilt').style.transform,
    near: near ? [...document.querySelectorAll('.pin')].indexOf(near) : -1,
    panelOpen: !panel.hidden || panel.hasAttribute('data-open'),
    tod: stage.dataset.tod,
    dark: Number(stage.style.getPropertyValue('--dark')),
    tint: getComputedStyle(document.querySelector('.world > .tod__tint')).backgroundImage.slice(0, 60),
    hdOn: hd.length,
    hdPending: hd.filter((i) => !(i.complete && i.naturalWidth > 0 && i.classList.contains('is-loaded'))).length,
    lamps: window.__todLamps.length,
    lit: window.__todLamps.filter((c) => Number(getComputedStyle(c).opacity) > 0.5).length,
    boats: [...document.querySelectorAll('.life > .boat')].filter((b) => !b.hidden).map((b) => b.style.transform).join(';'),
    ms: performance.now(),
  };
};

async function run(aspect) {
  const s = slot(NAME);
  const F = FRAMING[aspect];
  const out = path.join(WORK, 'scenes', aspect, `${NAME}.mkv`);
  assert(SUNSET_AT > 0 && SUNSET_AT < NIGHT_AT && NIGHT_AT + RAMP < s.frames, 'bad phase frames');
  const zoomInit = F.mapZoom
    ? `try { const d = JSON.parse(localStorage.getItem('journey-demo-v9')); d.settings = { ...d.settings, map_zoom: ${Number(F.mapZoom)} }; localStorage.setItem('journey-demo-v9', JSON.stringify(d)); } catch {}`
    : '';
  const cap = await open({ url: '/?demo&time=12', ...(aspect === '16x9' ? VIEW.map16 : VIEW.map9), initScript: zoomInit });
  try {
    await cap.ready(MAP_READY);
    await cap.css(CSS);
    // לחיצה אחת על כפתור הסגירה מסמנת "הצופה סגר": הפאנל הצדדי לא נפתח כשמגיעים לעצירה
    await cap.eval(() => document.querySelector('[data-panel-close]').click());
    await cap.eval(WHEEL, -300 * F.stop); // מהמבט הכללי (‎-1) ישר לעצירה F.stop
    await cap.step(90);
    const lite = JSON.parse(fs.readFileSync(path.join(DIST, 'map.json'), 'utf8')).hd?.lite;
    assert(lite, 'dist/map.json has no hd.lite tiles');
    const forced = await cap.eval(FORCE_HD, lite);
    // מחכים שהמצלמה תעמוד ושהאריחים ייטענו: שתי קריאות זהות בהפרש 10 פריימים, ואז עוד 20 פריימים (האריחים נכנסים בדהייה)
    let st = await cap.eval(STATE);
    let stable = 0;
    for (let i = 0; i < 40 && stable < 2; i++) {
      await cap.step(10);
      const n = await cap.eval(STATE);
      stable = n.world === st.world && n.tilt === st.tilt && n.hdPending === 0 && n.hdOn === st.hdOn ? stable + 1 : 0;
      st = n;
    }
    assert(stable >= 2, `camera / map tiles did not settle: ${JSON.stringify({ ...st, boats: undefined })}`);
    await cap.eval(SET_LOOK, look(0));
    await cap.step(20);
    const pre = await cap.eval(STATE);
    console.log(`${NAME} ${aspect} pre (hd tiles forced: ${forced}): ${JSON.stringify({ ...pre, boats: undefined })}`);
    assert(pre.near === F.stop - 1 && !pre.panelOpen, `not parked on stop ${F.stop} with the panel closed`);
    assert(/rotateX\(40(\.0+)?deg\)/.test(pre.tilt), `map is not tilted 40deg: "${pre.tilt}"`);
    assert(pre.tod === 'day' && pre.dark === 0 && pre.lit === 0, 'not a clean daylight start');
    assert(pre.hdOn >= lite.tiles.length && pre.hdPending === 0, 'HD map tiles are not loaded');
    assert(pre.lamps > 250, `only ${pre.lamps} street lamps in the frame`);

    const log = []; // המצב אחרי כל פריים
    await cap.record(out, s.frames, async (i) => {
      if (i > 0) log.push(await cap.eval(STATE));
      await cap.eval(SET_LOOK, look(i));
    });
    log.push(await cap.eval(STATE));
    const end = log[s.frames - 1];
    const lit = log.map((x) => x.lit);
    const at = (i) => `f${i}=${lit[i]}`;
    console.log(`${NAME} ${aspect} lamps lit (of ${pre.lamps} in frame): ${[0, SUNSET_AT - 1, SUNSET_AT, SUNSET_AT + 28, NIGHT_AT - 1, NIGHT_AT, NIGHT_AT + 6, NIGHT_AT + 12, NIGHT_AT + 18, NIGHT_AT + 24, NIGHT_AT + 30, NIGHT_AT + 36, NIGHT_AT + 42, NIGHT_AT + 48, s.frames - 1].map(at).join(' ')}`);
    console.log(`${NAME} ${aspect} phases: f${SUNSET_AT - 1}=${log[SUNSET_AT - 1].tod} f${SUNSET_AT}=${log[SUNSET_AT].tod} (${log[SUNSET_AT].tint}) f${NIGHT_AT - 1}=${log[NIGHT_AT - 1].tod} f${NIGHT_AT}=${log[NIGHT_AT].tod} (${log[NIGHT_AT].tint}); virtual time at the end ${(end.ms / 1000).toFixed(1)}s`);
    // השלבים מתחלפים בדיוק בפריימים שנקבעו
    log.forEach((x, i) => assert(x.tod === look(i).tod && Math.abs(x.dark - look(i).dark) < 1e-3, `frame ${i}: look is ${x.tod}/${x.dark}, expected ${JSON.stringify(look(i))}`));
    // המצלמה לא זזה, והחיים שמסביב כן
    assert(log.every((x) => x.world === pre.world && x.tilt === pre.tilt && !x.panelOpen), 'the camera moved (or the panel opened) during the take');
    assert(log[SUNSET_AT - 1].boats !== pre.boats && end.boats !== log[NIGHT_AT].boats, 'boats did not move: ambient life is frozen');
    // יום: אף פנס. שקיעה: רק הראשונים. לילה: נדלקים בהדרגה, וכולם דולקים לפני הסוף
    assert(lit.slice(0, SUNSET_AT).every((n) => n === 0), 'lamps lit in daylight');
    assert(lit[NIGHT_AT - 1] > 0 && lit[NIGHT_AT - 1] < 0.25 * pre.lamps, `sunset should end with only the first few lamps on, got ${lit[NIGHT_AT - 1]} of ${pre.lamps}`);
    for (let i = NIGHT_AT; i < s.frames; i++) assert(lit[i] >= lit[i - 1], `lamps went out at frame ${i}`);
    assert(lit[NIGHT_AT + 12] < 0.6 * pre.lamps && lit[NIGHT_AT + 24] > lit[NIGHT_AT + 12] && lit[NIGHT_AT + 36] > lit[NIGHT_AT + 24], 'lamps did not come on gradually');
    assert(lit[s.frames - 6] === pre.lamps && end.lit === pre.lamps, `not all lamps are lit at the end (${end.lit} of ${pre.lamps})`);
    // setInterval של האתר (כל 60 שנ') מחזיר את המראה לפי השעה שבכתובת; כל ה-take חייב להיגמר לפניו
    assert(end.ms < 55000, `take ran ${(end.ms / 1000).toFixed(1)}s of virtual time (limit 55s)`);
    assert(!cap.errors.length, `page errors: ${cap.errors.join(' | ')}`);
  } catch (e) {
    fs.rmSync(out, { force: true }); // לא משאירים קובץ חלקי
    throw e;
  } finally {
    await cap.close();
  }
  verify(out, s.frames, aspect);
}

main(NAME, run);

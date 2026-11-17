// map-journey: צלילה מהמבט הכללי למפה המוטה בתלת-ממד (פריימים 0-55), ואז נסיעה רציפה לאורך המסלול (56-168).
// node scenes/map-journey.cjs 16x9|9x16|both      (LIFT=0 מבטל את הרמת המצלמה ב-9x16, NARROW=0 מבטל את הבמה הצרה ב-16x9)
const { open, WORK, VIEW, MAP_CSS, MAP_READY, WHEEL } = require('../lib/harness.cjs');
const { slot } = require('../lib/timeline.cjs');
const { OPENING_OFF, RECENTER, STATE, verify, assert, main, fs, path } = require('./_maps-common.cjs');

const NAME = 'map-journey';
const DIVE = 56; // פריימים 0-55: הצלילה (לחיצה על "מתחילים מההתחלה" בפריים 0) ועמידה על עצירה 1
const STOPS = 8; // נוסעים מעצירה 1 עד עצירה 9 – מיילסטון זהוב ("חוצים את הגשר"), כך שהסצנה נגמרת על סיכה זהובה
const GLIDE = 92; // על פני כמה פריימים מתפרסת הגלילה (56-147); אחריהם ~20 פריימים שבהם המצלמה נוחתת והכרטיס עולה
// הגלילה נשלחת בכל פריים במנות קטנות ושוות (סה"כ ‎-300 לכל עצירה). WHEEL(-300) אחד כל 16 פריימים נמדד ונפסל:
// המצלמה של האתר רודפת אחרי היעד עם קבוע זמן של ~5 פריימים, כך שכל גלילה מלאה היא זינוק ועצירה ולא תנועה רציפה.
const STEP = (-300 * STOPS) / GLIDE;

// כרטיס הפתיחה מוסתר (אחרת הוא נשאר כמה פריימים דוהים אחרי הלחיצה, והמפה לא במרכז);
// כרטיס הסקר, הקו אליו והתווית שבסוף המסלול מוסתרים: במבט הכללי הם יושבים מתחת לתג הלייב, ובהמשך הם ממילא מחוץ לפריים.
// ה-HUD (מד העצירות ושעון המשחק) ותג הלייב הוורוד נשארים.
const CSS = `${MAP_CSS}
.mk--poll,.poll-line,.ahead-tag{display:none!important}
${OPENING_OFF}`;

// 9x16 בלבד: האתר לא מרשה למצלמה לרדת מתחת לקצה הדרומי של המפה, ולכן בחלון גבוה העצירות הדרומיות (1-9)
// יוצאות ב-63%-76% מגובה הפריים – מתחת לאזור הבטוח (עד y=1420) ומתחת לממשק של טיקטוק/רילס.
// הפתרון: הבמה נמוכה ב-LIFT פיקסלים (CSS) והמפה ממשיכה להיראות מתחתיה (overflow גלוי). המצלמה מחושבת לפי הבמה הקצרה,
// והסיכה הפעילה עולה ל-46%-57% מהגובה; בתחתית נשאר ים פתוח (שם יושבים הכתובית והממשק של הרשתות).
// נצנוץ המים (קנבס בגודל הבמה) דוהה בתחתית שלו כדי שלא יהיה תפר; הסירות דוהות בקצה הבמה (ראה EDGE_FADE).
const LIFT = process.env.LIFT === undefined ? 300 : Number(process.env.LIFT);
const LIFT_CSS = `.journey__stage{height:calc(100svh - ${LIFT}px)!important;overflow:visible!important}
.sky,.life{overflow:visible!important}
.water{-webkit-mask-image:linear-gradient(#000 calc(100% - 200px),transparent);mask-image:linear-gradient(#000 calc(100% - 200px),transparent)}`;

// 16x9 בלבד: האתר גם לא מרשה למצלמה לצאת מעבר לקצה המערבי של המפה, ולכן בחלון רחב המצלמה עומדת במקום (בציר X)
// בעצירות 1-6 ואז מתחילה לנוע בבת אחת (נמדד: מ-0 ל-2.6px CSS לפריים בתוך שני פריימים, בפריים 122) – "בעיטה" באמצע השוט.
// הפתרון, כמו ב-9x16: הבמה צרה ב-NARROW פיקסלים מכל צד (וממורכזת), והמפה ממשיכה להיראות מעבר לה. המצלמה מחושבת
// לפי הבמה הצרה ועוקבת אחרי המסלול מהעצירה הראשונה – תנועה רציפה לכל אורך הנסיעה. ה-HUD והאובך שבאופק נמתחים לרוחב המסך המלא,
// סיכות שהאתר מסתיר מעבר לקצה הבמה נשארות מוצגות, נצנוץ המים דוהה בשני הצדדים, והסירות דוהות בקצה הבמה (ראה EDGE_FADE).
const NARROW = process.env.NARROW === undefined ? 130 : Number(process.env.NARROW);
const NARROW_CSS = `.journey__stage{width:calc(100% - ${2 * NARROW}px)!important;margin-inline:auto!important;overflow:visible!important}
.sky,.life{overflow:visible!important}
.horizon,.hud{left:-${NARROW}px!important;right:-${NARROW}px!important}
.pin[hidden]{display:block!important}
.water{-webkit-mask-image:linear-gradient(90deg,transparent,#000 ${NARROW}px,#000 calc(100% - ${NARROW}px),transparent);mask-image:linear-gradient(90deg,transparent,#000 ${NARROW}px,#000 calc(100% - ${NARROW}px),transparent)}`;

/**
 * הסירות, המכוניות והציפורים (שכבת ‎.life): האתר מעלים/מחזיר כל אחת בקפיצה כשהיא רחוקה 4 אורכים מקצה הבמה. כשהבמה קטנה
 * מהפריים הקפיצה הזאת נראית בתוך הפריים. לכן כל אלמנט דוהה לפי המרחק שלו מקצה הבמה: מלא ב-inner פיקסלים בפנים, שקוף ב-outer בחוץ.
 * רץ בדף ב-requestAnimationFrame, מיד אחרי העדכון של האתר באותו פריים (הלולאה של האתר נרשמה קודם, ולכן רצה קודם).
 * (mask-image על השכבה כולה נוסה ונפסל: בצילום אחד מתוך שלושה הסירות לא צוירו בכלל במשך ~120 פריימים.)
 * cfg: { sides: true } = הקצה השמאלי והימני של הבמה (16x9), אחרת הקצה התחתון (9x16).
 */
const EDGE_FADE = (cfg) => {
  const life = document.querySelector('.life');
  const stage = document.querySelector('.journey__stage');
  const k = (d) => Math.min(1, Math.max(0, (d + cfg.outer) / (cfg.outer + cfg.inner))); // d = כמה פיקסלים בתוך הבמה
  const tick = () => {
    requestAnimationFrame(tick);
    const vw = stage.clientWidth;
    const vh = stage.clientHeight;
    let shown = 0;
    for (const el of life.children) {
      if (el.dataset.o0 === undefined) el.dataset.o0 = getComputedStyle(el).opacity; // האטימות המקורית (צל המטוס שקוף חלקית)
      const m = el.hidden ? null : /translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(el.style.transform);
      const o = !m ? 0 : cfg.sides ? Math.min(k(+m[1]), k(vw - m[1])) : k(vh - m[2]);
      el.style.opacity = (o * el.dataset.o0).toFixed(3);
      if (o > 0.5 && el.classList.contains('boat')) shown++;
    }
    life.dataset.boats = String(shown); // כמה סירות מוצגות עכשיו (לבדיקה)
  };
  requestAnimationFrame(tick);
};

async function run(aspect) {
  const s = slot(NAME);
  const out = path.join(WORK, 'scenes', aspect, `${NAME}.mkv`);
  const cap = await open({ url: '/?demo&fx&time=12', ...(aspect === '16x9' ? VIEW.map16 : VIEW.map9) });
  try {
    await cap.ready(MAP_READY);
    await cap.css(CSS);
    if (aspect === '9x16' && LIFT > 0) await cap.css(LIFT_CSS);
    if (aspect === '16x9' && NARROW > 0) await cap.css(NARROW_CSS);
    if (aspect === '9x16' && LIFT > 0) await cap.eval(EDGE_FADE, { sides: false, inner: 20, outer: 90 });
    if (aspect === '16x9' && NARROW > 0) await cap.eval(EDGE_FADE, { sides: true, inner: 20, outer: 40 });
    await cap.step(2); // הבמה נמדדת מחדש (ResizeObserver) לפני חישוב המצלמה
    // הפאנל הצדדי: לחיצה אחת על כפתור הסגירה (גם כשהפאנל עוד לא נפתח) מסמנת "הצופה סגר" – והוא לא נפתח יותר לבד
    await cap.eval(() => document.querySelector('[data-panel-close]').click());
    await cap.eval(RECENTER);
    await cap.step(20);
    const pre = await cap.eval(STATE);
    console.log(`${NAME} ${aspect} pre: ${JSON.stringify(pre)}`);
    assert(pre.shown === -1 && pre.overview && !pre.panelOpen && pre.tod === 'day' && pre.onair, 'not at the clean daylight overview');

    const log = [];
    const cam = [];
    const boats = [];
    // לבדיקה מול הווידאו (שהסירות באמת צוירו): מיקום כל סירה מוצגת בפיקסלים של הפלט
    const BOAT_POS = () => {
      const r = document.querySelector('.journey__stage').getBoundingClientRect();
      return [...document.querySelectorAll('.life > .boat')].filter((b) => !b.hidden && b.style.opacity > 0.9).map((b) => {
        const m = /translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(b.style.transform);
        return `${Math.round((+m[1] + r.left) * devicePixelRatio)},${Math.round((+m[2] + r.top) * devicePixelRatio)}`;
      }).join(' ');
    };
    const BOATS = () => Number(document.querySelector('.life').dataset.boats ?? [...document.querySelectorAll('.life > .boat')].filter((b) => !b.hidden).length);
    await cap.record(out, s.frames, async (i) => {
      if (i > 0) {
        const st = await cap.eval(STATE); // המצב אחרי הפריים הקודם
        assert(!st.panelOpen, `side panel opened at frame ${i - 1}`);
        log.push(st.shown);
        cam.push(st.cam);
        boats.push(await cap.eval(BOATS));
        if (i - 1 === 40 || i - 1 === 120) console.log(`${NAME} ${aspect} boat positions after frame ${i - 1} (output px): ${await cap.eval(BOAT_POS)}`);
      }
      if (i === 0) await cap.eval(() => document.querySelector('[data-start]').click());
      if (i >= DIVE && i < DIVE + GLIDE) await cap.eval(WHEEL, STEP);
    });
    const end = await cap.eval(STATE);
    log.push(end.shown);
    cam.push(end.cam);
    boats.push(await cap.eval(BOATS));
    console.log(`${NAME} ${aspect} end: ${JSON.stringify(end)}`);
    console.log(`${NAME} ${aspect} boats on screen (DOM): f0=${boats[0]} f40=${boats[40]} f100=${boats[100]} f168=${boats[168]}, min ${Math.min(...boats)}`);
    // חלקות תנועת המצלמה בנסיעה: מהירות (px CSS לפריים) והשינוי הגדול ביותר במהירות בין שני פריימים עוקבים
    const vel = cam.map((c, k) => (k ? [c[0] - cam[k - 1][0], c[1] - cam[k - 1][1]] : [0, 0]));
    let kick = 0;
    let kickAt = -1;
    for (let k = DIVE + 1; k < vel.length; k++) {
      const d = Math.hypot(vel[k][0] - vel[k - 1][0], vel[k][1] - vel[k - 1][1]);
      if (d > kick) [kick, kickAt] = [d, k];
    }
    const speed = vel.slice(DIVE).map((v) => Math.hypot(v[0], v[1]));
    console.log(`${NAME} ${aspect} camera: pan ${(cam[168][0] - cam[55][0]).toFixed(1)},${(cam[168][1] - cam[55][1]).toFixed(1)} px over the glide; speed max ${Math.max(...speed).toFixed(2)} px/frame; biggest speed change ${kick.toFixed(2)} px/frame at frame ${kickAt}`);
    // ההאטה הטבעית של האתר בסוף הגלילה מורידה ~18% מהמהירות בפריים; כל שינוי גדול מרבע מהמהירות המרבית הוא "בעיטה"
    assert(kick < 0.25 * Math.max(...speed) + 0.2, `camera kick of ${kick.toFixed(2)} px/frame at frame ${kickAt}`);
    // קצב התנועה (עצירות לפריים) בחלק היציב של הנסיעה: אמור להיות כמעט קבוע
    const v = log.slice(DIVE + 20, DIVE + GLIDE - 4).map((x, k, a) => (k ? x - a[k - 1] : null)).filter((x) => x !== null);
    console.log(`${NAME} ${aspect} shown: f0=${log[0]} f10=${log[10]} f30=${log[30]} f55=${log[55]} f100=${log[100]} f147=${log[147]} f168=${log[168]}; glide speed ${Math.min(...v).toFixed(4)}..${Math.max(...v).toFixed(4)} stops/frame`);
    assert(!end.panelOpen, 'side panel open at the end');
    assert(Math.abs(log[55]) < 0.01, 'dive did not settle on stop 1 by frame 55');
    assert(Math.abs(end.shown - STOPS) < 0.05 && end.near === STOPS && end.hud && end.onair, `did not land on stop ${STOPS + 1} with HUD + live badge`);
    assert(Math.max(...v) - Math.min(...v) < 0.004, 'glide speed is not constant');
    assert(!cap.errors.length, `page errors: ${cap.errors.join(' | ')}`);
  } catch (e) {
    fs.rmSync(out, { force: true }); // לא משאירים קובץ חלקי במקום של סצנה תקינה
    throw e;
  } finally {
    await cap.close();
  }
  verify(out, s.frames, aspect);
}

main(NAME, run);

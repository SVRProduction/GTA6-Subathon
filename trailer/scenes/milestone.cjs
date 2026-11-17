// milestone: לחיצה על סיכת המיילסטון הזהובה 25 ("השוד הגדול הראשון") – העמוד הזהוב נפתח במסך מלא ונשאר עד הסוף.
// node scenes/milestone.cjs 16x9|9x16|both
const { open, WORK, VIEW, MAP_CSS, MAP_READY, WHEEL } = require('../lib/harness.cjs');
const { slot } = require('../lib/timeline.cjs');
const { OPENING_OFF, RECENTER, STATE, verify, assert, main, fs, path } = require('./_maps-common.cjs');

const NAME = 'milestone';
const PIN = 24; // אינדקס העצירה (מוצגת כסיכה 25)
const TITLE = 'השוד הגדול הראשון';
const CLICK_AT = 6; // הפריים שבו לוחצים על הסיכה

const CSS = `${MAP_CSS}
${OPENING_OFF}`;
// 9x16 בלבד: כותרת העמוד יושבת באתר ב-y≈160-225, מעל האזור הבטוח (שמתחיל ב-y=250) ומתחת לממשק העליון של הרשתות.
// מורידים את תוכן העמוד ב-136px CSS (170px בפלט): התג ב-y≈265, הכותרת ב-y≈325-395. הזוהר הזהוב שבראש העמוד נשאר במקומו.
const CSS_9x16 = `.panel.is-menu .panel__scroll{padding-top:200px!important}`;

async function run(aspect) {
  const s = slot(NAME);
  const out = path.join(WORK, 'scenes', aspect, `${NAME}.mkv`);
  const cap = await open({ url: '/?demo&time=12', ...(aspect === '16x9' ? VIEW.map16 : VIEW.map9) });
  try {
    await cap.ready(MAP_READY);
    await cap.css(CSS + (aspect === '9x16' ? `\n${CSS_9x16}` : ''));
    // לא מצולם: "הצופה סגר את הפאנל" (שלא ייפתח לבד), ואז גלילה אחת גדולה מהמבט הכללי (‎-1) ישר לעצירה 24
    await cap.eval(() => document.querySelector('[data-panel-close]').click());
    await cap.eval(RECENTER);
    await cap.step(5);
    await cap.eval(WHEEL, -300 * (PIN + 1));
    await cap.step(110);
    const pre = await cap.eval(STATE);
    const pin = await cap.eval((i) => {
      const p = document.querySelectorAll('.pin')[i];
      const r = p.querySelector('.pin__disc').getBoundingClientRect();
      return { cls: p.className, label: p.getAttribute('aria-label'), x: (r.left + r.right) / 2 / innerWidth, y: (r.top + r.bottom) / 2 / innerHeight };
    }, PIN);
    console.log(`${NAME} ${aspect} pre: ${JSON.stringify(pre)} pin: ${JSON.stringify(pin)}`);
    assert(Math.abs(pre.shown - PIN) < 0.002 && pre.near === PIN && pre.odo === `משימה ${PIN + 1}`, `camera is not parked on stop ${PIN + 1}`);
    assert(!pre.panelOpen && pre.hud && pre.onair && pre.tod === 'day', 'expected closed panel, HUD and live badge in daylight');
    assert(pin.cls.includes('pin--ms') && pin.label.includes(TITLE), 'pin 25 is not the gold milestone');
    assert(pin.x > 0.1 && pin.x < 0.9 && pin.y > 0.1 && pin.y < 0.9, 'pin 25 is not inside the frame');

    await cap.record(out, s.frames, async (i) => {
      if (i === CLICK_AT) {
        await cap.eval((k) => {
          document.querySelectorAll('.pin')[k].click();
          // האתר מעביר את הפוקוס לכפתור הסגירה (נגישות) – בצילום זה נראה כמו טבעת צהובה סביב ה-×
          if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
        }, PIN);
      }
    });
    const page = await cap.eval(() => {
      const panel = document.querySelector('.panel');
      const t = panel.querySelector('.stop__title');
      const b = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map((v) => Math.round(v * devicePixelRatio)); };
      const cs = getComputedStyle(panel);
      return {
        open: !panel.hidden && panel.hasAttribute('data-open'), cls: panel.className, opacity: cs.opacity,
        title: t && t.textContent, titleBox: t && b(t), titleLines: t && Math.round(t.getBoundingClientRect().height / parseFloat(getComputedStyle(t).lineHeight)),
        badge: panel.querySelector('.mbadge') && panel.querySelector('.mbadge').textContent, badgeBox: panel.querySelector('.mbadge') && b(panel.querySelector('.mbadge')),
        now: panel.querySelector('.mnow .msec__title') && panel.querySelector('.mnow .msec__title').textContent, nowBox: panel.querySelector('.mnow__grid') && b(panel.querySelector('.mnow__grid')),
        tiles: [...panel.querySelectorAll('.mnow__t')].map((x) => x.textContent),
        scrollTop: panel.querySelector('.panel__scroll').scrollTop, focus: document.activeElement === document.body ? 'body' : document.activeElement.className,
        frame: [Math.round(innerWidth * devicePixelRatio), Math.round(innerHeight * devicePixelRatio)],
      };
    });
    console.log(`${NAME} ${aspect} page: ${JSON.stringify(page)}`);
    assert(page.open && /is-menu/.test(page.cls) && /is-ms/.test(page.cls) && page.opacity === '1', 'gold full-screen page is not open');
    assert(page.title === TITLE && page.titleLines === 1 && /מיילסטון/.test(page.badge) && page.now === 'עד הרגע הזה' && page.tiles.length === 6, 'page content is not as expected');
    assert(page.titleBox[0] >= 0 && page.titleBox[2] <= page.frame[0] && page.titleBox[1] >= 0 && page.nowBox[3] <= page.frame[1], 'title / numbers are clipped');
    assert(page.scrollTop === 0 && page.focus === 'body', 'page scrolled or focus ring left on');
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

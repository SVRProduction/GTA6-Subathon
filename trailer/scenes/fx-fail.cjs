// fx-fail (56 פריימים): עודד פישל → באנר אדום "MISSION FAILED" לרוחב המסך, ו-✗ אדום מעל הדמות.
// הדמות וה-✗ בשליש העליון והבאנר במרכז (באתר, בדסקטופ, הבאנר יושב על הדמות ומסתיר אותה).
const { prepare, record, main, boxCss, outRect, NO_POLL_CSS } = require('./_fx-common.cjs');

const LAYOUT = {
  // title / sub = גודל הגופן של MISSION FAILED ושל השורה שמתחתיו ב-CSS px (באתר: 84px ברוחב 1280, ו-16px)
  // bannerDy = הזזה של הבאנר למטה ממרכז המסך (CSS px), כדי להשאיר רווח בינו לבין הדמות
  // 16:9: חלון 768x432 CSS (dsf 2.5); 68px = באנר ברוחב ~1490px, כמו ביחס של האתר
  '16x9': { view: { cssW: 1280, cssH: 900, dsf: 2.5 }, mapZoom: 3.2, anchor: { x: 960, y: 355 }, title: 68, sub: 14, bannerDy: 12 },
  // 9:16: חלון 360x640 CSS (dsf 3); 27px = באנר ברוחב ~710px, בתוך האזור הבטוח (x 90–900)
  '9x16': { view: { cssW: 900, cssH: 1536, dsf: 3 }, mapZoom: 3, anchor: { x: 540, y: 690 }, title: 27, sub: 13, bannerDy: 0 },
};
const CLICK_AT = 3;

async function run(aspect) {
  const L = LAYOUT[aspect];
  const ctx = await prepare({ aspect, view: L.view, mapZoom: L.mapZoom, anchor: L.anchor, css: NO_POLL_CSS });
  const { cap, win } = ctx;
  try {
    await cap.css(`${boxCss('.mfailed', { ...win, y: win.y + L.bannerDy })}
.mfailed span{font-size:${L.title}px!important}
.mfailed small{font-size:${L.sub}px!important}`);
    await cap.step(6);
    await record(ctx, 'fx-fail', async (i) => {
      if (i === CLICK_AT) await cap.eval(() => document.querySelectorAll('.fx-test button')[2].click());
      if (i === 24) console.log(`[${aspect}] frame ${i}: face`, JSON.stringify(await outRect(ctx, '.player__face')), 'x', JSON.stringify(await outRect(ctx, '.pfx--fail')), 'title', JSON.stringify(await outRect(ctx, '.mfailed span')), 'sub', JSON.stringify(await outRect(ctx, '.mfailed small')));
    });
  } finally {
    await cap.close();
  }
}
main(run);

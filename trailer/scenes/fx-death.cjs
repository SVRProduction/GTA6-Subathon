// fx-death (56 פריימים): עודד מת → הבזק אדום על כל המסך עם המילה "מתת", המפה רועדת, 💀 קופצת מעל הדמות.
// מבט קרוב יותר מברירת המחדל; הדמות והגולגולת בשליש העליון והמילה מתחתיהן (באתר, בדסקטופ, המילה יושבת בדיוק על הדמות ומסתירה אותה).
const { prepare, record, main, boxCss, outRect, NO_POLL_CSS } = require('./_fx-common.cjs');

const LAYOUT = {
  // רוחב ה-viewport לפחות 900: רק אז האתר טוען את אריחי ה-HD המלאים של המפה (חדות בתקריב). mapZoom = זום המפה של האתר.
  // anchor = מרכז הדמות בפלט; word = גודל הגופן של "מתת" ב-CSS px; gap = רווח (CSS px) מתחתית הדמות עד המילה
  // 16:9: חלון של 768x432 CSS (dsf 2.5) – הדמות 110px, הגולגולת ~145–185px
  '16x9': { view: { cssW: 1280, cssH: 900, dsf: 2.5 }, mapZoom: 3.2, anchor: { x: 960, y: 420 }, word: 130, gap: 10 },
  // 9:16: חלון של 360x640 CSS (dsf 3, כמו טלפון) – הדמות 132px
  '9x16': { view: { cssW: 900, cssH: 1536, dsf: 3 }, mapZoom: 3, anchor: { x: 540, y: 700 }, word: 130, gap: 16 },
};
const CLICK_AT = 3;

async function run(aspect) {
  const L = LAYOUT[aspect];
  const ctx = await prepare({ aspect, view: L.view, mapZoom: L.mapZoom, anchor: L.anchor, css: NO_POLL_CSS });
  const { cap, win, D } = ctx;
  try {
    const avY = ctx.avatar.y - win.y; // מרכז הדמות בתוך החלון (CSS px)
    await cap.css(`${boxCss('.mflash', win)}
.mflash{place-items:start center!important}
.mflash span{font-size:${L.word}px!important;margin-top:${(avY + 22 + L.gap).toFixed(1)}px}`);
    await cap.step(6);
    await record(ctx, 'fx-death', async (i) => {
      if (i === CLICK_AT) await cap.eval(() => document.querySelectorAll('.fx-test button')[0].click());
      if (i === 24) console.log(`[${aspect}] frame ${i}: face`, JSON.stringify(await outRect(ctx, '.player__face')), 'skull', JSON.stringify(await outRect(ctx, '.pfx--skull')), 'word', JSON.stringify(await outRect(ctx, '.mflash span')), 'flash', JSON.stringify(await outRect(ctx, '.mflash')));
    });
  } finally {
    await cap.close();
  }
}
main(run);

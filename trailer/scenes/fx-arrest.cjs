// fx-arrest (57 פריימים): עודד נעצר → אורות משטרה אדום/כחול סביב הדמות ותג ⭐⭐⭐ WANTED מעליה. תקריב קיצוני על הדמות.
// התג והדמות קטנים ב-CSS (88x45, 44), אז מצלמים ב-dsf 5 וחותכים סביב הדמות: התג יוצא ~440px רוחב, חד.
const { prepare, record, main, outRect, NO_POLL_CSS } = require('./_fx-common.cjs');

const LAYOUT = {
  // חלון קטן ב-CSS (384x216 / 216x384) מתוך viewport ברוחב 900 (מ-900 ומעלה האתר טוען את אריחי ה-HD המלאים של המפה).
  // mapZoom מפצה על ה-viewport הקטן, כך שהמפה סביב הדמות נראית כמו בשאר הצילומים (כ-0.6 CSS px לפיקסל מפה).
  '16x9': { view: { cssW: 900, cssH: 432, dsf: 5 }, mapZoom: 6.2, anchor: { x: 960, y: 575 } },
  '9x16': { view: { cssW: 900, cssH: 520, dsf: 5 }, mapZoom: 5.15, anchor: { x: 540, y: 900 } },
};
const CLICK_AT = 3;
// באתר, הכללים של ‎.player b‎ (הנקודה הישנה של "אנחנו כאן": display:none, ולפניו עיגול קטן במיקום מוחלט) תופסים בטעות גם את
// שורת הכוכבים ‎<b>⭐⭐⭐</b>‎ של התג, ולכן היא לא מוצגת. כאן מחזירים אותה כמו שתוכננה (‎.pfx--wanted b‎ ב-mission.css).
const STARS_CSS = '.player .pfx--wanted b{display:block!important;position:static!important;width:auto!important;height:auto!important;border:0!important;border-radius:0!important;background:none!important}';

async function run(aspect) {
  const L = LAYOUT[aspect];
  const ctx = await prepare({ aspect, view: L.view, mapZoom: L.mapZoom, anchor: L.anchor, face: 'oded-512.png', css: `${NO_POLL_CSS}\n${STARS_CSS}` });
  const { cap } = ctx;
  try {
    await cap.step(6);
    await record(ctx, 'fx-arrest', async (i) => {
      if (i === CLICK_AT) await cap.eval(() => document.querySelectorAll('.fx-test button')[1].click());
      if (i === 30) console.log(`[${aspect}] frame ${i}: face`, JSON.stringify(await outRect(ctx, '.player__face')), 'badge', JSON.stringify(await outRect(ctx, '.pfx--wanted')), 'siren', JSON.stringify(await outRect(ctx, '.player i')));
    });
  } finally {
    await cap.close();
  }
}
main(run);

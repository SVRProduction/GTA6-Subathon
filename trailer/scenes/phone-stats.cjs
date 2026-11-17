// phone-stats: טאב "מספרים" בטלפון (iframe של phone-stats.html): אריח שעות המשחק, "💀 כמה פעמים עודד מת" בספרות ורודות גדולות,
// כמה פעמים נעצר וכמה משימות פישל. תנועה: עמידה קצרה ואז גלילה רכה למטה בתוך הדף: שורת הסטטוס יוצאת, הכותרת נשארת בראש,
// מונה המיתות עולה למרכז המסך, והשורה "עצירות על המפה / מיילסטונים" נכנסת כולה מעל סרגל הטאבים.
// node scenes/phone-stats.cjs
const { CSS, easeInOut, assert, main } = require('./_phone-common.cjs');

const NAME = 'phone-stats';
const SCROLL = [10, 46]; // פריימים: גלילה 0 -> היעד
const TOP_GAP = 7; // פיקסלי CSS בין ראש המסך לכותרת הדף בסוף הגלילה (מספיק כדי ששורת הסטטוס שמעליה תצא כולה)

const STATS_READY = () => {
  const f = document.querySelector('#view-stats iframe');
  const d = f && f.contentDocument;
  if (!d || document.body.dataset.tab !== 'stats' || d.fonts.status !== 'loaded') return false;
  const root = d.querySelector('[data-root]');
  const tiles = d.querySelectorAll('.sx-tile');
  // כל הנתונים נטענו: מיתות, שעות משחק, ומונה התגובות (מגיע אחרון)
  return !!root && !root.hasAttribute('aria-busy') && tiles.length === 8 && /^\d+$/.test(d.querySelector('.sx-tile--deaths b').textContent) && tiles[7].querySelector('b').textContent !== '0' && d.querySelectorAll('.sx-card').length >= 4;
};

/** מצב דף המספרים; המלבנים בפיקסלי פלט של המסך כולו (ה-iframe מתחיל בראש המסך) */
const STATS_STATE = () => {
  const f = document.querySelector('#view-stats iframe');
  const w = f.contentWindow;
  const d = w.document;
  const fr = f.getBoundingClientRect();
  const b = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return [r.left + fr.left, r.top + fr.top, r.right + fr.left, r.bottom + fr.top].map((v) => Math.round(v * devicePixelRatio)); };
  const info = (t) => (t ? { n: t.querySelector('b').textContent, label: t.querySelector('span').textContent, box: b(t), numBox: b(t.querySelector('b')), color: w.getComputedStyle(t.querySelector('b')).color } : null);
  const tile = (sel) => info(d.querySelector(sel));
  const se = d.scrollingElement;
  return {
    tab: document.body.dataset.tab, cls: d.documentElement.className, scrollY: w.scrollY, max: se.scrollHeight - se.clientHeight, frameBox: [fr.left, fr.top, fr.right, fr.bottom].map((v) => Math.round(v * devicePixelRatio)),
    status: d.querySelector('[data-status]').textContent, title: d.querySelector('[data-title]').textContent, titleBox: b(d.querySelector('[data-title]')),
    play: tile('.sx-tile--play'), deaths: tile('.sx-tile--deaths'), arrests: tile('.sx-tile--cats'), fails: tile('.sx-tile--fails'),
    tiles: [...d.querySelectorAll('.sx-tile')].map((t) => `${t.querySelector('b').textContent} ${t.querySelector('span').textContent}`),
    small: [...d.querySelectorAll('.sx-tile')].slice(4).map(info),
    dir: w.getComputedStyle(d.documentElement).direction, font: w.getComputedStyle(d.body).fontFamily, rubik: d.fonts.check("800 46px 'Rubik'"),
    tabsBox: (() => { const r = document.querySelector('.tabs').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map((v) => Math.round(v * devicePixelRatio)); })(),
    current: document.querySelector('.tab[aria-current]').dataset.tab,
  };
};

// גוף בסוגריים מסולסלים בכוונה: בכרום הזה scrollTo מחזיר Promise שנפתר רק אחרי פריים, ו-cap.eval היה מחכה לו לנצח (הזמן הווירטואלי עומד)
const SCROLL_TO = (y) => {
  document.querySelector('#view-stats iframe').contentWindow.scrollTo({ top: y, behavior: 'instant' });
};

main(NAME, { url: '/phone.html?demo#stats' }, async (cap, s, out) => {
  await cap.ready(STATS_READY);
  await cap.css(CSS);
  await cap.eval(SCROLL_TO, 0);
  await cap.step(6);

  const pre = await cap.eval(STATS_STATE);
  console.log(`${NAME} pre: ${JSON.stringify(pre)}`);
  const W = pre.frameBox[2];
  const bottom = pre.tabsBox[1]; // מתחת לזה: סרגל הטאבים
  assert(pre.tab === 'stats' && pre.current === 'stats' && /is-app/.test(pre.cls) && pre.dir === 'rtl' && pre.rubik && /Rubik/.test(pre.font), 'stats page is not the in-app (Rubik, RTL) version');
  assert(pre.scrollY === 0 && pre.frameBox[1] === 0 && pre.frameBox[3] === bottom, `stats frame: ${JSON.stringify(pre.frameBox)}`);
  assert(pre.title === 'סאבתון GTA 6 במספרים' && /משחק GTA 6 עכשיו/.test(pre.status), `stats header: ${pre.status} / ${pre.title}`);
  assert(/^\d+:\d\d$/.test(pre.play.n) && pre.play.label === 'שעות משחק ב-GTA 6', `playtime tile: ${JSON.stringify(pre.play)}`);
  assert(pre.deaths.n === '69' && pre.deaths.label === '💀 כמה פעמים עודד מת' && pre.deaths.color === 'rgb(240, 48, 111)', `deaths tile: ${JSON.stringify(pre.deaths)}`);
  assert(pre.arrests.n === '8' && pre.arrests.label === '🚔 כמה פעמים עודד נעצר' && pre.fails.n === '7' && pre.fails.label === '❌ משימות שעודד פישל', `arrests / fails: ${JSON.stringify([pre.arrests, pre.fails])}`);
  // בפריים הראשון: הכותרת וארבעת האריחים הגדולים שלמים ובתוך המסך
  for (const box of [pre.titleBox, pre.play.box, pre.deaths.box, pre.arrests.box, pre.fails.box]) assert(box[0] >= 0 && box[2] <= W && box[1] >= 0 && box[3] <= bottom, `clipped at the start: ${JSON.stringify(box)}`);
  const target = pre.titleBox[1] / devicePixelRatioOf(pre) - TOP_GAP;
  assert(target > 20 && target < pre.max, `scroll target ${target}`);

  await cap.record(out, s.frames, async (i) => {
    await cap.eval(SCROLL_TO, target * easeInOut((i - SCROLL[0]) / (SCROLL[1] - SCROLL[0])));
  });

  const end = await cap.eval(STATS_STATE);
  console.log(`${NAME} end: ${JSON.stringify({ scrollY: end.scrollY, titleBox: end.titleBox, play: end.play, deaths: end.deaths, arrests: end.arrests, fails: end.fails, small: end.small })}`);
  assert(Math.abs(end.scrollY - target) < 0.5, `stats did not reach the scroll target: ${end.scrollY} vs ${target}`);
  assert(end.deaths.n === '69' && end.arrests.n === '8' && end.fails.n === '7' && /^\d+:\d\d$/.test(end.play.n), 'numbers changed during the take');
  for (const t of [end.play, end.deaths, end.arrests, end.fails]) assert(t.box[0] >= 0 && t.box[2] <= W && t.box[1] >= 0 && t.box[3] <= bottom, `clipped at the end: ${JSON.stringify(t.box)}`);
  assert(end.deaths.numBox[1] > end.play.box[3] && end.deaths.box[3] <= end.arrests.box[1], 'tiles overlap');
  assert(end.titleBox[1] >= 0 && end.titleBox[3] <= end.play.box[1], 'page title is clipped at the end');
  // השורה "עצירות על המפה / מיילסטונים" שלמה מעל סרגל הטאבים; מהשורה שאחריה רואים רק את קצה האריחים, בלי מספר חתוך
  const [stops, miles, ...rest] = end.small;
  assert(stops.label === 'עצירות על המפה' && miles.label === 'מיילסטונים' && stops.box[3] <= bottom && miles.box[3] <= bottom, `stops / milestones row is cut: ${JSON.stringify([stops.box, miles.box])}`);
  assert(rest.every((t) => t.numBox[1] >= bottom), `a number of the next row is cut by the tab bar: ${JSON.stringify(rest.map((t) => t.numBox))}`);
});

/** יחס פיקסלי פלט לפיקסלי CSS, מתוך המלבנים (רוחב המסגרת בפלט חלקי 360) */
function devicePixelRatioOf(st) {
  return st.frameBox[2] / 360;
}

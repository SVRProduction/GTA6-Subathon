// phone-home: בית האפליקציה בטלפון – הבר העליון עם הלוגו ו"הסאבתון של עודד", שורת הסטוריז, כרטיס הלייב וכרטיס "אנחנו עכשיו ב".
// תנועה: עמידה קצרה, גלילה רכה למטה (הכותרת הגדולה יוצאת, כרטיס המפה עולה), ואז החלקה של שורת הסטוריז עד שהסטורי
// "הלילה הארוך" במרכז. phone-story מתחילה בדיוק מהמצב שבו הסצנה הזאת נגמרת.
// node scenes/phone-home.cjs
const { CSS, STORY, HOME_SCROLL, HOME_READY, RINGS_GEOMETRY, SET_HOME, HOME_STATE, easeInOut, swipe, assert, main } = require('./_phone-common.cjs');

const NAME = 'phone-home';
const SCROLL = [8, 32]; // פריימים: גלילה אנכית 0 -> HOME_SCROLL
const SWIPE = [30, 52]; // פריימים: החלקת שורת הסטוריז x0 -> x1

main(NAME, { url: '/phone.html?demo' }, async (cap, s, out) => {
  await cap.ready(HOME_READY);
  await cap.css(CSS);
  const g = await cap.eval(RINGS_GEOMETRY, STORY.label);
  assert(g && g.x0 >= 0 && g.x1 > g.x0 && g.x1 <= g.max, `rings geometry ${JSON.stringify(g)}`);
  await cap.eval(SET_HOME, { x: g.x0, y: 0 });
  await cap.step(6);

  const pre = await cap.eval(HOME_STATE);
  console.log(`${NAME} pre: ${JSON.stringify({ ...pre, rings: pre.rings.slice(0, 5) })}`);
  const [W] = pre.frame;
  assert(pre.dir === 'rtl' && pre.rubik && /Rubik/.test(pre.font), 'page is not RTL with the Rubik font');
  assert(pre.name === 'הסאבתון של עודד' && pre.liveTxt === 'בלייב' && !pre.installShown, 'header: expected the channel name, the live pill and no install button');
  // בעברית: הלוגו והשם מימין, תג הלייב משמאל, ואין חפיפה ביניהם
  assert(pre.liveBox[0] >= 24 && pre.liveBox[2] + 24 <= pre.nameBox[0] && pre.nameBox[2] <= pre.logoBox[0] && pre.logoBox[2] <= W - 24, `header boxes overlap: ${JSON.stringify([pre.liveBox, pre.nameBox, pre.logoBox])}`);
  assert(pre.scrollTop === 0 && Math.abs(pre.ringsLeft + g.x0) < 0.5, 'home is not at its start position');
  const first = pre.rings.slice(0, 4);
  assert(first[0].label === 'סטורי: היום' && first.every((r) => r.box[0] >= 12 && r.box[2] <= W - 12 && r.box[1] >= pre.viewBox[1]), `first four rings are not fully visible: ${JSON.stringify(first.map((r) => r.box))}`);
  assert(/משחק GTA 6 עכשיו/.test(pre.liveCard) && /לצפייה/.test(pre.liveCard), `live card: ${pre.liveCard}`);
  assert(pre.eyebrow === 'אנחנו עכשיו ב' && pre.now === 'הכביש הצפוני', `now card: ${pre.eyebrow} / ${pre.now}`);

  await cap.record(out, s.frames, async (i) => {
    const y = HOME_SCROLL * easeInOut((i - SCROLL[0]) / (SCROLL[1] - SCROLL[0]));
    const x = g.x0 + (g.x1 - g.x0) * swipe((i - SWIPE[0]) / (SWIPE[1] - SWIPE[0]));
    await cap.eval(SET_HOME, { x, y });
  });

  const end = await cap.eval(HOME_STATE);
  const t = end.rings[g.target];
  console.log(`${NAME} end: ${JSON.stringify({ scrollTop: end.scrollTop, ringsLeft: end.ringsLeft, target: t, nowBox: end.nowBox, viewBox: end.viewBox })}`);
  assert(Math.abs(end.scrollTop - HOME_SCROLL) < 0.5 && Math.abs(end.ringsLeft + g.x1) < 0.5, 'home did not reach its end position');
  assert(t.label === STORY.label && Math.abs((t.box[0] + t.box[2]) / 2 - W / 2) <= 2 && t.box[1] >= end.viewBox[1] + 9, `story ring is not centred under the bar: ${JSON.stringify(t)}`);
  assert(end.nowBox[1] > end.mapBox[3] && end.nowBox[3] <= end.viewBox[3], 'the "now" title is hidden behind the tab bar');
  assert(end.name === 'הסאבתון של עודד' && end.liveTxt === 'בלייב', 'header changed during the take');
});

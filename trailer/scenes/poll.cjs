// poll (56 פריימים): הסקר הפתוח על המפה. קו זהוב מקווקו "צועד" מהדמות של עודד אל סיכת הסקר, וכרטיס הסקר עם השאלה
// ושלושת הפסים. הקולות "מגיעים": הפסים מתחילים ב-0% ועולים בארבע מדרגות, על הפעימות, עד ערכי הדמו (29/53/18).
// הסקר מוזז קרוב לדמות (באתר הוא רחוק ממנה, ולאורך יוצא מהמסך): כותבים את נתוני הדמו ב-localStorage ומודיעים לאתר
// דרך ה-BroadcastChannel שלו (אותו מנגנון שמעדכן את המפה כשמשנים משהו בלשונית אחרת).
const { prepare, record, main, outRect, unproject, READ_STATE } = require('./_fx-common.cjs');

const LAYOUT = {
  // anchor = מרכז הדמות בפלט; pin = חוד סיכת הסקר בפלט (הכרטיס יוצא מעליה ושמאלה ממנה)
  '16x9': { view: { cssW: 1280, cssH: 720, dsf: 2.5 }, mapZoom: 4, anchor: { x: 1430, y: 345 }, pin: { x: 800, y: 695 } },
  '9x16': { view: { cssW: 900, cssH: 1536, dsf: 2.75 }, mapZoom: 3, anchor: { x: 800, y: 420 }, pin: { x: 640, y: 1250 } },
};
// הקולות מגיעים: מדרגה בכל פעימה (14.06 פריימים). האחוזים של כל מדרגה לשלוש האפשרויות
const STEPS = [
  { at: 2, p: [8, 13, 4] },
  { at: 14, p: [15, 27, 9] },
  { at: 28, p: [23, 41, 14] },
  { at: 42, p: [29, 53, 18] }, // ערכי הדמו: 214/388/131 קולות
];
const COUNT_FRAMES = 9; // כמה פריימים המספר "רץ" אחרי כל מדרגה
const POLL_CSS = '.mk--poll .mk__bar i{transition-duration:.45s!important}';

/** נתוני הדמו (כמו seedExtras באתר), עם הסקר במיקום חדש על המפה */
const MOVE_POLL = (at) => {
  const now = Date.now();
  const iso = (t) => new Date(t).toISOString();
  const st = (id, user, img, caption, i, hoursAgo, likes, status = 'approved') => ({
    id, kick_user_id: `demo-${user}`, username: user, avatar: null, image_url: `./demo/${img}`, caption, mission_id: `demo-${i}`, x: null, y: null, status, likes,
    created_at: iso(now - hoursAgo * 36e5), expires_at: iso(now - hoursAgo * 36e5 + 48 * 36e5),
  });
  const extras = {
    markers: [],
    stories: [
      st('ds-1', 'NoaPlays', 'story-1.jpg', 'השקיעה מהגשר בדיוק כשעודד נפל 😂', 4, 30, 41),
      st('ds-2', 'dan.gg', 'story-2.jpg', 'צילמתי את הרגע שהצ׳אט ניצח בסקר', 52, 6, 88),
      st('ds-3', 'עומרי_77', 'story-3.jpg', 'האי הצפוני מלמעלה, מטורף', 60, 2, 23),
      st('ds-4', 'Lior_kick', 'story-4.jpg', 'מי עוד חושב שהוא צריך לחזור לעיר?', 66, 0.5, 9, 'pending'),
    ],
    polls: [{ id: 'dp-1', question: 'לאן נוסעים עכשיו?', options: ['חוזרים לעיר', 'ממשיכים להר', 'לים, ליאכטה'], x: at.x, y: at.y, status: 'open', ends_at: iso(now + 9 * 60_000), winner: null, created_at: iso(now - 3 * 60_000), votes: [214, 388, 131] }],
    ballots: {},
    likers: {},
  };
  localStorage.setItem('journey-demo-v9-extras-v2', JSON.stringify(extras));
  const ch = new BroadcastChannel('journey-demo-v9');
  ch.postMessage('extras');
  setTimeout(() => ch.close(), 500);
};

/** מעדכן את הפסים: p = רוחב (אחוזים, או null כדי לא לגעת), n = המספר שכתוב */
const SET_BARS = ({ p, n }) => {
  document.querySelectorAll('.mk--poll .mk__bar').forEach((row, k) => {
    if (p) row.style.setProperty('--p', `${p[k]}%`);
    row.querySelector('.mk__bar-n').textContent = `${n[k]}%`;
  });
};

async function run(aspect) {
  const L = LAYOUT[aspect];
  const ctx = await prepare({ aspect, view: L.view, mapZoom: L.mapZoom, anchor: L.anchor, css: POLL_CSS });
  const { cap, D, crop } = ctx;
  try {
    // מזיזים את הסקר: הנקודה במפה שנמצאת מתחת למיקום הרצוי על המסך
    const st = await cap.eval(READ_STATE);
    const at = unproject(st, (crop.x + L.pin.x) / D, (crop.y + L.pin.y) / D);
    if (!(at.x > 0.02 && at.x < 0.98 && at.y > 0.02 && at.y < 0.98)) throw new Error(`poll target outside the map: ${JSON.stringify(at)}`);
    await cap.eval(MOVE_POLL, at);
    await cap.step(8);
    // הקו המקווקו מצויר רק כשהמצלמה זזה; resize מכריח את האתר לצייר פריים מחדש (frame(true)) עם המיקום החדש של הסקר
    await cap.eval(() => window.dispatchEvent(new Event('resize')));
    await cap.step(6);
    const pin = await outRect(ctx, '.mk--poll .mk__tip');
    const card = await outRect(ctx, '.mk--poll .mk__card');
    if (!pin || !card) throw new Error('poll pin did not render after moving it');
    console.log(`[${aspect}] poll at map (${at.x.toFixed(4)}, ${at.y.toFixed(4)}); pin tip`, JSON.stringify(pin), 'card', JSON.stringify(card), 'face', JSON.stringify(await outRect(ctx, '.player__face')));
    if (Math.abs(pin.x + pin.w / 2 - L.pin.x) > 12 || Math.abs(pin.y + pin.h - L.pin.y) > 12) throw new Error(`poll pin landed off target: ${JSON.stringify(pin)} vs ${JSON.stringify(L.pin)}`);
    if (card.x < 0 || card.y < 0 || card.x + card.w > ctx.out.w || card.y + card.h > ctx.out.h) throw new Error(`poll card outside the frame: ${JSON.stringify(card)}`);
    // "‎!1" הוא פקודת צ'אט (לטינית בתוך שורה עברית): מבודדים אותה משמאל לימין, אחרת היא מוצגת הפוך ("1!")
    await cap.eval(() => {
      document.querySelectorAll('.mk--poll .mk__bar-t').forEach((t) => {
        const m = t.textContent.match(/^(!\d+)\s+(.*)$/);
        if (!m) return;
        const cmd = document.createElement('span');
        cmd.dir = 'ltr';
        cmd.style.unicodeBidi = 'isolate';
        cmd.textContent = m[1];
        t.replaceChildren(cmd, ` ${m[2]}`);
      });
    });
    // מתחילים מאפס, ומחכים שהמעבר של הפסים יסתיים לפני שמצלמים
    await cap.eval(SET_BARS, { p: [0, 0, 0], n: [0, 0, 0] });
    await cap.step(34);
    let from = [0, 0, 0];
    let cur = { at: -1000, p: [0, 0, 0] };
    await record(ctx, 'poll', async (i) => {
      const s = STEPS.find((x) => x.at === i);
      if (s) { from = cur.p; cur = s; }
      const k = Math.min(1, (i - cur.at + 1) / COUNT_FRAMES);
      const n = cur.p.map((v, j) => Math.round(from[j] + (v - from[j]) * k));
      if (s || i - cur.at < COUNT_FRAMES) await cap.eval(SET_BARS, { p: s ? s.p : null, n });
    });
    const end = await cap.eval(() => [...document.querySelectorAll('.mk--poll .mk__bar')].map((r) => `${r.style.getPropertyValue('--p')} ${r.querySelector('.mk__bar-n').textContent}`));
    console.log(`[${aspect}] bars at the end:`, JSON.stringify(end));
  } finally {
    await cap.close();
  }
}
main(run);

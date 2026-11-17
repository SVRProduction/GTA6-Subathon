// phone-story: מהבית (בדיוק המצב שבו phone-home נגמרת) לוחצים על טבעת הסטורי "הלילה הארוך" – הסטורי של המיילסטון נפתח במסך מלא:
// צילום המפה במקום של העצירה, כותרת גדולה, תקציר, ציטוט, כפתורי לייק/תגובות/מפה, ופס ההתקדמות רץ.
// הלחיצה נשמרת ב-work/scenes/phone/taps.json.
// node scenes/phone-story.cjs
const { CSS, DSF, STORY, HOME_SCROLL, HOME_READY, RINGS_GEOMETRY, SET_HOME, HOME_STATE, assert, saveTap, main } = require('./_phone-common.cjs');

const NAME = 'phone-story';
const PRESS_AT = 2; // האצבע נוגעת: הטבעת מתכווצת מעט (כמו ‎:active באתר)
const TAP_AT = 5; // הלחיצה (זה הפריים שנרשם ב-taps.json): בפריים 5 עדיין רואים את הבית, והסטורי מתחיל להופיע בפריים 6 ונפתח עד פריים ~13

/** מצב הסטורי הפתוח, עם מלבנים בפיקסלי פלט */
const STORY_STATE = () => {
  const st = document.querySelector('[data-story]');
  const b = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map((v) => Math.round(v * devicePixelRatio)); };
  const q = (s) => st.querySelector(s);
  const cs = getComputedStyle(st);
  const bar = q('.st-prog .is-cur i');
  const snap = q('.st-bg .snap');
  return {
    open: !st.hidden && st.classList.contains('is-open'), opacity: cs.opacity, transform: cs.transform, hash: location.hash,
    head: q('.st-head strong') && q('.st-head strong').textContent, when: q('.st-head small') && q('.st-head small').textContent, ring: q('.st-ring b') && q('.st-ring b').textContent,
    chip: q('.st-chip') && q('.st-chip').textContent, title: q('.st-title') && q('.st-title').textContent, titleBox: b(q('.st-title')),
    sum: q('.st-sum') && q('.st-sum').textContent, sumBox: b(q('.st-sum')), quote: q('.st-quote') && q('.st-quote').textContent, quoteBox: b(q('.st-quote')),
    actions: [...st.querySelectorAll('.st-actions .pill')].map((p) => ({ label: p.getAttribute('aria-label') || p.textContent, text: p.textContent, box: b(p) })),
    closeBox: b(q('.st-close')), bar: bar ? Number((bar.style.transform.match(/scaleX\(([\d.]+)\)/) || [])[1]) : null,
    bg: snap ? { tag: snap.tagName, ok: snap.tagName === 'IMG' ? snap.complete && snap.naturalWidth > 0 : snap.width > 0 } : null, pin: !!q('.st-pin') && !q('.st-pin').hidden,
    frame: [Math.round(innerWidth * devicePixelRatio), Math.round(innerHeight * devicePixelRatio)],
  };
};

let tap = null;
main(NAME, { url: '/phone.html?demo' }, async (cap, s, out) => {
  await cap.ready(HOME_READY);
  await cap.css(CSS);
  const g = await cap.eval(RINGS_GEOMETRY, STORY.label);
  assert(g && g.x1 > g.x0 && g.x1 <= g.max, `rings geometry ${JSON.stringify(g)}`);
  await cap.eval(SET_HOME, { x: g.x1, y: HOME_SCROLL });
  await cap.step(6);

  const pre = await cap.eval(HOME_STATE);
  const ring = pre.rings[g.target];
  const [W, H] = pre.frame;
  console.log(`${NAME} pre: ${JSON.stringify({ scrollTop: pre.scrollTop, ringsLeft: pre.ringsLeft, ring, viewBox: pre.viewBox })}`);
  assert(ring.label === STORY.label && Math.abs(pre.scrollTop - HOME_SCROLL) < 0.5 && Math.abs(pre.ringsLeft + g.x1) < 0.5, 'home is not in the end state of phone-home');
  assert(ring.box[0] >= 0 && ring.box[2] <= W && ring.box[1] >= pre.viewBox[1] && ring.box[3] <= pre.viewBox[3], `story ring is not fully visible: ${JSON.stringify(ring.box)}`);
  assert(await cap.eval(() => document.querySelector('[data-story]').hidden), 'story is already open');

  await cap.record(out, s.frames, async (i) => {
    if (i === PRESS_AT) {
      await cap.eval((label) => {
        const r = [...document.querySelectorAll('.ring')].find((x) => x.getAttribute('aria-label') === label);
        r.querySelector('.ring__pic').style.transform = 'scale(0.93)';
      }, STORY.label);
    }
    if (i === TAP_AT) {
      // נקודת הלחיצה נמדדת מהטבעת עצמה (מרכז המלבן לא זז כשהיא מתכווצת), ואז לוחצים
      tap = await cap.eval((label) => {
        const r = [...document.querySelectorAll('.ring')].find((x) => x.getAttribute('aria-label') === label);
        const pic = r.querySelector('.ring__pic');
        const b = pic.getBoundingClientRect();
        pic.style.transform = '';
        r.click();
        // האתר מוסיף את is-open ב-requestAnimationFrame. בלי חישוב סגנון לפני כן אין לדפדפן "מצב התחלה", והסטורי קופץ בלי
        // המעבר שמוגדר לו ב-CSS (שקיפות 0.25 שנ' + הגדלה 0.3 שנ'). קריאת הסגנון כאן רק גורמת למעבר של האתר לרוץ.
        void getComputedStyle(document.querySelector('[data-story]')).opacity;
        if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
        return { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
      }, STORY.label);
    }
  });

  const st = await cap.eval(STORY_STATE);
  console.log(`${NAME} story: ${JSON.stringify(st)}`);
  assert(st.open && st.opacity === '1' && (st.transform === 'none' || st.transform === 'matrix(1, 0, 0, 1, 0, 0)'), 'story is not fully open');
  assert(st.hash === `#story-${STORY.stop + 1}` && st.head === `מיילסטון ${STORY.stop + 1}` && st.ring === String(STORY.stop + 1), `wrong story: ${st.hash} / ${st.head}`);
  assert(st.title === STORY.title && !!st.sum && !!st.quote && st.quote.includes(STORY.quote) && !!st.chip, 'story content: expected chapter chip, title, summary and quote');
  assert(/לפני \d+ שע'/.test(st.when), `story header time reads badly: ${st.when}`);
  assert(st.bg && st.bg.ok && st.pin, 'story background (map snapshot + pin) is missing');
  const like = st.actions.find((a) => a.label === 'לייק');
  const talk = st.actions.find((a) => a.label !== 'לייק' && a.label !== 'במפה');
  assert(like && talk && st.actions.length === 3, `story actions: ${JSON.stringify(st.actions)}`);
  for (const box of [st.titleBox, st.sumBox, st.quoteBox, st.closeBox, ...st.actions.map((a) => a.box)]) assert(box[0] >= 0 && box[1] >= 0 && box[2] <= W && box[3] <= H, `story element is clipped: ${JSON.stringify(box)}`);
  assert(st.titleBox[3] <= st.sumBox[1] && st.sumBox[3] <= st.quoteBox[1] && st.quoteBox[3] <= like.box[1], 'story texts overlap');
  // פס ההתקדמות רץ: 7 שניות לשקופית, נמדד מהפריים שבו הסטורי נפתח
  const expected = (s.frames - TAP_AT) / 30 / 7;
  assert(st.bar > 0.15 && Math.abs(st.bar - expected) < 0.02, `progress bar ${st.bar}, expected about ${expected.toFixed(3)}`);
  assert(tap && Math.abs(tap.x * DSF - (ring.box[0] + ring.box[2]) / 2) <= 2 && Math.abs(tap.y * DSF - (ring.box[1] + ring.box[3]) / 2) <= 2, `tap point ${JSON.stringify(tap)} is not on the ring`);
  return () => saveTap({ scene: NAME, frame: TAP_AT, x: tap.x * DSF, y: tap.y * DSF });
});

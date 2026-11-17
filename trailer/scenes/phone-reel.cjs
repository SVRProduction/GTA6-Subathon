// phone-reel: פיד הקליפים בטלפון, על הקליפ "Grand Theft Auto VI · טריילר 2" (צופה מחובר בדמו). בפריים 24 לוחצים על הלייק:
// הלב מתמלא בוורוד והמונה מראה 1. הלחיצה נשמרת ב-work/scenes/phone/taps.json.
// נגן יוטיוב מוסתר (PHONE_CSS), ולכן במקום הסרטון נשארת תמונת התצוגה של הטריילר. שני דברים לצילום בלבד, כמו בתוכנית:
//  1. התמונה היא maxresdefault.jpg (1280x720, מאותו work/ytimg) במקום hqdefault.jpg (480px, נמרח ב-1080).
//  2. זום איטי על התמונה (1.00 -> 1.04 לאורך הסצנה) בתוך המסגרת הקבועה שלה, במקום סרטון שלא מתנגן בצילום.
// node scenes/phone-reel.cjs
const { CSS, DSF, assert, saveTap, main } = require('./_phone-common.cjs');

const NAME = 'phone-reel';
const CLIP = 'yt-VQRLujxTm3c';
const TITLE = 'Grand Theft Auto VI · טריילר 2';
const POSTER = 'https://i.ytimg.com/vi/VQRLujxTm3c/maxresdefault.jpg';
const PRESS_AT = 22; // האצבע נוגעת: הכפתור מתכווץ מעט (כמו ‎:active באתר)
const TAP_AT = 24; // הלחיצה: הפריים הראשון שבו הלב ורוד והמונה 1 (צליל ה-pop בציר הזמן בפעימה 74 = פריים 28, בשיא הקפיצה של הלב)
const ZOOM = 0.04;
// נקודת העוגן של הזום (חלק מהרוחב / מהגובה). לא במרכז: כך הכותרת שבראש התמונה, ה-VI שבתחתית והלוגו שבפינה הימנית-תחתונה
// נשארים שלמים עד סוף הזום (בתמונה המקורית: 2.8% שוליים מעל הכותרת, 1.9% מתחת ללוגו, 0.9% מימינו)
const ORIGIN = [0.8, 0.58];

const REEL_READY = () => {
  const el = document.querySelector('.reel[data-clip="yt-VQRLujxTm3c"]');
  if (!el || document.body.dataset.tab !== 'clips') return false;
  const imgs = [...el.querySelectorAll('.reel__media img')];
  return imgs.length === 2 && imgs.every((i) => i.complete && i.naturalWidth > 0) && !!el.querySelector('.like') && !!el.querySelector('.reel__info strong');
};
const POSTER_READY = () => {
  const p = document.querySelector('.reel[data-clip="yt-VQRLujxTm3c"] .reel__poster');
  return p.complete && p.naturalWidth === 1280 && p.naturalHeight === 720;
};

/** מצב הקליפ והכפתורים, עם מלבנים בפיקסלי פלט */
const REEL_STATE = (clip) => {
  const b = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map((v) => Math.round(v * devicePixelRatio)); };
  const el = document.querySelector(`.reel[data-clip="${clip}"]`);
  const feed = document.querySelector('.feed');
  const like = el.querySelector('.like');
  const yt = el.querySelector('.reel__yt');
  const poster = el.querySelector('.reel__poster');
  const toast = document.querySelector('#toast');
  return {
    tab: document.body.dataset.tab, feedTop: feed.scrollTop, reelBox: b(el), first: document.querySelector('.reel').dataset.clip, note: !!document.querySelector('.feed__note') && getComputedStyle(document.querySelector('.feed__note')).display !== 'none',
    title: el.querySelector('.reel__info strong').textContent, sub: el.querySelector('.reel__info small').textContent, titleBox: b(el.querySelector('.reel__info strong')), infoBox: b(el.querySelector('.reel__info')),
    poster: { src: poster.currentSrc || poster.src, w: poster.naturalWidth, h: poster.naturalHeight, ok: poster.complete, box: b(poster), transform: poster.style.transform, clip: poster.style.clipPath },
    yt: yt ? getComputedStyle(yt).display : 'no iframe',
    like: { cls: like.className, pressed: like.getAttribute('aria-pressed'), text: like.querySelector('span').textContent, color: getComputedStyle(like).color, fill: getComputedStyle(like.querySelector('svg')).fill, box: b(like) },
    btns: [...el.querySelectorAll('.reel__side .reel__btn')].map((x) => ({ label: x.getAttribute('aria-label'), box: b(x) })),
    toast: toast.classList.contains('show') ? toast.textContent : '', viewer: !!localStorage.getItem('kick-viewer'),
    dir: getComputedStyle(document.documentElement).direction, rubik: document.fonts.check("800 18px 'Rubik'"),
    frame: [Math.round(innerWidth * devicePixelRatio), Math.round(innerHeight * devicePixelRatio)],
  };
};

let tap = null;
main(NAME, { url: `/phone.html?demo#clip-${CLIP}`, viewer: true }, async (cap, s, out) => {
  await cap.ready(REEL_READY);
  await cap.css(CSS);
  await cap.eval((src) => { document.querySelector('.reel[data-clip="yt-VQRLujxTm3c"] .reel__poster').src = src; }, POSTER);
  await cap.ready(POSTER_READY, { settle: 10 });

  const pre = await cap.eval(REEL_STATE, CLIP);
  console.log(`${NAME} pre: ${JSON.stringify(pre)}`);
  const [W, H] = pre.frame;
  assert(pre.tab === 'clips' && pre.first === CLIP && pre.feedTop === 0 && pre.reelBox[1] === 0, 'the feed is not parked on the GTA VI Trailer 2 reel');
  assert(pre.title === TITLE && /Rockstar Games/.test(pre.sub) && pre.dir === 'rtl' && pre.rubik && !pre.note, `reel title: ${pre.title} / ${pre.sub}`);
  assert(pre.poster.ok && pre.poster.w === 1280 && pre.poster.box[0] === 0 && pre.poster.box[2] === W && pre.yt === 'none', `poster / hidden player: ${JSON.stringify(pre.poster)} yt=${pre.yt}`);
  assert(pre.viewer && pre.like.cls === 'reel__btn like' && pre.like.pressed === 'false' && pre.like.text === '', `like should start off: ${JSON.stringify(pre.like)}`);
  assert(pre.btns.length === 4 && pre.btns.every((x) => x.box[0] >= 0 && x.box[2] <= W && x.box[1] >= pre.infoBox[3] && x.box[3] <= pre.reelBox[3]), `action buttons: ${JSON.stringify(pre.btns)}`);
  assert(pre.poster.box[3] <= pre.titleBox[1] && pre.titleBox[0] >= 0 && pre.titleBox[2] <= W, 'title overlaps the picture or is clipped');

  await cap.record(out, s.frames, async (i) => {
    // זום איטי: התמונה גדלה סביב נקודת העוגן, ו-clip-path חותך אותה חזרה למסגרת 16:9 המקורית (המסגרת עצמה לא זזה)
    await cap.eval(({ k, clip, ox, oy }) => {
      const p = document.querySelector(`.reel[data-clip="${clip}"] .reel__poster`);
      const cut = (1 - 1 / k) * 100;
      const pc = (v) => `${v.toFixed(4)}%`;
      p.style.transformOrigin = `${ox * 100}% ${oy * 100}%`;
      p.style.transform = `scale(${k})`;
      p.style.clipPath = `inset(${pc(cut * oy)} ${pc(cut * (1 - ox))} ${pc(cut * (1 - oy))} ${pc(cut * ox)})`;
    }, { k: 1 + (ZOOM * i) / (s.frames - 1), clip: CLIP, ox: ORIGIN[0], oy: ORIGIN[1] });
    if (i === PRESS_AT) await cap.eval((clip) => { document.querySelector(`.reel[data-clip="${clip}"] .like`).style.transform = 'scale(0.92)'; }, CLIP);
    if (i === TAP_AT) {
      // נקודת הלחיצה נמדדת לפני הלחיצה: אחריה הכפתור מתרחב (נוסף המונה) והמרכז שלו זז
      tap = await cap.eval((clip) => {
        const like = document.querySelector(`.reel[data-clip="${clip}"] .like`);
        like.style.transform = '';
        const b = like.getBoundingClientRect();
        like.click();
        if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
        return { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
      }, CLIP);
    }
  });

  const end = await cap.eval(REEL_STATE, CLIP);
  console.log(`${NAME} end: ${JSON.stringify(end)}`);
  assert(end.tab === 'clips' && end.first === CLIP && end.feedTop === 0 && end.reelBox[1] === 0 && end.title === TITLE, 'the feed moved away from the GTA VI Trailer 2 reel');
  assert(/is-liked/.test(end.like.cls) && end.like.pressed === 'true' && end.like.text === '1', `like did not turn on: ${JSON.stringify(end.like)}`);
  assert(end.like.color === 'rgb(255, 77, 134)' && end.like.fill === end.like.color, `heart is not filled pink: ${JSON.stringify(end.like)}`);
  assert(end.toast === '' && end.yt === 'none' && end.poster.w === 1280, `unexpected toast / player: ${end.toast} / ${end.yt}`);
  assert(end.btns.every((x) => x.box[0] >= 0 && x.box[2] <= W && x.box[3] <= H), 'action buttons are clipped after the like');
  assert(tap && Math.abs(tap.x * DSF - (pre.like.box[0] + pre.like.box[2]) / 2) <= 2 && Math.abs(tap.y * DSF - (pre.like.box[1] + pre.like.box[3]) / 2) <= 2, `tap point ${JSON.stringify(tap)} is not on the like button`);
  return () => saveTap({ scene: NAME, frame: TAP_AT, x: tap.x * DSF, y: tap.y * DSF });
});

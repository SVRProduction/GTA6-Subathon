// צילום דטרמיניסטי, פריים-אחרי-פריים, של ה-build המקומי (dist) בכרום headless.
// השיטה: begin-frame control + זמן וירטואלי של CDP. כל פריים מתקדם בדיוק 1000/30 ms, והאנימציות (CSS, rAF, WebGL) זזות בסנכרון מלא.
// חשוב: לא להשתמש ב-page.screenshot / page.click / waitForTimeout (נתקעים תחת זמן וירטואלי) – רק cap.eval, cap.step, cap.record, cap.shot.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.resolve(ROOT, '..', 'dist');
const WORK = path.join(ROOT, 'work');
const FPS = 30;
const DT = 1000 / FPS;
const ORIGIN = 'http://trailer.local';
// "עכשיו" קבוע לכל הצילומים: 21.11.2026 17:00 שעון ישראל (יום 3 של הסאבתון בדמו)
const EPOCH = Date.UTC(2026, 10, 21, 15, 0, 0) / 1000;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.cjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.mp4': 'video/mp4' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function withTimeout(p, ms, label) {
  let t;
  return Promise.race([p, new Promise((_, rej) => (t = setTimeout(() => rej(new Error(`timeout ${ms}ms: ${label}`)), ms)))]).finally(() => clearTimeout(t));
}

// ── עד שני תהליכי צילום במקביל (4 ליבות, רינדור תוכנה) ──
async function acquireSlot() {
  const dir = path.join(WORK, 'locks');
  fs.mkdirSync(dir, { recursive: true });
  for (;;) {
    for (const n of [1, 2]) {
      const f = path.join(dir, `slot${n}`);
      try {
        fs.writeFileSync(f, String(process.pid), { flag: 'wx' });
        const release = () => { try { if (fs.readFileSync(f, 'utf8') === String(process.pid)) fs.unlinkSync(f); } catch {} };
        process.on('exit', release);
        return release;
      } catch {
        // נעול: אם התהליך שנעל כבר מת – משחררים
        try { process.kill(Number(fs.readFileSync(f, 'utf8')), 0); } catch { try { fs.unlinkSync(f); } catch {} }
      }
    }
    await sleep(1500);
  }
}

function serveFile(route, file) {
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: 'not found' });
  return route.fulfill({ status: 200, contentType: MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', body: fs.readFileSync(file) });
}

/**
 * פותח דף לצילום.
 * opts: { url (יחסי ל-dist, למשל '/?demo&time=18', או '/__overlay/index.html?aspect=16x9'), cssW, cssH, dsf=1, mobile=false,
 *         transparent=false, seed=true (נתוני דמו מסודרים מ-work/seed.json), viewer=false (צופה מחובר בדמו), initScript (מחרוזת JS), hideCss (CSS נוסף) }
 * גודל הפלט = cssW*dsf × cssH*dsf.
 */
async function open(opts) {
  const { url, cssW, cssH, dsf = 1, mobile = false, transparent = false, seed = true, viewer = false } = opts;
  const release = await acquireSlot();
  const browser = await chromium.launch({
    args: ['--enable-begin-frame-control', '--run-all-compositor-stages-before-draw', '--disable-new-content-rendering-timeout', '--disable-threaded-animation', '--disable-threaded-scrolling', '--disable-checker-imaging', '--disable-image-animation-resync', `--force-device-scale-factor=${dsf}`, '--autoplay-policy=no-user-gesture-required'],
  });
  const ctx = await browser.newContext({ viewport: { width: cssW, height: cssH }, deviceScaleFactor: dsf, locale: 'he-IL', timezoneId: 'Asia/Jerusalem', ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    try {
      if (u.origin === ORIGIN) {
        if (u.pathname.startsWith('/__overlay/')) return serveFile(route, path.join(ROOT, 'overlay', u.pathname.slice('/__overlay/'.length)));
        if (u.pathname.startsWith('/__work/')) return serveFile(route, path.join(WORK, u.pathname.slice('/__work/'.length)));
        if (u.pathname === '/__timeline.json') return serveFile(route, path.join(ROOT, 'timeline.json'));
        if (u.pathname.startsWith('/__trailer/')) return serveFile(route, path.join(ROOT, u.pathname.slice('/__trailer/'.length)));
        const rel = u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname.slice(1));
        return serveFile(route, path.join(DIST, rel));
      }
      // גופנים: נשמרים במטמון מקומי בפעם הראשונה (דטרמיניסטי, ועובד גם בלי רשת)
      if (u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com') {
        const dir = path.join(WORK, 'fonts');
        fs.mkdirSync(dir, { recursive: true });
        const key = crypto.createHash('sha1').update(u.href).digest('hex');
        const f = path.join(dir, key);
        if (!fs.existsSync(f)) {
          const r = await route.fetch();
          fs.writeFileSync(f, await r.body());
          fs.writeFileSync(`${f}.type`, r.headers()['content-type'] || '');
        }
        return route.fulfill({ status: 200, contentType: fs.readFileSync(`${f}.type`, 'utf8') || undefined, body: fs.readFileSync(f), headers: { 'access-control-allow-origin': '*' } });
      }
      // תמונות התצוגה של הטריילרים (מה שהטלפון מציג): רק מהעותק המקומי ב-work/ytimg
      if (u.hostname === 'i.ytimg.com') {
        const m = u.pathname.match(/^\/vi\/([\w-]+)\/([\w-]+\.jpg)$/);
        if (m) return serveFile(route, path.join(WORK, 'ytimg', m[1], m[2]));
      }
    } catch (e) {
      return route.fulfill({ status: 500, body: String(e) });
    }
    return route.abort(); // Kick, יוטיוב וכו' – לא בצילום
  });
  // זרע קבוע ל-Math.random, נתוני דמו מסודרים, וצופה מחובר (לפי הצורך)
  const seedJson = seed && fs.existsSync(path.join(WORK, 'seed.json')) ? fs.readFileSync(path.join(WORK, 'seed.json'), 'utf8') : null;
  await ctx.addInitScript(`(() => {
    let s = 1234567; Math.random = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    try {
      ${seedJson ? `if (!localStorage.getItem('journey-demo-v9')) localStorage.setItem('journey-demo-v9', ${JSON.stringify(seedJson)});` : ''}
      ${viewer ? `localStorage.setItem('kick-viewer', JSON.stringify({ token: 'demo', kick_user_id: 'demo-צופה', username: 'צופה', avatar: null }));` : ''}
    } catch {}
    ${opts.initScript || ''}
  })();`);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const cdp = await ctx.newCDPSession(page);
  if (transparent) await cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  const { virtualTimeTicksBase: base } = await cdp.send('Emulation.setVirtualTimePolicy', { policy: 'pause', initialVirtualTime: EPOCH });
  await withTimeout(page.goto(ORIGIN + url, { waitUntil: 'commit' }), 30000, 'goto');

  let t = 0;
  let last = null;
  /** מתקדם פריים אחד (33.33ms וירטואליים). shoot=true מחזיר PNG (Buffer) */
  async function frame(shoot) {
    const expired = new Promise((r) => cdp.once('Emulation.virtualTimeBudgetExpired', r));
    await withTimeout(cdp.send('Emulation.setVirtualTimePolicy', { policy: 'pauseIfNetworkFetchesPending', budget: DT }), 30000, 'budget');
    await withTimeout(expired, 30000, 'budgetExpired');
    t += DT;
    const r = await withTimeout(cdp.send('HeadlessExperimental.beginFrame', { frameTimeTicks: base + t, interval: DT, noDisplayUpdates: false, ...(shoot ? { screenshot: { format: 'png', optimizeForSpeed: true } } : {}) }), 60000, 'beginFrame');
    if (shoot) {
      if (r.screenshotData) last = Buffer.from(r.screenshotData, 'base64');
      return last;
    }
    return null;
  }
  const cap = {
    page,
    errors,
    fps: FPS,
    outW: Math.round(cssW * dsf),
    outH: Math.round(cssH * dsf),
    /** מריץ קוד בדף (כמו page.evaluate). ללחיצות: el.click() בתוך eval */
    eval: (fn, arg) => withTimeout(page.evaluate(fn, arg), 30000, 'eval'),
    /** מתקדם n פריימים בלי לצלם */
    async step(n = 1) { for (let i = 0; i < n; i++) await frame(false); },
    /** מחכה (בפריימים) עד שהגופנים נטענו והתנאי מתקיים, ואז עוד settle פריימים */
    async ready(predicate, { settle = 30, max = 600 } = {}) {
      for (let i = 0; i < max; i++) {
        await frame(false);
        const ok = await cap.eval(async (src) => {
          if (document.fonts.status !== 'loaded') return false;
          return src ? !!(await (0, eval)(`(${src})`)()) : true;
        }, predicate ? predicate.toString() : null);
        if (ok) { await cap.step(settle); return; }
      }
      throw new Error('ready(): timeout');
    },
    /** CSS לצילום בלבד (הסתרת כפתורי בדיקה וכו') */
    css: (text) => cap.eval((c) => { const s = document.createElement('style'); s.textContent = c; document.head.append(s); }, text),
    /** שומר פריים אחד כ-PNG (לבדיקה בעין) */
    async shot(file) { const b = await frame(true); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, b); return file; },
    /**
     * מצלם nFrames פריימים לקובץ ביניים (libx264rgb, ללא איבוד נראה). before(i) רץ לפני כל פריים (פעולות בדף).
     * opts.vf: פילטר ffmpeg נוסף (למשל scale/crop לתקריב). opts.png: תיקייה לשמירת רצף PNG במקום וידאו (לשכבת הכתוביות השקופה).
     */
    async record(out, nFrames, before, o = {}) {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      let ff = null;
      if (o.png) fs.mkdirSync(o.png, { recursive: true });
      else {
        ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-', ...(o.vf ? ['-vf', o.vf] : []), '-frames:v', String(nFrames), '-c:v', 'libx264rgb', '-crf', '10', '-preset', 'veryfast', '-g', '15', out], { stdio: ['pipe', 'inherit', 'inherit'] });
      }
      const t0 = Date.now();
      for (let i = 0; i < nFrames; i++) {
        if (before) await before(i);
        const b = await frame(true);
        if (o.png) fs.writeFileSync(path.join(o.png, `${String(i).padStart(5, '0')}.png`), b);
        else if (!ff.stdin.write(b)) await new Promise((r) => ff.stdin.once('drain', r));
      }
      if (ff) {
        ff.stdin.end();
        const code = await new Promise((r) => ff.on('close', r));
        if (code !== 0) throw new Error(`ffmpeg exit ${code}`);
      }
      console.log(`recorded ${nFrames} frames -> ${o.png || out} (${((Date.now() - t0) / nFrames).toFixed(0)} ms/frame)${errors.length ? ` pageerrors: ${errors.slice(0, 3).join(' | ')}` : ''}`);
    },
    async close() { await browser.close().catch(() => {}); release(); },
  };
  return cap;
}

// ── קבועים משותפים לסצנות ──
/** גדלי צילום: מפה לרוחב / מפה לאורך (נשארת במצב מחשב, רוחב > 760) / טלפון */
const VIEW = {
  map16: { cssW: 1280, cssH: 720, dsf: 1.5 }, // -> 1920x1080
  map9: { cssW: 864, cssH: 1536, dsf: 1.25 }, // -> 1080x1920
  phone: { cssW: 360, cssH: 640, dsf: 3, mobile: true }, // -> 1080x1920
};
/** CSS לצילום המפה: מסתיר כפתורים וסרגלים שלא שייכים לטריילר, ומרחיב את גוון השקיעה/לילה גם לים שמסביב למפה */
const MAP_CSS = `.fx-test,.tb,.phone-btn,.locator,.hud__actions,.rail,.here-fab,.explore-close,.poll-chip,.ticker,.profile{display:none!important}
.world > .tod__tint{inset:-140% !important}`;
/** CSS לצילום הטלפון: בלי כפתור ההתקנה (נדחס בכותרת) ובלי נגן יוטיוב (נשארת תמונת הקליפ) */
const PHONE_CSS = `.bar__install{display:none!important} .reel__yt{display:none!important}`;
/** המפה מוכנה: סיכות, מסלול ופנסים */
const MAP_READY = () => document.querySelectorAll('.pin').length > 10 && document.querySelector('.journey__stage').classList.contains('is-ready') && document.querySelectorAll('.lamps circle').length > 100;
/** גלילת עכבר במפה: ‎-300 = עצירה אחת קדימה, ‎+300 = אחורה */
const WHEEL = (dy) => window.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, bubbles: true, cancelable: true }));

module.exports = { open, ROOT, DIST, WORK, FPS, DT, ORIGIN, EPOCH, VIEW, MAP_CSS, PHONE_CSS, MAP_READY, WHEEL };

const { open, WORK } = require('../lib/harness.cjs');
const path = require('path');
(async () => {
  // 1) הקלטה לקובץ ביניים
  let cap = await open({ url: '/?demo&time=21', cssW: 1280, cssH: 720, dsf: 1.5 });
  await cap.ready(() => document.querySelectorAll('.pin').length > 10 && document.querySelector('.journey__stage').classList.contains('is-ready'));
  await cap.css('.fx-test,.tb,.phone-btn,.locator,.hud__actions,.rail,.here-fab,.opening{display:none!important} .world > .tod__tint{inset:-140% !important}');
  await cap.record(path.join(WORK, 'test', 'rec.mkv'), 24, async (i) => { if (i === 4) await cap.eval(() => window.dispatchEvent(new WheelEvent('wheel', { deltaY: -300, bubbles: true, cancelable: true }))); });
  await cap.close();
  // 2) שכבה שקופה כ-PNG
  cap = await open({ url: '/__trailer/overlay/_probe.html', cssW: 1920, cssH: 1080, dsf: 1, transparent: true, seed: false });
  await cap.ready(null, { settle: 5 });
  await cap.record('', 6, async (i) => { await cap.eval((f) => window.seek(f), i); }, { png: path.join(WORK, 'test', 'ovl') });
  await cap.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });

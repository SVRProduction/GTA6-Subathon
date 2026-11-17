// בדיקת המנגנון: כמה פריימים מהמפה בשני הפורמטים ומהטלפון, לבדיקה בעין
const { open, WORK } = require('../lib/harness.cjs');
const path = require('path');
(async () => {
  const which = process.argv[2] || '16x9';
  const cfg = which === '16x9' ? { cssW: 1280, cssH: 720, dsf: 1.5 } : which === '9x16' ? { cssW: 864, cssH: 1536, dsf: 1.25 } : { cssW: 360, cssH: 640, dsf: 3, mobile: true };
  const url = which === 'phone' ? '/phone.html?demo' : '/?demo&time=18';
  const cap = await open({ url, ...cfg });
  const t0 = Date.now();
  await cap.ready(which === 'phone' ? () => !!document.querySelector('.ring') : () => document.querySelectorAll('.pin').length > 10 && document.querySelector('.journey__stage').classList.contains('is-ready'));
  console.log('ready in', Date.now() - t0, 'ms; out', cap.outW, 'x', cap.outH);
  const dir = path.join(WORK, 'test', which);
  await cap.shot(path.join(dir, 'a-loaded.png'));
  if (which !== 'phone') {
    await cap.css('.fx-test, .tb, .phone-btn, .locator, .hud__actions, .rail, .here-fab { display: none !important; }');
    await cap.eval(() => document.querySelector('[data-jump-now]').click());
    await cap.step(75);
    await cap.shot(path.join(dir, 'b-jump.png'));
    const pos = await cap.eval(() => ({ odo: document.querySelector('[data-odo-stop]').textContent, tilt: document.querySelector('.tilt').style.transform, panel: document.querySelector('.panel').hasAttribute('data-open') }));
    console.log(JSON.stringify(pos));
    await cap.eval(() => document.querySelector('[data-panel-close]')?.click());
    await cap.step(30);
    await cap.shot(path.join(dir, 'c-closed.png'));
  } else {
    await cap.step(20);
    await cap.shot(path.join(dir, 'b-home.png'));
  }
  console.log('errors:', cap.errors.slice(0, 3));
  await cap.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });

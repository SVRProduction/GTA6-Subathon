#!/usr/bin/env node
// שכבת הכתוביות/גרפיקה השקופה של הטריילר -> רצף PNG (RGBA) לכל פורמט.
//
//   node capture-overlay.cjs 16x9|9x16|both                 רינדור מלא: work/overlay/<aspect>/00000.png..01349.png
//   node capture-overlay.cjs both --range 900-1125           רינדור מחדש של טווח פריימים בלבד [from,to) (למשל אחרי ש-taps.json נוצר)
//   node capture-overlay.cjs 16x9 --frames 10,70,150 [--out dir]   פריימים בודדים לבדיקה בעין, אל <dir>/<aspect>/ (ברירת מחדל: work/tmp/overlay/frames)
//   node capture-overlay.cjs both --check                    בלי צילום: עובר על כל הפריימים ובודק ש-captionBoxes בתוך האזור הבטוח
//
// הדף (overlay/index.html) חושף window.seek(frame): פונקציה טהורה של מספר הפריים, אז אפשר לרנדר כל טווח בנפרד ולקבל אותו פלט.
const fs = require('fs');
const path = require('path');
const { open, WORK } = require('./lib/harness.cjs');
const { T, totalFrames } = require('./lib/timeline.cjs');

const SIZE = { '16x9': { cssW: 1920, cssH: 1080 }, '9x16': { cssW: 1080, cssH: 1920 } };
const pad = (n) => String(n).padStart(5, '0');

function parseArgs(argv) {
  const a = { aspects: null, frames: null, range: null, out: null, check: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '16x9' || v === '9x16') a.aspects = [v];
    else if (v === 'both') a.aspects = ['16x9', '9x16'];
    else if (v === '--frames') a.frames = argv[++i].split(',').map(Number);
    else if (v === '--range') { const [x, y] = argv[++i].split('-').map(Number); a.range = [x, y]; }
    else if (v === '--out') a.out = path.resolve(argv[++i]);
    else if (v === '--check') a.check = true;
    else throw new Error(`unknown argument: ${v}`);
  }
  if (!a.aspects) throw new Error('usage: node capture-overlay.cjs 16x9|9x16|both [--range from-to | --frames a,b,c [--out dir] | --check]');
  if (a.frames && a.frames.some((f) => !Number.isInteger(f) || f < 0 || f >= totalFrames)) throw new Error('--frames: bad frame number');
  if (a.range && !(Number.isInteger(a.range[0]) && Number.isInteger(a.range[1]) && a.range[0] >= 0 && a.range[1] <= totalFrames && a.range[0] < a.range[1])) throw new Error('--range: expected from-to with 0 <= from < to <= ' + totalFrames);
  return a;
}

async function run(aspect, args) {
  const cap = await open({ url: `/__trailer/overlay/index.html?aspect=${aspect}`, ...SIZE[aspect], dsf: 1, transparent: true, seed: false });
  try {
    await cap.ready(() => window.__overlayReady === true || !!window.__overlayError, { settle: 5 });
    const err = await cap.eval(() => window.__overlayError || null);
    if (err) throw new Error(`overlay init failed: ${err}`);
    const info = await cap.eval(() => window.overlayInfo());
    console.log(`[${aspect}] ready: ${JSON.stringify(info)}`);
    if (!info.fontsOk) throw new Error('fonts did not load');
    if (info.frames !== totalFrames) throw new Error(`page computed ${info.frames} frames, expected ${totalFrames}`);

    if (args.check) {
      // בדיקת אזור בטוח על כל הפריימים (בלי צילום)
      const safe = T.layout[aspect].safe;
      const bad = [];
      let transient = 0;
      let boxes = 0;
      for (let from = 0; from < totalFrames; from += 150) {
        const res = await cap.eval(([a, b, s]) => {
          const out = { bad: [], transient: 0, boxes: 0 };
          for (let f = a; f < b; f++) {
            for (const c of window.captionBoxes(f)) {
              out.boxes++;
              const inside = c.x >= s.x0 - 0.5 && c.y >= s.y0 - 0.5 && c.x + c.w <= s.x1 + 0.5 && c.y + c.h <= s.y1 + 0.5;
              if (inside) continue;
              if (!c.settled) { out.transient++; continue; }
              out.bad.push({ f, ...c });
            }
          }
          return out;
        }, [from, Math.min(totalFrames, from + 150), safe]);
        bad.push(...res.bad);
        transient += res.transient;
        boxes += res.boxes;
      }
      console.log(`[${aspect}] check: ${boxes} caption boxes over ${totalFrames} frames; outside safe box while settled: ${bad.length}; outside only during a punch-in/out transient: ${transient}`);
      for (const b of bad.slice(0, 20)) console.log('   BAD', JSON.stringify(b));
      if (bad.length) process.exitCode = 2;
    } else if (args.frames) {
      const dir = path.join(args.out || path.join(WORK, 'tmp', 'overlay', 'frames'), aspect);
      for (const f of args.frames) {
        await cap.eval((n) => window.seek(n), f);
        await cap.shot(path.join(dir, `${pad(f)}.png`));
      }
      console.log(`[${aspect}] ${args.frames.length} sample frames -> ${dir}`);
    } else {
      const dir = path.join(WORK, 'overlay', aspect);
      const [from, to] = args.range || [0, totalFrames];
      fs.mkdirSync(dir, { recursive: true });
      // מצלמים לתיקייה זמנית ומעבירים בסוף, כדי שרינדור שנקטע לא ישאיר רצף חצי-חדש
      const tmp = path.join(WORK, 'tmp', 'overlay', `render-${aspect}-${process.pid}`);
      fs.rmSync(tmp, { recursive: true, force: true });
      await cap.record('', to - from, async (i) => cap.eval((f) => window.seek(f), from + i), { png: tmp });
      if (!args.range) for (const n of fs.readdirSync(dir)) if (/^\d{5}\.png$/.test(n)) fs.unlinkSync(path.join(dir, n));
      for (let i = 0; i < to - from; i++) fs.renameSync(path.join(tmp, `${pad(i)}.png`), path.join(dir, `${pad(from + i)}.png`));
      fs.rmSync(tmp, { recursive: true, force: true });
      const n = fs.readdirSync(dir).filter((x) => /^\d{5}\.png$/.test(x)).length;
      console.log(`[${aspect}] frames ${from}..${to - 1} -> ${dir} (${n} png in directory)`);
      if (n !== totalFrames) throw new Error(`${dir}: ${n} png files, expected ${totalFrames}`);
    }
    if (cap.errors.length) throw new Error(`page errors: ${cap.errors.join(' | ')}`);
  } finally {
    await cap.close();
  }
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  for (const aspect of args.aspects) await run(aspect, args); // אחד-אחד: יש רק שתי משבצות צילום לכל המכונה
})().catch((e) => { console.error('FAIL', e); process.exit(1); });

#!/usr/bin/env node
// שבעת השוטים של GTA 6 מתמונות סטילס -> work/scenes/<aspect>/gtaN.mkv
//
//   node footage/make-shots.cjs [gtaN ...] [16x9|9x16|both] [--plan] [--bare] [--debug] [--png] [--out <dir תחת work/>] [--look '{"grain":0.2}']
//
// לכל שוט וליחס:
//   1. הגיאומטריה (shot-math.cjs) מחושבת לכל הפריימים ונבדקת: החלון תמיד בתוך אזור התמונה (אין שוליים שחורים),
//      מלבני keep שלמים בפריים ומלבני avoid לגמרי בחוץ. אם משהו מופר – נכשלים לפני שמצלמים.
//   2. המקור מוכן פעם אחת (prep-still.py): רק האזור שהשוט רואה, מוגדל ב-Lanczos לגודל שבו הדפדפן רק מקטין מעט.
//   3. still.html מצולם במנגנון הדטרמיניסטי: seek(frame, total) לפני כל פריים, בדיוק slot(name).frames פריימים.
//   4. הקובץ נכתב ל-work/tmp/gta/render, נבדק ב-ffprobe, ורק אז מועבר ליעד.
//
// --plan  רק מדפיס את הגיאומטריה. --bare בלי גימור (גרייד/גוון/וינייטה/גרעין/שוליים כרומטיים). --debug מוסיף ריבועי סנכרון
// (מספר הפריים מקודד בצבע, פעם ב-DOM ופעם בקנבס), מצלם ל-work/tmp/gta/debug ובודק שכל פריים בקובץ מציג את ה-seek שלו.
// --png שומר רצף PNG (בלי קידוד וידאו) ל-work/tmp/gta/png/<aspect>/<name>/ – לבדיקות פיקסל מדויקות.
const { execFileSync, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { open, WORK, ROOT } = require('../lib/harness.cjs');
const { slot } = require('../lib/timeline.cjs');
const M = require('./shot-math.cjs');

const SHOTS_FILE = path.join(ROOT, 'shots.json');
const TMP = path.join(WORK, 'tmp', 'gta');
const PREP = path.join(__dirname, 'prep-still.py');
const MIN_MARGIN = 1; // פיקסל מקור אחד לפחות בין החלון לקצה התמונה: הקצה המוחלק של התמונה לעולם לא נראה
const KEEP_MARGIN = 4; // מרווח מינימלי (פיקסלי מקור) בין לוגו שחייב להישאר שלם לקצה הפריים
const AVOID_GAP = 4; // מרחק מינימלי (פיקסלי מקור) בין כיתוב שחייב להישאר בחוץ לקצה הפריים
const TAKE_TIMEOUT = 240000; // תקרה לצילום של שוט אחד (ms), כדי שתהליך לעולם לא יישאר תלוי

let current = null; // ה-cap הפתוח, לסגירה מסודרת ב-SIGINT/SIGTERM
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, async () => {
    console.error(`\n${sig}: closing the capture`);
    try { if (current) await current.close(); } catch {}
    process.exit(130);
  });
}

function parseArgs(argv) {
  const o = { names: [], aspects: ['16x9', '9x16'], plan: false, bare: false, debug: false, png: false, out: 'scenes', look: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (/^gta\d+$/.test(a)) o.names.push(a);
    else if (a === 'both') o.aspects = ['16x9', '9x16'];
    else if (M.SIZE[a]) o.aspects = [a];
    else if (a === '--plan') o.plan = true;
    else if (a === '--bare') o.bare = true;
    else if (a === '--debug') o.debug = true;
    else if (a === '--png') o.png = true;
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--look') o.look = JSON.parse(argv[++i]);
    else {
      console.error(`unknown argument "${a}"\nusage: node footage/make-shots.cjs [gtaN ...] [16x9|9x16|both] [--plan] [--bare] [--debug] [--png] [--out <dir under work/>] [--look '{json}']`);
      process.exit(2);
    }
  }
  if (o.debug) o.out = 'tmp/gta/debug';
  if (o.png && o.out === 'scenes') o.out = 'tmp/gta/png';
  if (path.isAbsolute(o.out) || o.out.split(/[\\/]/).includes('..')) { console.error('--out must be a directory under work/'); process.exit(2); }
  return o;
}

function probe(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames,width,height,r_frame_rate,pix_fmt', '-of', 'json', file], { encoding: 'utf8' });
  const s = JSON.parse(out).streams[0];
  return { frames: Number(s.nb_read_frames), w: s.width, h: s.height, fps: s.r_frame_rate, pix: s.pix_fmt };
}

const fx = (v, d = 1) => Number(v).toFixed(d);

/** מפרט מלא + תוכנית הכנה לשוט אחד ביחס אחד; זורק אם הגיאומטריה מפרה את אחד התנאים */
function design(shots, name, aspect, opts) {
  const shot = shots[name];
  if (!shot) throw new Error(`shots.json: no shot "${name}"`);
  const src = path.resolve(ROOT, shot.src);
  if (!src.startsWith(WORK + path.sep)) throw new Error(`${name}: src must live under work/ (${shot.src})`);
  if (!fs.existsSync(src)) throw new Error(`${name}: missing source ${shot.src}`);
  if (/\.(mp4|mov|mkv|webm)$/i.test(src)) throw new Error(`${name}: video sources are not wired in yet (the shots.json fields are ready for them: src + "in")`);
  const p = probe(src);
  const spec = M.resolve(shots, name, aspect, [p.w, p.h]);
  if (opts.bare) spec.look = { ...spec.look, contrast: 1, saturate: 1, brightness: 1, tone: 0, vignette: 0, grain: 0, chroma: 0 };
  if (opts.look) spec.look = { ...spec.look, ...opts.look };
  const n = slot(name).frames;
  const pl = M.plan(spec, n);
  const where = `${name} ${aspect}`;
  if (!(pl.margin >= MIN_MARGIN)) throw new Error(`${where}: the window leaves the picture area (margin ${fx(pl.margin, 2)}px at frame ${pl.worst}; need >= ${MIN_MARGIN}) - lower the zoom range / pan / drift or move the focus`);
  if (spec.keep.length && !(pl.keepMargin >= KEEP_MARGIN)) throw new Error(`${where}: a "keep" rect gets cut by the frame edge (margin ${fx(pl.keepMargin, 2)}px; need >= ${KEEP_MARGIN})`);
  if (spec.avoid.length && !(pl.avoidGap >= AVOID_GAP)) throw new Error(`${where}: an "avoid" rect enters the frame (gap ${fx(pl.avoidGap, 2)}px; need >= ${AVOID_GAP})`);

  // האזור שההכנה מגדילה: המלבן שמכיל את כל החלונות + 2 פיקסלים, בתוך האזור הפעיל, על פיקסלים שלמים
  const a = spec.active;
  const r = {
    x0: Math.max(Math.ceil(a.x0), Math.floor(pl.box.x0 - 2)), y0: Math.max(Math.ceil(a.y0), Math.floor(pl.box.y0 - 2)),
    x1: Math.min(Math.floor(a.x1), Math.ceil(pl.box.x1 + 2)), y1: Math.min(Math.floor(a.y1), Math.ceil(pl.box.y1 + 2)),
  };
  if (r.x0 > pl.box.x0 || r.y0 > pl.box.y0 || r.x1 < pl.box.x1 || r.y1 < pl.box.y1) throw new Error(`${where}: prep rect does not cover the windows`);
  // בגודל הזה הפריים הקרוב ביותר (כולל ערוץ הצבע המוגדל ביותר) מצויר 1:1, וכל השאר בהקטנה קלה
  const k = pl.magMax * (1 + 2 * (spec.look.chroma || 0));
  const pw = Math.ceil((r.x1 - r.x0) * k), ph = Math.ceil((r.y1 - r.y0) * k);
  const st = fs.statSync(src);
  const key = crypto.createHash('sha1').update(JSON.stringify([shot.src, st.size, st.mtimeMs, r, pw, ph, spec.look.denoise, spec.look.sharpen, fs.readFileSync(PREP, 'utf8')])).digest('hex').slice(0, 10);
  const prepRel = `tmp/gta/prep/${name}-${aspect}-${key}.png`;
  return { name, aspect, n, spec, pl, src, prep: { file: path.join(WORK, prepRel), url: `/__work/${prepRel}`, x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1, w: pw, h: ph, kx: pw / (r.x1 - r.x0), ky: ph / (r.y1 - r.y0) } };
}

function report(d) {
  const { spec: s, pl, prep } = d;
  const win = (v) => `x ${fx(v.cx - v.w / 2)}..${fx(v.cx + v.w / 2)}  y ${fx(v.cy - v.h / 2)}..${fx(v.cy + v.h / 2)}  (x${fx(v.mag, 3)})`;
  console.log(`${d.name} ${d.aspect}: ${d.n} frames, ${path.relative(ROOT, d.src)}`);
  console.log(`  first ${win(pl.first)}\n  last  ${win(pl.last)}`);
  console.log(`  edge margin ${fx(pl.margin, 2)}px${s.keep.length ? `, keep margin ${fx(pl.keepMargin, 2)}px` : ''}${s.avoid.length ? `, avoid gap ${fx(pl.avoidGap, 2)}px` : ''}, prep [${prep.x0},${prep.y0},${prep.x1},${prep.y1}] -> ${prep.w}x${prep.h}`);
}

function prepare(d) {
  const { prep, spec } = d;
  if (fs.existsSync(prep.file)) return;
  fs.mkdirSync(path.dirname(prep.file), { recursive: true });
  const tmp = `${prep.file}.part.png`;
  const r = spawnSync('python3', [PREP, d.src, tmp, prep.x0, prep.y0, prep.x1, prep.y1, prep.w, prep.h, spec.look.denoise == null ? 3 : spec.look.denoise, spec.look.sharpen == null ? 0.7 : spec.look.sharpen].map(String), { stdio: ['ignore', 'inherit', 'inherit'], timeout: 120000 });
  if (r.status !== 0) throw new Error(`prep-still.py failed for ${d.name} ${d.aspect} (exit ${r.status})`);
  fs.renameSync(tmp, prep.file);
}

/** --debug: קורא את ריבועי הסנכרון מהקובץ המוקלט ומוודא שפריים i מציג את seek(i), גם ב-DOM וגם בקנבס */
function checkSync(file, d) {
  const read = (x) => {
    const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `crop=16:16:${x}:16`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 });
    if (r.status !== 0) throw new Error(`ffmpeg failed reading ${file}`);
    const out = [];
    for (let i = 0; i < d.n; i++) {
      const o = i * 16 * 16 * 3 + (8 * 16 + 8) * 3; // הפיקסל האמצעי של הריבוע
      const q = (v) => Math.round((v - 32) / 64);
      out.push(q(r.stdout[o]) + 4 * q(r.stdout[o + 1]) + 16 * q(r.stdout[o + 2]));
    }
    return out;
  };
  const dom = read(16), cv = read(d.spec.W - 32);
  const bad = [];
  for (let i = 0; i < d.n; i++) if (dom[i] !== i || cv[i] !== i) bad.push(`frame ${i}: dom=${dom[i]} canvas=${cv[i]}`);
  if (bad.length) throw new Error(`frame sync broken in ${file}:\n  ${bad.slice(0, 8).join('\n  ')}`);
  console.log(`  sync ok: all ${d.n} frames show their own seek() on the DOM layer and on the canvas layer`);
}

async function take(d, opts) {
  const [W, H] = M.SIZE[d.aspect];
  const dest = path.join(WORK, opts.out, d.aspect, `${d.name}.mkv`);
  const tmp = path.join(TMP, 'render', `${d.name}-${d.aspect}-${process.pid}.mkv`);
  const pngDir = opts.png ? path.join(WORK, opts.out, d.aspect, d.name) : null;
  if (pngDir) fs.rmSync(pngDir, { recursive: true, force: true });
  prepare(d);
  const cap = await open({ url: '/__trailer/footage/still.html', cssW: W, cssH: H, dsf: 1, seed: false });
  current = cap;
  let timer;
  try {
    await Promise.race([
      (async () => {
        await cap.ready(() => typeof window.setup === 'function' && typeof window.ShotMath === 'object', { settle: 1 });
        await cap.eval((plan) => window.setup(plan), { spec: d.spec, prep: { url: d.prep.url, x0: d.prep.x0, y0: d.prep.y0, kx: d.prep.kx, ky: d.prep.ky }, n: d.n, debug: !!opts.debug });
        await cap.ready(() => { if (window.__error) throw new Error(window.__error); return window.__ready === true; }, { settle: 2 });
        const size = await cap.eval(() => { const im = document.querySelector('.chan img'); return [im.naturalWidth, im.naturalHeight]; });
        if (size[0] !== d.prep.w || size[1] !== d.prep.h) throw new Error(`prepared image is ${size.join('x')}, expected ${d.prep.w}x${d.prep.h}`);
        await cap.record(tmp, d.n, async (i) => {
          const ok = await cap.eval(([f, n]) => window.seek(f, n) && window.__frame, [i, d.n]);
          if (ok !== i) throw new Error(`seek(${i}) did not apply`);
        }, pngDir ? { png: pngDir } : {});
        if (cap.errors.length) throw new Error(`page errors: ${cap.errors.join(' | ')}`);
      })(),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`take timed out after ${TAKE_TIMEOUT / 1000}s`)), TAKE_TIMEOUT); }),
    ]);
  } finally {
    clearTimeout(timer);
    await cap.close();
    current = null;
  }
  if (pngDir) {
    const got = fs.readdirSync(pngDir).filter((f) => f.endsWith('.png')).length;
    if (got !== d.n) throw new Error(`bad take ${d.name} ${d.aspect}: ${got} png frames, expected ${d.n}`);
    console.log(`ok ${path.relative(ROOT, pngDir)}/: ${got} png frames`);
    return;
  }
  const p = probe(tmp);
  if (p.frames !== d.n || p.w !== W || p.h !== H || p.fps !== '30/1') {
    fs.rmSync(tmp, { force: true });
    throw new Error(`bad take ${d.name} ${d.aspect}: ${JSON.stringify(p)} (expected ${d.n} frames, ${W}x${H}, 30/1)`);
  }
  if (opts.debug) checkSync(tmp, d);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(tmp, dest);
  console.log(`ok ${path.relative(ROOT, dest)}: ${p.frames} frames, ${p.w}x${p.h}, ${p.fps} fps, ${p.pix}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const shots = JSON.parse(fs.readFileSync(SHOTS_FILE, 'utf8'));
  const names = opts.names.length ? opts.names : Object.keys(shots).filter((k) => /^gta\d+$/.test(k)).sort();
  // קודם מתכננים ובודקים את הכול, ורק אז מצלמים: טעות ב-shots.json נתפסת לפני הצילום הראשון
  const jobs = [];
  for (const aspect of opts.aspects) for (const name of names) jobs.push(design(shots, name, aspect, opts));
  for (const d of jobs) report(d);
  if (opts.plan) return;
  fs.mkdirSync(path.join(TMP, 'render'), { recursive: true });
  for (const d of jobs) await take(d, opts);
}

main().catch(async (e) => {
  console.error('FAIL make-shots:', e.message || e);
  try { if (current) await current.close(); } catch {}
  process.exit(1);
});

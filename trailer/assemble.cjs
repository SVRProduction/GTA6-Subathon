#!/usr/bin/env node
// הרכבת הטריילר: כל הסצנות לפי timeline.json + שכבת הכתוביות + הפסקול -> MP4 אחד לכל פורמט.
// שימוש (מתוך trailer/):  node assemble.cjs 16x9|9x16|both [--draft]
// --draft: סצנה חסרה מוחלפת בלוח צבע עם שם הסצנה, והקידוד מהיר ופחות איכותי.
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { T, slot, totalFrames } = require('./lib/timeline.cjs');

const ROOT = __dirname;
const WORK = path.join(ROOT, 'work');
const OUT = path.join(ROOT, 'out');
const TMP = path.join(WORK, 'tmp', 'assembly');
const args = process.argv.slice(2);
const DRAFT = args.includes('--draft');
const which = args.find((a) => !a.startsWith('--')) || 'both';
const ASPECTS = which === 'both' ? ['16x9', '9x16'] : [which];
const SAMPLES = (totalFrames / T.fps) * 48000; // 2,160,000

const sh = (cmd, a, opts = {}) => execFileSync(cmd, a, { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'], ...opts });

function probe(file) {
  const j = JSON.parse(sh('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames',
    '-show_entries', 'stream=width,height,nb_read_frames,r_frame_rate', '-of', 'json', file]));
  const s = j.streams[0];
  return { w: s.width, h: s.height, frames: Number(s.nb_read_frames), fps: s.r_frame_rate };
}

function slug(name, w, h, frames, i) {
  fs.mkdirSync(path.join(TMP, 'slugs'), { recursive: true });
  const f = path.join(TMP, 'slugs', `${name}-${w}x${h}.mkv`);
  const hue = (i * 47) % 360;
  sh('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
    `color=c=0x334455:s=${w}x${h}:r=${T.fps},hue=h=${hue}:s=3,drawtext=text='${name} %{n}':fontsize=${Math.round(w / 14)}:fontcolor=white:x=(w-tw)/2:y=(h-th)/2`,
    '-frames:v', String(frames), '-c:v', 'libx264rgb', '-crf', '18', '-preset', 'ultrafast', f]);
  return f;
}

/** מדידת עוצמה, ואז הגברה קבועה ל-14- LUFS (בלי דחיסה דינמית). אם השיא חורג, משתמשים ב-loudnorm. */
function audioFilter(wav) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', wav, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  const tail = r.stderr.slice(r.stderr.lastIndexOf('Summary:'));
  const I = Number((tail.match(/I:\s+(-?[\d.]+) LUFS/) || [])[1]);
  const TP = Number((tail.match(/Peak:\s+(-?[\d.]+) dBFS/) || [])[1]);
  if (!Number.isFinite(I) || !Number.isFinite(TP)) throw new Error('could not measure loudness of ' + wav);
  const gain = -14 - I;
  console.log(`  audio: measured I=${I} LUFS, TP=${TP} dBTP -> gain ${gain.toFixed(2)} dB (TP after: ${(TP + gain).toFixed(2)})`);
  const fit = `aresample=48000,apad,atrim=end_sample=${SAMPLES},asetpts=N/SR/TB`;
  if (TP + gain <= -1.0) return `volume=${gain.toFixed(3)}dB,${fit}`;
  return `loudnorm=I=-14:TP=-1.5:LRA=11,${fit}`;
}

function assemble(aspect) {
  const L = T.layout[aspect];
  const problems = [];
  const inputs = [];
  const real = [];
  T.scenes.forEach((sc, i) => {
    const s = slot(sc.name);
    const phone = sc.kind === 'phone';
    const want = phone ? { w: 1080, h: 1920 } : { w: L.w, h: L.h };
    let file = path.join(WORK, 'scenes', phone ? 'phone' : aspect, `${sc.name}.mkv`);
    let ok = fs.existsSync(file);
    let p = ok ? probe(file) : null;
    if (ok && (p.w !== want.w || p.h !== want.h)) { problems.push(`${sc.name}: size ${p.w}x${p.h}, expected ${want.w}x${want.h}`); ok = false; }
    if (ok && p.frames < s.frames) { problems.push(`${sc.name}: ${p.frames} frames, needs ${s.frames}`); ok = false; }
    if (!ok && !fs.existsSync(file)) problems.push(`${sc.name}: missing ${path.relative(ROOT, file)}`);
    if (!ok) file = slug(sc.name, want.w, want.h, s.frames, i);
    else real.push(sc.name);
    inputs.push({ sc, s, file, phone });
  });
  if (problems.length) {
    console.log(`  [${aspect}] problems:\n   - ` + problems.join('\n   - '));
    if (!DRAFT) throw new Error(`[${aspect}] inputs are not ready (use --draft to build with placeholders)`);
  }

  const ovDir = path.join(WORK, 'overlay', aspect);
  const ovFiles = fs.existsSync(ovDir) ? fs.readdirSync(ovDir).filter((f) => /^\d{5}\.png$/.test(f)).sort() : [];
  const hasOv = ovFiles.length >= totalFrames;
  if (!hasOv) {
    const msg = `overlay: ${ovFiles.length}/${totalFrames} frames in ${path.relative(ROOT, ovDir)}`;
    if (!DRAFT) throw new Error(`[${aspect}] ${msg}`);
    console.log(`  [${aspect}] ${msg} -> building without captions`);
  }
  const wav = path.join(WORK, 'audio', 'master.wav');
  if (!fs.existsSync(wav)) throw new Error('missing work/audio/master.wav (run: python3 audio/music.py)');

  // גרף הפילטרים: חיתוך מדויק של כל סצנה, שרשור, כתוביות, ורק בסוף המרה אחת ל-yuv420p
  const g = [];
  inputs.forEach(({ s, phone }, i) => {
    const head = `[${i}:v]trim=end_frame=${s.frames},setpts=PTS-STARTPTS,format=gbrp`;
    const r = L.phone;
    if (phone && !(r.x === 0 && r.y === 0 && r.w === L.w && r.h === L.h)) {   // טלפון בתוך מסגרת, על רקע מטושטש של אותו מסך
      g.push(`${head},split[p${i}a][p${i}b]`);
      g.push(`[p${i}a]scale=${L.w}:${L.h}:force_original_aspect_ratio=increase:flags=bicubic,crop=${L.w}:${L.h},gblur=sigma=36,colorchannelmixer=rr=0.38:gg=0.36:bb=0.44,format=gbrp,setsar=1[p${i}bg]`);
      g.push(`[p${i}b]scale=${r.w}:${r.h}:flags=lanczos,format=gbrp,setsar=1[p${i}fg]`);
      g.push(`[p${i}bg][p${i}fg]overlay=${r.x}:${r.y}:format=gbrp,setsar=1[v${i}]`);
    } else {
      g.push(`${head},setsar=1[v${i}]`);
    }
  });
  g.push(inputs.map((_, i) => `[v${i}]`).join('') + `concat=n=${inputs.length}:v=1:a=0,fps=${T.fps},format=gbrp[cat]`);
  const ovIn = inputs.length;
  if (hasOv) {
    g.push(`[${ovIn}:v]format=rgba,setpts=PTS-STARTPTS[ov]`);
    g.push(`[cat][ov]overlay=0:0:format=gbrp:alpha=straight:eof_action=pass[mix]`);
  } else g.push('[cat]null[mix]');
  g.push(`[mix]scale=in_range=full:out_range=tv:out_color_matrix=bt709:flags=accurate_rnd+full_chroma_int+bitexact,format=yuv420p[vout]`);
  const aIn = ovIn + (hasOv ? 1 : 0);
  g.push(`[${aIn}:a]${audioFilter(wav)}[aout]`);
  fs.mkdirSync(TMP, { recursive: true });
  const graph = path.join(TMP, `graph-${aspect}.txt`);
  fs.writeFileSync(graph, g.join(';\n') + '\n');

  fs.mkdirSync(OUT, { recursive: true });
  const out = path.join(OUT, `subathon-trailer-${aspect}${DRAFT ? '-draft' : ''}.mp4`);
  const cmd = ['-hide_banner', '-loglevel', 'error', '-stats', '-y'];
  inputs.forEach(({ file }) => cmd.push('-i', file));
  if (hasOv) cmd.push('-framerate', String(T.fps), '-start_number', String(parseInt(ovFiles[0], 10)), '-i', path.join(ovDir, '%05d.png'));
  cmd.push('-i', wav, '-filter_complex_script', graph, '-map', '[vout]', '-map', '[aout]',
    '-frames:v', String(totalFrames), '-r', String(T.fps), '-fps_mode', 'cfr',
    '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    ...(DRAFT ? ['-preset', 'veryfast', '-crf', '24'] : ['-preset', 'slow', '-crf', '17', '-maxrate', '24M', '-bufsize', '48M']),
    '-g', '60', '-bf', '2', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', out);
  console.log(`  [${aspect}] ffmpeg ${cmd.length} args, graph: ${path.relative(ROOT, graph)}`);
  const t0 = process.hrtime.bigint();
  const r = spawnSync('ffmpeg', cmd, { stdio: ['ignore', 'inherit', 'pipe'], encoding: 'utf8' });
  const errTail = (r.stderr || '').split(/\r|\n/).filter((l) => l.trim() && !/^frame=/.test(l.trim())).slice(-15).join('\n');
  if (r.status !== 0) throw new Error(`[${aspect}] ffmpeg failed:\n${errTail}`);
  if (errTail) console.log(errTail);
  const p = probe(out);
  const sec = Number(process.hrtime.bigint() - t0) / 1e9;
  if (p.frames !== totalFrames) throw new Error(`[${aspect}] output has ${p.frames} frames, expected ${totalFrames}`);

  const poster = path.join(OUT, `poster-${aspect}${DRAFT ? '-draft' : ''}.png`);
  sh('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', out, '-vf', `select=eq(n\\,${T.posterFrame || 1320})`, '-frames:v', '1', poster]);
  const mb = (fs.statSync(out).size / 1e6).toFixed(1);
  console.log(`  [${aspect}] OK ${path.relative(ROOT, out)}  ${p.w}x${p.h}  ${p.frames} frames  ${mb} MB  (${sec.toFixed(0)}s)` +
    `  real scenes: ${real.length}/${inputs.length}${real.length < inputs.length ? '  slugs: ' + inputs.filter((x) => !real.includes(x.sc.name)).map((x) => x.sc.name).join(',') : ''}`);
  return { out, real: real.length, total: inputs.length };
}

let failed = false;
for (const a of ASPECTS) {
  console.log(`== ${a}${DRAFT ? ' (draft)' : ''} ==`);
  try { assemble(a); } catch (e) { failed = true; console.error(String(e.message || e)); }
}
process.exit(failed ? 1 : 0);

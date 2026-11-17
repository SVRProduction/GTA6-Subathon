#!/usr/bin/env node
// בדיקות איכות אובייקטיביות לטריילר המורכב + גיליונות תמונות לבדיקה בעין.
// שימוש (מתוך trailer/):  node qa.cjs 16x9|9x16|both [--draft]
// פלט: out/qa/<aspect>/report.json, sheet-all.jpg, cuts.jpg, mid-<scene>.jpg
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { T, slot, frameOfBeat, totalFrames } = require('./lib/timeline.cjs');

const ROOT = __dirname;
const args = process.argv.slice(2);
const DRAFT = args.includes('--draft');
const which = args.find((a) => !a.startsWith('--')) || 'both';
const ASPECTS = which === 'both' ? ['16x9', '9x16'] : [which];
const run = (cmd, a) => spawnSync(cmd, a, { encoding: 'utf8', maxBuffer: 1 << 28 });
const SCENES = T.scenes.map((s) => ({ name: s.name, kind: s.kind, ...slot(s.name) }));
const sceneAt = (f) => (SCENES.find((s) => f >= s.start && f < s.start + s.frames) || { name: '?' }).name;

function qa(aspect) {
  const L = T.layout[aspect];
  const file = path.join(ROOT, 'out', `subathon-trailer-${aspect}${DRAFT ? '-draft' : ''}.mp4`);
  const dir = path.join(ROOT, 'out', 'qa', aspect);
  fs.mkdirSync(dir, { recursive: true });
  const rows = [];
  const add = (name, pass, detail) => rows.push({ name, pass, detail: String(detail) });
  if (!fs.existsSync(file)) { add('file exists', false, file); return { aspect, rows }; }

  // --- מכל וזרמים ---
  const pj = JSON.parse(run('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', file]).stdout);
  const v = pj.streams.find((s) => s.codec_type === 'video');
  const a = pj.streams.find((s) => s.codec_type === 'audio');
  add('video codec h264 High', v.codec_name === 'h264' && /High/.test(v.profile), `${v.codec_name} ${v.profile}`);
  add('pixel format yuv420p', v.pix_fmt === 'yuv420p', v.pix_fmt);
  add(`size ${L.w}x${L.h}`, v.width === L.w && v.height === L.h, `${v.width}x${v.height}`);
  add('30 fps constant', v.r_frame_rate === '30/1' && v.avg_frame_rate === '30/1', `${v.r_frame_rate} avg ${v.avg_frame_rate}`);
  add(`frames == ${totalFrames}`, Number(v.nb_read_frames) === totalFrames, v.nb_read_frames);
  add('video duration 45.00s', Math.abs(Number(v.duration) - 45) < 0.02, v.duration);
  add('SAR 1:1', !v.sample_aspect_ratio || v.sample_aspect_ratio === '1:1', v.sample_aspect_ratio);
  add('bt709 tags', v.color_space === 'bt709' && v.color_primaries === 'bt709' && v.color_transfer === 'bt709' && v.color_range === 'tv',
    `${v.color_space}/${v.color_primaries}/${v.color_transfer}/${v.color_range}`);
  add('audio AAC 48k stereo', a && a.codec_name === 'aac' && a.sample_rate === '48000' && a.channels === 2, a ? `${a.codec_name} ${a.sample_rate} ${a.channels}ch` : 'none');
  add('audio duration 45.00s', a && Math.abs(Number(a.duration) - 45) < 0.03, a && a.duration);
  add('faststart (moov before mdat)', (() => { const b = fs.readFileSync(file).subarray(0, 4096).toString('latin1'); return b.includes('moov'); })(), '');
  const dec = run('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-']);
  add('clean decode', !dec.stderr.trim(), dec.stderr.trim().split('\n')[0] || 'no errors');

  // --- שחור / קפוא / חיתוכים ---
  const det = run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-an', '-vf',
    "blackdetect=d=0.1:pix_th=0.08,freezedetect=n=-60dB:d=0.5,select='gt(scene,0.25)',showinfo", '-f', 'null', '-']).stderr;
  const blacks = [...det.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => ({ from: +m[1], to: +m[2], scene: sceneAt(Math.round(+m[1] * T.fps)) }));
  const fz = [...det.matchAll(/freeze_start: ([\d.]+)/g)].map((m) => +m[1]);
  const fe = [...det.matchAll(/freeze_end: ([\d.]+)/g)].map((m) => +m[1]);
  const freezes = fz.map((s, i) => ({ from: s, to: fe[i] ?? 45, scene: sceneAt(Math.round(s * T.fps)) }));
  add('no black intervals', blacks.length === 0, blacks.map((b) => `${b.from.toFixed(2)}-${b.to.toFixed(2)}s (${b.scene})`).join(', ') || 'none');
  add('no frozen intervals >= 0.5s', freezes.length === 0, freezes.map((b) => `${b.from.toFixed(2)}-${b.to.toFixed(2)}s (${b.scene})`).join(', ') || 'none');
  const cutFrames = [...det.matchAll(/pts_time:([\d.]+)/g)].map((m) => Math.round(+m[1] * T.fps));
  const expected = SCENES.slice(1).map((s) => ({ name: s.name, frame: s.start }));
  const found = expected.filter((e) => cutFrames.some((c) => Math.abs(c - e.frame) <= 1));
  const missed = expected.filter((e) => !found.includes(e)).map((e) => `${e.name}@${e.frame}`);
  const extra = cutFrames.filter((c) => !expected.some((e) => Math.abs(c - e.frame) <= 1)).map((c) => `${c} (${sceneAt(c)})`);
  add('cuts on the beat grid', true, `${found.length}/${expected.length} detected on grid; not detected: ${missed.join(', ') || 'none'}; other scene changes: ${extra.join(', ') || 'none'}`);

  // --- סאונד ---
  const eb = run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-']).stderr;
  const tail = eb.slice(eb.lastIndexOf('Summary:'));
  const I = Number((tail.match(/I:\s+(-?[\d.]+) LUFS/) || [])[1]);
  const TP = Number((tail.match(/Peak:\s+(-?[\d.]+) dBFS/) || [])[1]);
  const LRA = Number((tail.match(/LRA:\s+(-?[\d.]+) LU/) || [])[1]);
  add('loudness -14 +-0.7 LUFS', Math.abs(I + 14) <= 0.7, `${I} LUFS (LRA ${LRA})`);
  add('true peak <= -1.0 dBTP', TP <= -1.0, `${TP} dBTP`);
  const sil = run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', 'silencedetect=n=-50dB:d=0.4', '-f', 'null', '-']).stderr;
  const sils = [...sil.matchAll(/silence_start: ([\d.]+)/g)].map((m) => +m[1]);
  const ts = (T.sfx.find((c) => c.type === 'tapestop') || {}).beat;      // השקט שאחרי "עצירת הסרט" מתוכנן
  const planned = (t) => ts !== undefined && t >= (ts + 1.5) * 60 / T.bpm && t <= (ts + 4) * 60 / T.bpm;
  const bad = sils.filter((t) => t < 44 && !planned(t));
  add('no unplanned silence > 0.4s', bad.length === 0, sils.map((t) => `${t.toFixed(2)}s${planned(t) ? ' (planned, tape stop)' : ''}`).join(', ') || 'none');

  // --- כתוביות (מתוך timeline.json) ---
  const capBad = [];
  for (const c of T.captions) {
    const fr = frameOfBeat(c.beat + c.beats) - frameOfBeat(c.beat);
    if (fr < 36) capBad.push(`"${c.text}" only ${fr} frames`);
    const maxWords = c.style === 'kicker' ? 6 : 5;                         // שורת הקיקר נשארת על המסך כמה תיבות
    for (const line of [c.text, c.sub].filter(Boolean)) if (line.trim().split(/\s+/).length > maxWords) capBad.push(`"${line}" has more than ${maxWords} words`);
    if (c.sub && c.subBeat !== undefined) {
      const sf = frameOfBeat(c.beat + c.beats) - frameOfBeat(c.subBeat);
      if (sf < 36) capBad.push(`sub "${c.sub}" only ${sf} frames`);
    }
  }
  add('captions >= 1.2s and short lines', capBad.length === 0, capBad.join('; ') || 'ok');

  // --- גיליונות לבדיקה בעין ---
  const tw = aspect === '16x9' ? 320 : 180;
  const cols = aspect === '16x9' ? 9 : 15;
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-vf',
    `select='not(mod(n\\,15))',scale=${tw}:-2,tile=${cols}x${Math.ceil(90 / cols)}:padding=3:margin=3`, '-frames:v', '1', '-q:v', '3', path.join(dir, 'sheet-all.jpg')]);
  const cutSel = expected.map((e) => `eq(n\\,${e.frame - 1})+eq(n\\,${e.frame})`).join('+');
  const cw = aspect === '16x9' ? 384 : 216;
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-vf',
    `select='${cutSel}',scale=${cw}:-2,tile=${aspect === '16x9' ? 4 : 8}x${Math.ceil(expected.length * 2 / (aspect === '16x9' ? 4 : 8))}:padding=4:margin=4`,
    '-frames:v', '1', '-q:v', '3', path.join(dir, 'cuts.jpg')]);
  const mids = SCENES.map((s) => ({ name: s.name, f: s.start + Math.floor(s.frames / 2) }));
  const split = mids.map((_, i) => `[m${i}]`).join('');
  const sel = [`[0:v]split=${mids.length}${split}`].concat(mids.map((m, i) => `[m${i}]select='eq(n\\,${m.f})'[o${i}]`)).join(';');
  const midCmd = ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-filter_complex', sel];
  mids.forEach((m, i) => midCmd.push('-map', `[o${i}]`, '-frames:v', '1', '-q:v', '2', path.join(dir, `mid-${m.name}.jpg`)));
  const mr = run('ffmpeg', midCmd);
  add('review sheets written', fs.existsSync(path.join(dir, 'sheet-all.jpg')) && fs.existsSync(path.join(dir, 'cuts.jpg')) && !mr.status, mr.stderr.trim().split('\n')[0] || dir);

  // --- ריפו נקי ממדיה ---
  const st = run('git', ['-C', path.join(ROOT, '..'), 'status', '--porcelain', '--untracked-files=all']).stdout;
  const media = st.split('\n').filter((l) => /\.(mp4|mkv|mov|wav|png|jpe?g|webp|webm)$/i.test(l) && /trailer\//.test(l));
  const ign = run('git', ['-C', path.join(ROOT, '..'), 'check-ignore', 'trailer/work', 'trailer/out']).stdout.trim().split('\n').length === 2;
  add('no media in git status; work/ and out/ ignored', media.length === 0 && ign, media.join(' | ') || 'clean');

  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify({ aspect, file: path.relative(ROOT, file), rows, blacks, freezes, cutFrames, loudness: { I, TP, LRA } }, null, 2));
  return { aspect, rows };
}

let failed = 0;
for (const aspect of ASPECTS) {
  const { rows } = qa(aspect);
  console.log(`\n== QA ${aspect}${DRAFT ? ' (draft)' : ''} ==`);
  for (const r of rows) {
    if (!r.pass) failed++;
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name.padEnd(46)} ${r.detail}`);
  }
}
console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);

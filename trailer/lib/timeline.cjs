// ציר הזמן של הטריילר: הכול מוגדר בפעימות (128 BPM), וממנו נגזרים פריימים (30fps).
const fs = require('fs');
const path = require('path');
const T = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'timeline.json'), 'utf8'));
const FPB = (T.fps * 60) / T.bpm; // 14.0625 פריימים לפעימה
const frameOfBeat = (beat) => Math.round(beat * FPB);
const secOfBeat = (beat) => (beat * 60) / T.bpm;
/** משבצת של סצנה: פריים התחלה, מספר פריימים */
function slot(name) {
  const s = T.scenes.find((x) => x.name === name);
  if (!s) throw new Error(`no scene "${name}" in timeline.json`);
  const start = frameOfBeat(s.beat);
  return { ...s, start, frames: frameOfBeat(s.beat + s.beats) - start };
}
const totalFrames = frameOfBeat(T.bars * 4);
module.exports = { T, FPB, frameOfBeat, secOfBeat, slot, totalFrames };

// בונה את נתוני הדמו לצילום (work/seed.json): אותו מבנה כמו seed() ב-src/data/demo.ts, עם תוכן מסודר וזמן קבוע.
const fs = require('fs');
const path = require('path');
const { WORK, EPOCH, ROOT } = require('./harness.cjs');
const C = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'demo-content.json'), 'utf8'));
const MILESTONES = {
  0: ['נוחתים באיים', 'משימת הפתיחה: מכירים את הדמויות על האי הדרומי', 'טוב, אז איך נוהגים פה?'],
  8: ['חוצים את הגשר', 'המרדף הראשון, על הגשר אל האי הגדול', 'זה לא באשמתי, הוא נכנס בי'],
  16: ['נכנסים לעיר', 'הכביש המהיר מגיע לשכונות הדרומיות', ''],
  24: ['השוד הגדול הראשון', 'תכנון, ביצוע ובריחה ברחובות מרכז העיר', 'יש לנו בדיוק שתי דקות. אחת וחצי.'],
  32: ['הבאג הכי מצחיק עד עכשיו', 'מכונית שעפה לשמיים ליד האגם', ''],
  40: ['יוצאים צפונה', 'עוזבים את העיר לכיוון שדה התעופה', ''],
  48: ['הבגידה', 'טוויסט בעלילה שאף אחד לא ציפה לו', 'ידעתי שאסור לסמוך עליו'],
  56: ['מקיפים את ההר', 'הכביש הצר שמעל הצוקים, בחוף הצפוני', ''],
  64: ['הלילה הארוך', 'משימה של שלוש שעות ברצף בעיירה שמתחת להר', 'עוד ניסיון אחד ואני הולך לישון'],
};
const chapterOf = (i) => (i < 16 ? 'האיים' : i < 36 ? 'העיר' : i < 54 ? 'הצפון' : 'ההר');
const N = 70;
const now = EPOCH * 1000;
const start = now - 80 * 36e5;
const missions = Array.from({ length: N }, (_, i) => {
  const ms = MILESTONES[i];
  const last = i === N - 1;
  return {
    id: `demo-${i}`,
    order_index: i,
    title: ms ? ms[0] : C.titles[i] || `משימה ${i + 1}`,
    summary: ms ? ms[1] : last ? 'כאן אנחנו נמצאים עכשיו בלייב' : C.summaries[i % C.summaries.length],
    body: ms ? C.milestoneBodies[i] || '' : '',
    kind: i % 11 === 5 ? 'moment' : 'mission',
    is_milestone: !!ms,
    happened_at: new Date(start + i * 1.1 * 36e5).toISOString(),
    stream_day: 1 + Math.floor(i / 24),
    recap_url: null,
    download_url: null,
    image_url: null,
    map_x: null,
    map_y: null,
    chapter: chapterOf(i),
    quote: ms && ms[2] ? ms[2] : null,
    quote_by: ms && ms[2] ? 'עודד' : null,
  };
});
const data = { missions, settings: { started_at: new Date(start).toISOString(), is_live: true } };
fs.mkdirSync(WORK, { recursive: true });
fs.writeFileSync(path.join(WORK, 'seed.json'), JSON.stringify(data));
console.log('seed.json:', missions.length, 'missions');

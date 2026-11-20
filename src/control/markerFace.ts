// אייקון למרקר: אימוג'י שנבחר (מרקר "משלכם" או "רגע"), ולמרקר "רגע" בלי בחירה – ניחוש לפי הכותרת והתיאור,
// כדי שהמפה לא תהיה מלאה במצלמות זהות. אם אין התאמה – האייקון הרגיל של הסוג.
import type { Marker } from '../data/types';

const GUESS: Array<[RegExp, string]> = [
  [/תנין/, '🐊'],
  [/כריש/, '🦈'],
  [/תאונ|התנגש|עף מה|נדרס/, '💥'],
  [/מכות|מרביץ|נלחם|קטטה|אגרוף|האסבר/, '👊'],
  [/רוצח|שוטר|משטר/, '🚔'],
  [/פרחים|פרח/, '💐'],
  [/שרשרת|יהלום|תכשיט/, '💎'],
  [/תספורת|מספרה/, '💈'],
  [/בגד|לוסיה/, '👗'],
  [/קניות|קונה|חנות/, '🛍️'],
  [/חיות|כלב|חתול/, '🐾'],
  [/גיבור|הציל|עוזר|עזרה|טובה/, '🦸'],
  [/מסיבה|רוקד|ריקוד/, '🎉'],
  [/אוכל|מסעדה|המבורגר/, '🍔'],
  [/סירה|חוף/, '🏖️'],
  [/מסוק/, '🚁'],
  [/אופנוע/, '🏍️'],
  [/שדות|הולך|בדרך|טיול/, '🚶'],
];

/** האימוג'י שמוצג במקום האייקון, או null לאייקון הרגיל */
export function markerEmoji(m: Pick<Marker, 'type' | 'emoji' | 'title' | 'body'>): string | null {
  if ((m.type === 'custom' || m.type === 'moment') && m.emoji) return m.emoji;
  if (m.type !== 'moment') return null;
  const text = `${m.title} ${m.body}`;
  return GUESS.find(([re]) => re.test(text))?.[1] ?? null;
}

/** מזהה קליפ של Kick מתוך קישור (kick.com/<ערוץ>/clips/clip_… או ?clip=clip_…) */
export function kickClipId(url: string | null | undefined): string | null {
  const m = (url ?? '').match(/kick\.com\/.*?(clip_[A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

// ───────────────────────────────────────────────────────────────
// הגדרות Supabase. כל עוד שני השדות ריקים האתר רץ ב"מצב דמו"
// (הנתונים נשמרים רק בדפדפן שלך). אחרי שפתחת פרויקט Supabase,
// הדבק כאן את ה-URL ואת ה-anon key (מפתח ציבורי – בטוח לשים באתר).
// ───────────────────────────────────────────────────────────────
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

/** שם ה-bucket ב-Supabase Storage לקבצי ריקאפ */
export const STORAGE_BUCKET = 'recaps';

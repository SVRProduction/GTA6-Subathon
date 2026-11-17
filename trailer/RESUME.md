# מצב העבודה על הטריילר (נקודת המשך)

מוכן: כל סקריפטי הסצנות (scenes/, footage/), הפסקול (audio/music.py), assemble.cjs, qa.cjs, review-frames.sh.
נשאר:
1. `node capture-overlay.cjs both` – רינדור שכבת הכתוביות (1350 PNG לכל פורמט ב-work/overlay/). לבדוק על הסצנות האמיתיות,
   במיוחד 9x16 בסצנות הטלפון (טלפון ממוסגר, כתובית מעליו) ומסך הסיום.
2. `node assemble.cjs both` ואז `node qa.cjs both` ו-`bash review-frames.sh`.
3. ביקורת (שישה מבקרים), תיקונים, מסירה של out/subathon-trailer-16x9.mp4 ו-9x16.mp4.
4. להסיר את הערת ה-STATUS מראש BUILD.md.

אם work/ נמחק (מכונה חדשה): `npm ci && npm run build`, `node lib/seed.cjs`, להוריד מחדש את תמונות התצוגה ל-work/ytimg/
(VQRLujxTm3c, QdBZY2fkU-0: maxresdefault, maxres1-3), ואז להריץ כל scenes/*.cjs עם `both`,
`node footage/make-shots.cjs both`, `python3 audio/music.py`, ואז מסעיף 1.
ענף נפרד לא ממוזג: fix-wanted-stars (כוכבי WANTED, כיוון פקודות הסקר).

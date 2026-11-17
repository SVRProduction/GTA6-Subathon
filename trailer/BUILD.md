# בניית הטריילר – הוראות משותפות לכל מי שעובד על חלק

טריילר של 45.0 שניות (1350 פריימים, 30fps, 128 BPM) לסאבתון GTA 6 של הערוץ odedsvr. שני פלטים: 1920x1080 ו-1080x1920.
התסריט המלא והכתוביות: `timeline.json` (מקור האמת היחיד; לקריאה בלבד – אם צריך שינוי, דווח בסיכום ואל תערוך).
התוכנית המאושרת: /root/.claude/plans/fuzzy-skipping-raven.md

## כללים
- עובדים רק בתוך `/home/user/gta6-subathon/trailer/`. לא נוגעים ב-`src/`, לא ב-`dist/`, לא ב-git (בלי commit/push/checkout).
- כל אחד כותב רק את הקבצים של החלק שלו (ראה "חוזה קבצים"). קבצים זמניים: `work/tmp/<שם החלק>/`.
- `work/` ו-`out/` לא נכנסים ל-git. תמונות Rockstar נמצאות רק ב-`work/ytimg/`.
- הסקריפטים ב-CommonJS (`.cjs`) – הריפו הוא ESM, ו-`require('playwright')` עובד רק מ-cjs.
- בסוף: לבדוק את הפלט בעיניים (לחלץ פריימים / גיליון תמונות ולקרוא אותם עם Read), ולוודא מספר פריימים מדויק עם ffprobe.
- עברית: טבעית, קצרה, בלי ניקוד. מספרים/לטינית בתוך טקסט עברי (GTA 6, 19.11, כתובות) עטופים ב-`<span dir="ltr">` או `unicode-bidi: isolate`.

## ציר הזמן
`const { T, slot, frameOfBeat, totalFrames } = require('./lib/timeline.cjs')` (מתוך `trailer/`; מתוך `scenes/` זה `../lib/timeline.cjs`).
`slot('map-title')` -> `{ start, frames, beat, beats, kind, what }`. כל סצנה מצולמת **בדיוק** `frames` פריימים.

| סצנה | התחלה | פריימים | | סצנה | התחלה | פריימים |
|---|---|---|---|---|---|---|
| gta1 | 0 | 28 | | gta4 | 675 | 28 |
| gta2 | 28 | 28 | | gta5 | 703 | 28 |
| gta3 | 56 | 57 | | tod | 731 | 169 |
| map-title | 113 | 112 | | phone-home | 900 | 56 |
| map-journey | 225 | 169 | | phone-story | 956 | 57 |
| milestone | 394 | 56 | | phone-reel | 1013 | 56 |
| fx-death | 450 | 56 | | phone-stats | 1069 | 56 |
| fx-arrest | 506 | 57 | | gta6 | 1125 | 28 |
| fx-fail | 563 | 56 | | gta7 | 1153 | 28 |
| poll | 619 | 56 | | endcard | 1181 | 169 |

## חוזה קבצים (פלט ביניים)
- סצנות מפה: `work/scenes/16x9/<name>.mkv` (1920x1080) ו-`work/scenes/9x16/<name>.mkv` (1080x1920).
- סצנות טלפון: `work/scenes/phone/<name>.mkv` (1080x1920, משותף לשני הפורמטים). לחיצות: `work/scenes/phone/taps.json` = `[{ "scene": "phone-reel", "frame": 28, "x": 123, "y": 456 }]` (פריים יחסי לסצנה, קואורדינטות ב-1080x1920).
- תמונות GTA: `work/scenes/16x9/gtaN.mkv`, `work/scenes/9x16/gtaN.mkv`.
- כתוביות: `work/overlay/16x9/%05d.png`, `work/overlay/9x16/%05d.png` (1350 פריימים כל אחד, RGBA שקוף, 00000..01349).
- מוזיקה: `work/audio/master.wav` (48kHz, סטריאו, 16bit, בדיוק 2,160,000 דגימות).
- סופי: `out/subathon-trailer-16x9.mp4`, `out/subathon-trailer-9x16.mp4`, `out/poster-16x9.png`, `out/poster-9x16.png`, `out/qa/`.
- כל קובצי הביניים של וידאו: `libx264rgb -crf 10`, 30fps קבוע (זה מה ש-`cap.record` מייצר).

## מנגנון הצילום (`lib/harness.cjs`) – נבדק ועובד
כרום headless עם זמן וירטואלי: כל `frame` = בדיוק 33.33ms, וכל האנימציות (CSS, rAF, WebGL, פנסים) זזות בסנכרון. הצילום איטי מזמן אמת (כ-0.3 שנ' לפריים מפה, 0.09 לטלפון) אבל חלק לגמרי.
**אסור**: `page.screenshot`, `page.click`, `page.waitForTimeout`, `locator.*` – נתקעים תחת זמן וירטואלי. משתמשים רק ב-API הזה:

```js
const { open, WORK, VIEW, MAP_CSS, PHONE_CSS, MAP_READY, WHEEL } = require('../lib/harness.cjs');
const { slot } = require('../lib/timeline.cjs');
const path = require('path');
async function run(aspect) {                       // '16x9' | '9x16'
  const s = slot('map-journey');
  const cap = await open({ url: '/?demo&fx&time=18', ...(aspect === '16x9' ? VIEW.map16 : VIEW.map9) });
  await cap.ready(MAP_READY);                      // מחכה לגופנים + לתנאי, ואז 30 פריימים להתייצבות
  await cap.css(MAP_CSS);                          // CSS לצילום בלבד
  await cap.eval(() => { /* קוד בדף: el.click(), dataset, dispatchEvent ... */ });
  await cap.step(40);                              // מתקדם 40 פריימים בלי לצלם
  await cap.shot(path.join(WORK, 'tmp/x/a.png'));  // פריים בודד לבדיקה (מקדם פריים אחד)
  await cap.record(path.join(WORK, 'scenes', aspect, 'map-journey.mkv'), s.frames, async (i) => {
    if (i % 16 === 8) await cap.eval(WHEEL, -300); // פעולה לפני פריים i
  });
  await cap.close();                               // חובה (משחרר משבצת צילום; יש רק 2 במקביל)
}
```
- `open({ url, cssW, cssH, dsf, mobile, transparent, seed=true, viewer=false, initScript })`. גודל פלט = css × dsf. `viewer: true` = צופה מחובר בדמו (ללייק).
- `cap.record(out, n, before, { vf, png })`: `vf` = פילטר ffmpeg (למשל `crop=1920:1080:x:y` לתקריב שצולם בגדול); `png: dir` שומר רצף PNG שקוף במקום וידאו.
- `cap.errors` – שגיאות JS בדף; אמור להיות ריק.
- כתובות: `/…` = האתר הבנוי (`dist`), `/__trailer/<path>` = קובץ מתוך `trailer/`, `/__work/<path>` = מתוך `trailer/work/`, `/__timeline.json`.
- רשת: רק האתר המקומי, Google Fonts (נשמרים במטמון) ו-`i.ytimg.com` מתוך `work/ytimg/`. כל השאר נחסם.
- "עכשיו" בדף קבוע: 21.11.2026 17:00 (ישראל). נתוני הדמו מסודרים מראש (`work/seed.json`, 70 עצירות עם שמות, המיילסטונים באינדקסים 0,8,16,24,32,40,48,56,64, העצירה הנוכחית 69).
- כל take עד 55 שניות וירטואליות (כולל ההמתנה), אחרת `setInterval` של שעת-היום דורס ערכים שהוגדרו ידנית.
- לבדיקה בעין: `lib/sheet.sh <video> <out.jpg> [כל כמה פריימים] [עמודות]`, או `ffmpeg -i f.mkv -vf "select=eq(n\,40)" -frames:v 1 x.png`.

## מה יש באתר לשימוש בצילום (הכול ב-`/?demo&fx&time=H`)
- `time=H`: שעה בישראל. 12=יום, 18=שקיעה (כתום-ורוד-סגול), 21=לילה עם פנסים. ידנית: `stage.dataset.tod='day'|'sunset'|'night'|'dawn'` ו-`stage.style.setProperty('--dark', 0..1)` כש-`stage = document.querySelector('.journey__stage')` (הפנסים נדלקים בהדרגה כש-`--dark` עולה; המעבר של גוון הרקע בין שלבים הוא מיידי, אז מחליפים שלב על פריים של חיתוך).
- מסע: מתחילים במבט כללי (כל המפה). `document.querySelector('[data-start]').click()` צולל לעצירה 1; `[data-jump-now]` קופץ לעצירה הנוכחית (70); `WHEEL(-300)` = עצירה קדימה. הפאנל הצדדי נפתח לבד כשמגיעים לעצירה: `document.querySelector('[data-panel-close]').click()` פעם אחת משאיר אותו סגור (ואז מופיע כרטיס קטן ליד הסיכה).
- סיכות: `document.querySelectorAll('.pin')[i].click()` פותח את עמוד העצירה במסך מלא (מיילסטון = מראה זהוב).
- אפקטים (`?fx`): `document.querySelectorAll('.fx-test button')[k].click()` – 0: מת (הבזק "מתת" + רעידה + 💀), 1: נעצר (אורות משטרה + ⭐⭐⭐ WANTED), 2: פישל (MISSION FAILED), 3: בועת תגובה, 4: הדמות נוסעת לעצירה. האפקטים בתור (אחד-אחד, 2.7–3.2 שנ'), אז כל אפקט ב-take משלו.
- הדמות של עודד: `.player` (לוגו עגול עם טבעת זהב); בדמו הוא "בלייב".
- סקר פתוח עם מיקום: סיכת `.mk--poll` עם כרטיס ופסים `.mk__bar` (רוחב לפי `--p`, טקסט אחוז ב-`.mk__bar-n`), וקו מקווקו `.poll-line` מהדמות אליה.
- כרטיס הפתיחה של האתר: `.opening` (להסתיר ב-CSS כשרוצים את המפה נקייה ובמרכז). HUD: `.hud`, תג הלייב: `.onair`.
- טלפון: `/phone.html?demo` (+`#clips`, `#clip-yt-VQRLujxTm3c`, `#stats`, `#story-25`). טבעות הסטוריז: `.ring`; סטורי פתוח: `[data-story]`; פיד: `.reel`, לייק: `.reel .like`; טאבים: `[data-tab]`.

// מדריך למודים: נפתח לבד בכניסה הראשונה של מוד, ותמיד אפשר לפתוח שוב מכפתור "?".
// 6 צעדים קצרים + צ'קליסט לפני הלייב. בלי לחכות לדקה ה-90.
import { h } from '../dom';
import { markerIcon, svg } from './icons';
import { closePopup, openPopup } from './popup';

const SEEN = 'mc-guide-seen';
export const guideSeen = () => {
  try {
    return !!localStorage.getItem(SEEN);
  } catch {
    return true;
  }
};

interface Step {
  icon: SVGElement;
  title: string;
  lines: string[];
  art: () => HTMLElement;
}
const kbd = (k: string) => h('kbd', {}, k);
const art = (...kids: Array<Node | string>) => h('div', { class: 'gd-art', ariaHidden: 'true' }, ...kids);
const pin = (cls: string, child: Node) => h('span', { class: `gd-pin ${cls}` }, child);

const STEPS: Step[] = [
  {
    icon: svg('edit', 22),
    title: 'מצב עריכה',
    lines: ['לוחצים "עריכה" בסרגל למעלה (או המקש E). בתחתית המסך מופיע מגש הכלים.', 'רק מודים מחוברים רואים את הכפתור. צופים לא יכולים לשנות כלום.'],
    art: () => art(h('span', { class: 'gd-chip is-on' }, svg('edit', 16), 'עריכה'), h('span', { class: 'gd-tray' }, markerIcon('death', 16), markerIcon('car', 16), markerIcon('weapon', 16), svg('plus', 16))),
  },
  {
    icon: svg('stops', 22),
    title: 'עצירה חדשה במסלול',
    lines: ['במגש: "עצירה" ← לוחצים על המפה במקום. כותבים שם, מסמנים אם זה מיילסטון, שומרים.', 'העצירה החדשה נהיית "כאן אנחנו עכשיו", והצופים רואים כרזת "משימה הושלמה".'],
    art: () => art(pin('is-stop', h('b', {}, '71')), h('span', { class: 'gd-line' }), pin('is-ms', h('b', {}, '72'))),
  },
  {
    icon: markerIcon('death', 22),
    title: 'מרקר חופשי (לא על המסלול)',
    lines: ['בוחרים סוג במגש (מוות, רכב, נשק…) ← לוחצים בכל מקום על המפה. בטלפון: לחיצה ארוכה על המפה.', 'מרקר מוות מעלה גם את מונה המיתות. גוררים מרקר כדי להזיז, לוחצים עליו כדי לערוך או למחוק.'],
    art: () => art(pin('is-mk mk--death', markerIcon('death', 18)), pin('is-mk mk--car', markerIcon('car', 18)), pin('is-mk mk--custom', h('span', {}, '🛥️'))),
  },
  {
    icon: svg('poll', 22),
    title: 'סקר לצ׳אט',
    lines: ['"סקר" בסרגל ← שאלה, 2–4 אפשרויות, זמן, ואם רוצים – מיקום על המפה.', 'הצופים כותבים !1 / !2 בצ׳אט של Kick או מצביעים באתר. כשהסקר נגמר, אם יש מיקום, נוצר שם מרקר "החלטת הצ׳אט".'],
    art: () => art(h('span', { class: 'gd-poll is-62' }, h('i'), h('span', {}, '!2 ההר')), h('span', { class: 'gd-poll is-38' }, h('i'), h('span', {}, '!1 העיר'))),
  },
  {
    icon: svg('phone', 22),
    title: 'אישור סטוריז',
    lines: ['צופים מעלים סטוריז מהטלפון. שום דבר לא מופיע לפני אישור.', 'בעמוד הניהול: "סטוריז לאישור" ← אישור / דחייה / חסימת המשתמש. אפשר גם להסתיר תגובות שם.'],
    art: () => art(h('span', { class: 'gd-chip' }, svg('check', 16), 'אישור'), h('span', { class: 'gd-chip is-bad' }, svg('close', 16), 'דחייה')),
  },
  {
    icon: svg('live', 22),
    title: 'בזמן הלייב',
    lines: ['עודד מת? מרקר מוות במקום (או !מוות בצ׳אט). משימה נגמרה? עצירה חדשה. רגע מצחיק? מרקר "רגע".', 'האוברליי של הסקר כבר מחובר לשידור (OBS) – פותחים סקר והוא קופץ אצל הצופים.'],
    art: () => art(kbd('E'), h('span', {}, 'עריכה'), kbd('P'), h('span', {}, 'סקר'), kbd('?'), h('span', {}, 'מדריך')),
  },
];

const CHECK = [
  'מחובר לעמוד הניהול (admin.html) באותו דפדפן',
  'רואה את כפתור "עריכה" בסרגל של המפה',
  'יודע לאיזה עצירה הלייב מגיע עכשיו (כפתור 📍 בניהול)',
  'האוברליי של הסקר נוסף ל-OBS (Browser Source)',
  'בדקתי סקר ניסיון של דקה אחת וסגרתי אותו',
];

const markSeen = () => {
  try {
    localStorage.setItem(SEEN, '1');
  } catch {
    /* חסום */
  }
};

export function openGuide(at = 0) {
  let i = at;
  const body = h('div', { class: 'gd' });
  const render = () => {
    const last = i >= STEPS.length;
    const dots = h('div', { class: 'gd-dots', ariaHidden: 'true' }, ...[...STEPS, null].map((_, k) => h('i', { class: k === i ? 'is-on' : k < i ? 'is-done' : '' })));
    const prev = h('button', { type: 'button', class: 'btn btn--small', disabled: i === 0 }, 'הקודם');
    const next = h('button', { type: 'button', class: 'btn btn--primary btn--small' }, last ? 'יאללה, מתחילים' : i === STEPS.length - 1 ? 'לצ׳קליסט' : 'הבא');
    prev.onclick = () => ((i = Math.max(0, i - 1)), render());
    next.onclick = () => {
      if (last) {
        closePopup();
        return;
      }
      i++;
      render();
    };
    const content = last
      ? h(
          'div',
          { class: 'gd-step' },
          h('p', { class: 'gd-num' }, 'לפני הלייב'),
          h('h3', {}, 'צ׳קליסט של 2 דקות'),
          h('ul', { class: 'gd-check' }, ...CHECK.map((c, k) => h('li', {}, h('label', { class: 'check' }, h('input', { type: 'checkbox', id: `gd-c${k}` }), h('span', {}, c))))),
        )
      : h(
          'div',
          { class: 'gd-step' },
          STEPS[i].art(),
          h('p', { class: 'gd-num' }, `צעד ${i + 1} מתוך ${STEPS.length}`),
          h('h3', {}, STEPS[i].icon, STEPS[i].title),
          ...STEPS[i].lines.map((l) => h('p', {}, l)),
        );
    body.replaceChildren(content, h('footer', { class: 'gd-foot' }, dots, h('div', { class: 'gd-nav' }, prev, next)));
  };
  render();
  openPopup({ key: 'guide', kicker: 'למודים', title: 'איך מנהלים את המפה בלייב', body, size: 's', hash: '#guide', onClose: markSeen });
}

// סקרים: כרטיס תוצאות חי (גם באוברליי לשידור), הצבעה באתר, וטופס פתיחת סקר למודים.
import { getViewer, login } from '../auth';
import { pollOpen, type Poll, type PollDraft, type Store } from '../data/types';
import { h } from '../dom';
import { svg } from './icons';

export const countdown = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const MY_VOTES = 'mc-my-votes';
function myVote(id: string): number | null {
  try {
    const v = JSON.parse(localStorage.getItem(MY_VOTES) || '{}')[id];
    return typeof v === 'number' ? v : null;
  } catch {
    return null;
  }
}
function rememberVote(id: string, k: number) {
  try {
    const all = JSON.parse(localStorage.getItem(MY_VOTES) || '{}');
    all[id] = k;
    localStorage.setItem(MY_VOTES, JSON.stringify(all));
  } catch {
    /* חסום */
  }
}

function forgetVote(id: string) {
  try {
    const all = JSON.parse(localStorage.getItem(MY_VOTES) || '{}');
    delete all[id];
    localStorage.setItem(MY_VOTES, JSON.stringify(all));
  } catch {
    /* חסום */
  }
}

/** כרטיס סקר: שאלה, פסים חיים, ספירה לאחור; voting = כפתורי הצבעה באתר */
export function pollCard(p: Poll, opts: { store?: Store; toast?: (t: string) => void; voting?: boolean; compact?: boolean; onLocate?: () => void }) {
  const total = p.votes.reduce((a, b) => a + b, 0);
  const open = pollOpen(p);
  const mine = myVote(p.id);
  const lead = Math.max(...p.votes);
  const timer = h('span', { class: 'pc__time' });
  const tick = () => {
    if (!timer.isConnected && timer.dataset.started) return;
    timer.dataset.started = '1';
    const left = Date.parse(p.ends_at) - Date.now();
    timer.textContent = open && left > 0 ? countdown(left) : 'הסקר נסגר';
    if (open && left > 0) setTimeout(tick, 500);
  };
  tick();
  const rows = p.options.map((o, k) => {
    const n = p.votes[k] ?? 0;
    const pct = total ? Math.round((n / total) * 100) : 0;
    const win = !open && p.winner === k;
    const row = h(
      opts.voting && open ? 'button' : 'div',
      { class: `pc__opt ${win ? 'is-win' : ''} ${open && n === lead && n > 0 ? 'is-lead' : ''} ${mine === k ? 'is-mine' : ''}` } as never,
      h('span', { class: 'pc__bar' }),
      h('span', { class: 'pc__key' }, `!${k + 1}`),
      h('span', { class: 'pc__label' }, o),
      h('span', { class: 'pc__pct' }, `${pct}%`),
    );
    row.style.setProperty('--p', `${pct}%`);
    if (opts.voting && open) {
      (row as HTMLButtonElement).type = 'button';
      row.setAttribute('aria-label', `הצבעה: ${o} (${pct}%)`);
      row.onclick = async () => {
        const v = getViewer();
        if (!v) return opts.store && login(opts.store);
        // נשמר לפני השליחה: העדכון מהשרת בונה את הכרטיס מחדש, והוא צריך כבר לדעת מה בחרתם
        const before = myVote(p.id);
        rememberVote(p.id, k);
        row.classList.add('is-mine');
        try {
          await opts.store!.vote(v, p.id, k);
          opts.toast?.(`הצבעת: ${o}`);
        } catch (e) {
          if (before == null) forgetVote(p.id);
          else rememberVote(p.id, before);
          row.classList.remove('is-mine');
          opts.toast?.((e as Error).message);
        }
      };
    }
    return row;
  });
  return h(
    'section',
    { class: `pc ${opts.compact ? 'pc--compact' : ''} ${open ? 'is-open' : 'is-closed'}` },
    h('header', { class: 'pc__head' }, h('span', { class: 'pc__tag' }, svg('poll', 15), open ? 'סקר פתוח' : 'תוצאות'), timer),
    h('h3', { class: 'pc__q' }, p.question),
    h('div', { class: 'pc__opts' }, ...rows),
    h(
      'footer',
      { class: 'pc__foot' },
      h('span', {}, `${total.toLocaleString('he-IL')} קולות`),
      open ? h('span', { class: 'pc__how' }, opts.voting ? (getViewer() ? 'לוחצים כדי להצביע, אפשר לשנות' : 'מתחברים עם Kick כדי להצביע') : 'כותבים !1 / !2 בצ׳אט') : p.winner != null ? h('span', { class: 'pc__how' }, `ניצח: ${p.options[p.winner]}`) : null,
      p.x != null && opts.onLocate ? (() => {
        const b = h('button', { type: 'button', class: 'linkish' }, 'במפה');
        b.onclick = opts.onLocate;
        return b;
      })() : null,
    ),
  );
}

/** טופס סקר חדש (מוד). pickPoint = בחירת מיקום על המפה */
export function pollForm(opts: { onSubmit: (d: PollDraft) => Promise<void>; pickPoint: (cb: (p: { x: number; y: number }) => void) => void; point?: { x: number; y: number } | null }) {
  let point = opts.point ?? null;
  const q = h('input', { class: 'f-in', maxLength: 120, placeholder: 'למשל: לאן נוסעים עכשיו?', required: true });
  const inputs = [0, 1, 2, 3].map((k) => h('input', { class: 'f-in', maxLength: 40, placeholder: k < 2 ? `אפשרות ${k + 1}` : `אפשרות ${k + 1} (לא חובה)`, required: k < 2 }));
  const minutes = h('select', { class: 'f-in' }, ...[2, 3, 5, 10, 15, 30].map((m) => h('option', { value: String(m), selected: m === 5 }, `${m} דקות`)));
  const where = h('span', { class: 'f-hint' });
  const syncWhere = () => (where.textContent = point ? 'המיקום נבחר. כשהסקר ייסגר יופיע שם מרקר "החלטת הצ׳אט".' : 'בלי מיקום: הסקר לא יוצר מרקר על המפה.');
  syncWhere();
  const pick = h('button', { type: 'button', class: 'btn btn--small' }, svg('pin', 16), point ? 'שינוי מיקום' : 'בחירת מיקום על המפה');
  pick.onclick = () =>
    opts.pickPoint((p) => {
      point = p;
      pick.lastChild!.textContent = 'שינוי מיקום';
      syncWhere();
    });
  const submit = h('button', { type: 'submit', class: 'btn btn--primary' }, 'פתיחת הסקר');
  const form = h(
    'form',
    { class: 'f' },
    h('label', { class: 'f-row' }, h('span', {}, 'השאלה'), q),
    h('div', { class: 'f-row' }, h('span', {}, 'אפשרויות (2–4)'), h('div', { class: 'f-grid' }, ...inputs)),
    h('div', { class: 'f-cols' }, h('label', { class: 'f-row' }, h('span', {}, 'כמה זמן'), minutes), h('div', { class: 'f-row' }, h('span', {}, 'מיקום על המפה'), pick)),
    where,
    h('p', { class: 'f-hint' }, 'הצופים מצביעים בצ׳אט של Kick עם !1, !2… או באתר. קול אחד לכל משתמש, ואפשר לשנות. סקר פתוח קודם נסגר.'),
    h('div', { class: 'f-actions' }, submit),
  );
  form.onsubmit = async (e) => {
    e.preventDefault();
    submit.disabled = true;
    try {
      await opts.onSubmit({ question: q.value, options: inputs.map((i) => i.value), minutes: Number(minutes.value), x: point?.x ?? null, y: point?.y ?? null });
    } finally {
      submit.disabled = false;
    }
  };
  return form;
}

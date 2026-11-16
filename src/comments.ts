// תגובות על עצירה או על קליפ: רשימה + תיבת כתיבה. אותו רכיב בפאנל של עצירה ומתחת לקליפים.
import { getViewer, login, logout, onViewer } from './auth';
import type { Comment, CommentTarget, Store } from './data/types';
import { h } from './dom';

let all: Comment[] = [];
const boxes = new Set<() => void>();

const ago = (iso: string) => {
  const s = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return 'עכשיו';
  const m = Math.round(s / 60);
  if (m < 60) return `לפני ${m} דק'`;
  if (m < 60 * 24) return `לפני ${Math.round(m / 60)} שע'`;
  return `לפני ${Math.round(m / 1440)} ימים`;
};

/** טוען פעם אחת ונרשם לעדכונים; כל רכיב פתוח מתרענן לבד */
export function initComments(store: Store, onChange?: (list: Comment[]) => void) {
  const set = (list: Comment[]) => {
    all = list;
    boxes.forEach((f) => f());
    onChange?.(list);
  };
  store.loadComments().then(set).catch(console.error);
  store.subscribeComments(set);
  onViewer(() => boxes.forEach((f) => f()));
}

export const commentsFor = (type: CommentTarget, id: string) => all.filter((c) => c.target_type === type && c.target_id === id);
export const commentCount = (type: CommentTarget, id: string) => commentsFor(type, id).length;

/** אות ראשונה של השם, כשאין תמונה */
function avatar(c: { username: string; avatar: string | null }) {
  return c.avatar
    ? h('img', { class: 'cmt__pic', src: c.avatar, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' })
    : h('span', { class: 'cmt__pic cmt__pic--letter', ariaHidden: 'true' }, c.username.slice(0, 1).toUpperCase());
}

export function commentsBox(store: Store, type: CommentTarget, id: string, opts: { title?: boolean; toast: (t: string) => void } ) {
  const root = h('section', { class: 'cmts', ariaLabel: 'תגובות' });
  const list = h('ol', { class: 'cmts__list' });
  const head = h('h3', { class: 'cmts__title stamp' });
  const foot = h('div', { class: 'cmts__foot' });
  let draft = '';

  function renderList() {
    const items = commentsFor(type, id);
    head.textContent = items.length ? `תגובות (${items.length})` : 'תגובות';
    list.replaceChildren(
      ...items.map((c) =>
        h(
          'li',
          { class: 'cmt' },
          avatar(c),
          h('div', { class: 'cmt__main' }, h('p', { class: 'cmt__meta' }, h('strong', {}, c.username), h('span', {}, ago(c.created_at))), h('p', { class: 'cmt__body' }, c.body)),
        ),
      ),
    );
    if (!items.length) list.append(h('li', { class: 'cmts__empty' }, 'עוד אין תגובות. מה חשבתם על הקטע?'));
  }

  function renderFoot() {
    const v = getViewer();
    if (!v) {
      const btn = h('button', { class: 'btn btn--kick', type: 'button' }, h('span', { class: 'kick-mark', ariaHidden: 'true' }, 'K'), 'התחברות עם Kick כדי להגיב');
      btn.onclick = () => login(store);
      foot.replaceChildren(btn);
      return;
    }
    const ta = h('textarea', { class: 'cmts__input', rows: 2, maxLength: 500, placeholder: 'כתבו תגובה…', value: draft, ariaLabel: 'תגובה' });
    const count = h('span', { class: 'cmts__count' }, '');
    const send = h('button', { class: 'btn btn--primary btn--small', type: 'submit' }, 'שליחה');
    const sync = () => {
      draft = ta.value;
      count.textContent = ta.value.length > 400 ? `${500 - ta.value.length}` : '';
      send.disabled = !ta.value.trim();
    };
    ta.oninput = sync;
    // Enter שולח, Shift+Enter שורה חדשה
    ta.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        form.requestSubmit();
      }
    };
    const form = h(
      'form',
      { class: 'cmts__form' },
      avatar(v),
      ta,
      h('div', { class: 'cmts__bar' }, h('span', { class: 'cmts__who' }, `מחובר כ-${v.username} · `, h('button', { class: 'linkish', type: 'button', onclick: () => logout() }, 'התנתקות')), count, send),
    );
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (!ta.value.trim()) return;
      send.disabled = true;
      try {
        await store.postComment(v, type, id, ta.value);
        draft = '';
        ta.value = '';
        sync();
      } catch (err) {
        opts.toast((err as Error).message);
        send.disabled = false;
      }
    };
    sync();
    foot.replaceChildren(form);
  }

  const refresh = () => {
    if (!root.isConnected && boxes.has(refresh) && root.dataset.mounted) {
      boxes.delete(refresh); // הרכיב הוסר מהדף
      return;
    }
    renderList();
    // לא בונים מחדש את תיבת הכתיבה בזמן הקלדה
    const typing = document.activeElement instanceof HTMLTextAreaElement && foot.contains(document.activeElement);
    if (!typing) renderFoot();
  };
  boxes.add(refresh);
  requestAnimationFrame(() => (root.dataset.mounted = '1'));
  renderList();
  renderFoot();
  root.append(...(opts.title === false ? [] : [head]), list, foot);
  return root;
}

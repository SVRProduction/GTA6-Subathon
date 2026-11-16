// תגובות צופים (על עצירה או על קליפ). כולם קוראים, מגיבים אחרי התחברות עם Kick.
import { getViewer, login, onViewer } from '../auth';
import type { CommentTarget } from '../data/types';
import { h } from '../dom';
import { commentsFor, on, state, store } from './state';
import { ago, bdi, ico } from './ui';

const DRAFT = 'fresh-draft';
const MAX = 500;

/** טיוטה נשמרת לפני מעבר להתחברות (ב-Supabase הדף עוזב ל-Kick וחוזר) */
function saveDraft(type: CommentTarget, id: string, text: string) {
  try {
    if (text.trim()) sessionStorage.setItem(DRAFT, JSON.stringify({ type, id, text }));
    else sessionStorage.removeItem(DRAFT);
  } catch {
    /* חסום */
  }
}
function readDraft(type: CommentTarget, id: string) {
  try {
    const d = JSON.parse(sessionStorage.getItem(DRAFT) ?? 'null');
    return d && d.type === type && d.id === id ? String(d.text) : '';
  } catch {
    return '';
  }
}

function initial(name: string) {
  return (name.trim()[0] ?? '?').toUpperCase();
}
function avatar(name: string, url: string | null) {
  if (url && /^https:\/\//.test(url)) {
    const img = h('img', { class: 'av', src: url, alt: '', loading: 'lazy', width: 36, height: 36 });
    img.onerror = () => img.replaceWith(h('span', { class: 'av av--letter', ariaHidden: 'true' }, initial(name)));
    return img;
  }
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  const s = h('span', { class: 'av av--letter' }, initial(name));
  s.style.setProperty('--hue', String(hue));
  s.setAttribute('aria-hidden', 'true');
  return s;
}

export function createTalk(type: CommentTarget, id: string, label: string) {
  const list = h('ol', { class: 'talk__list' });
  const count = h('span', { class: 'talk__count' });
  const formSlot = h('div', { class: 'talk__form' });
  const root = h('section', { class: 'talk', ariaLabel: 'תגובות' },
    h('h3', { class: 'talk__title' }, ico.chat(), 'תגובות ', count),
    list,
    formSlot,
  );

  function renderList() {
    const items = commentsFor(type, id);
    count.textContent = items.length ? `(${items.length})` : '';
    if (!items.length) {
      list.replaceChildren(h('li', { class: 'talk__empty' }, `עוד אין תגובות על ${label}. אפשר להיות הראשונים.`));
      return;
    }
    const me = getViewer()?.kick_user_id;
    list.replaceChildren(
      ...items.map((c) =>
        h('li', { class: `cmt ${c.kick_user_id === me ? 'cmt--me' : ''}` },
          avatar(c.username, c.avatar),
          h('div', { class: 'cmt__main' },
            h('p', { class: 'cmt__head' }, bdi(c.username, 'cmt__name'), h('time', { dateTime: c.created_at, title: new Date(c.created_at).toLocaleString('he-IL') }, ago(c.created_at))),
            h('p', { class: 'cmt__body', dir: 'auto' }, c.body),
          ),
        ),
      ),
    );
  }

  let ta: HTMLTextAreaElement | null = null;
  function renderForm() {
    const v = getViewer();
    const keep = ta?.value ?? readDraft(type, id);
    if (!v) {
      const btn = h('button', { type: 'button', class: 'btn btn--kick' }, h('span', { class: 'kick-dot', ariaHidden: 'true' }), 'התחברות עם Kick כדי להגיב');
      btn.onclick = () => {
        if (ta) saveDraft(type, id, ta.value);
        login(store);
      };
      formSlot.replaceChildren(btn);
      ta = null;
      return;
    }
    ta = h('textarea', { rows: 2, maxLength: MAX, placeholder: 'מה חשבת על זה?', value: keep, dir: 'auto' });
    ta.setAttribute('aria-label', `תגובה על ${label}`);
    const left = h('small', { class: 'talk__left' });
    const err = h('p', { class: 'talk__err', role: 'alert' });
    const send = h('button', { type: 'submit', class: 'btn btn--sign' }, 'שליחה');
    const t = ta;
    const upd = () => {
      const n = t.value.length;
      left.textContent = n > MAX - 80 ? `${MAX - n} תווים נשארו` : '';
      send.disabled = !t.value.trim();
      saveDraft(type, id, t.value);
    };
    t.addEventListener('input', upd);
    t.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) form.requestSubmit();
    });
    const form = h('form', { class: 'talk__compose' },
      h('div', { class: 'talk__me' }, avatar(v.username, v.avatar), h('span', {}, 'מגיבים בתור ', bdi(v.username, 'cmt__name'))),
      t,
      h('div', { class: 'talk__row' }, left, send),
      err,
    );
    form.onsubmit = async (e) => {
      e.preventDefault();
      const viewer = getViewer();
      if (!viewer || !t.value.trim()) return;
      send.disabled = true;
      err.textContent = '';
      try {
        await store.postComment(viewer, type, id, t.value);
        t.value = '';
        saveDraft(type, id, '');
        // בסופבייס ההרשמה מעדכנת; בכל מקרה טוענים מחדש כדי שהתגובה תופיע מיד
        state.comments = await store.loadComments();
        renderList();
        list.lastElementChild?.scrollIntoView({ block: 'nearest' });
      } catch (x) {
        err.textContent = (x as Error).message || 'התגובה לא נשלחה. נסו שוב.';
      }
      upd();
    };
    formSlot.replaceChildren(form);
    upd();
  }

  renderList();
  renderForm();
  const offC = on('comments', renderList);
  const offV = onViewer(() => {
    renderForm();
    renderList();
  });
  return {
    el: root,
    destroy: () => {
      offC();
      offV();
    },
  };
}

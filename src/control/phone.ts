// "הטלפון": נשלף מכפתור באמצע למטה. סטוריז של הצופים (אחרי אישור מוד), העלאת סטורי, הצ'אט של האתר, והסקר הפעיל.
// במחשב – מכשיר מצויר שעולה מלמטה; בטלפון אמיתי – מסך מלא.
import { getViewer, login, logout, onViewer } from '../auth';
import { currentIndex, liveStories, pollOpen, type Comment, type Data, type Extras, type Store } from '../data/types';
import { fill, h } from '../dom';
import { ago } from './feed';
import { svg } from './icons';
import { pollCard } from './polls';
import { seenSet, type StoryItem } from './stories';

type Tab = 'stories' | 'upload' | 'chat' | 'poll';
const TABS: Array<[Tab, string, string]> = [
  ['stories', 'סטוריז', 'phone'],
  ['upload', 'להעלות', 'upload'],
  ['chat', 'צ׳אט', 'chat'],
  ['poll', 'סקר', 'poll'],
];

export function createPhone(opts: {
  stage: HTMLElement;
  store: Store;
  toast: (t: string) => void;
  openStories: (list: StoryItem[], i: number) => void;
  openStop: (i: number) => void;
  openTarget: (c: Comment) => void;
  locatePoll: () => void;
  /** עמוד עצמאי (phone.html): הטלפון תמיד פתוח, בלי כפתור שליפה, והלשונית נשמרת בכתובת */
  page?: boolean;
  /** בעמוד עצמאי: מה לשים בכותרת במקום כפתור הסגירה */
  headExtra?: HTMLElement;
}) {
  let data: Data | null = null;
  let ex: Extras | null = null;
  let comments: Comment[] = [];
  let tab: Tab = 'stories';
  let openState = false;
  let seenCount = 0;

  const badge = h('span', { class: 'phone-btn__badge', hidden: true });
  const btn = h('button', { type: 'button', class: 'phone-btn', ariaExpanded: 'false' }, svg('phone', 24), h('span', { class: 'phone-btn__label' }, 'הטלפון'), badge);
  btn.setAttribute('aria-controls', 'phone');
  const screen = h('div', { class: 'phone__screen' });
  const tabsEl = h('nav', { class: 'phone__tabs', ariaLabel: 'הטלפון' });
  const closeBtn = h('button', { type: 'button', class: 'phone__close', ariaLabel: 'סגירת הטלפון' }, svg('close', 20));
  // בפופאפ במפה: קישור לעמוד הטלפון המלא (שאפשר להתקין כאפליקציה)
  const pageLink = h('a', { class: 'phone__pagelink', href: `${import.meta.env.BASE_URL}install.html`, target: '_blank', rel: 'noopener', title: 'איך מתקינים את הטלפון כאפליקציה' }, svg('upload', 16), h('span', {}, 'להתקין כאפליקציה'));
  // בפופאפ במפה: בתוך המכשיר רץ אותו הטלפון בדיוק (phone.html), כדי שיהיה טלפון אחד
  const frameBox = h('div', { class: 'phone__framebox' });
  let frame: HTMLIFrameElement | null = null;
  // הטלפון (בתוך ה-iframe) מבקש לעבור למפה: סוגרים ומזיזים את המפה של האתר
  addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.data?.type !== 'oded:map') return;
    setOpen(false);
    if (e.data.hash) location.hash = e.data.hash;
  });
  const loadFrame = () => {
    if (frame) return;
    const demo = new URLSearchParams(location.search).has('demo') ? '&demo' : '';
    frame = h('iframe', { class: 'phone__frame', src: `${import.meta.env.BASE_URL}phone.html?inapp${demo}`, title: 'הטלפון', allow: 'autoplay; fullscreen; clipboard-write; web-share' }) as HTMLIFrameElement;
    frameBox.append(frame);
  };
  const statusbar = h('div', { class: 'phone__status', ariaHidden: 'true' }, h('span', { class: 'phone__clock' }), h('span', { class: 'phone__notch' }), h('span', { class: 'phone__bat' }, '100%'));
  const phone = h(
    'aside',
    { class: 'phone', id: 'phone', hidden: true, ariaLabel: 'הטלפון: סטוריז, צ׳אט וסקר' },
    opts.page
      ? h('div', { class: 'phone__device' }, statusbar, h('header', { class: 'phone__head' }, h('strong', {}, 'הטלפון'), closeBtn), screen, tabsEl)
      : h('div', { class: 'phone__device phone__device--frame' }, statusbar, h('header', { class: 'phone__head phone__head--slim' }, pageLink, closeBtn), frameBox),
  );
  opts.stage.append(btn, phone);
  const clock = statusbar.querySelector<HTMLElement>('.phone__clock')!;
  const tickClock = () => (clock.textContent = new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }));
  tickClock();
  setInterval(tickClock, 30_000);

  if (opts.page) {
    btn.hidden = true;
    closeBtn.replaceWith(opts.headExtra ?? h('span'));
    phone.classList.add('phone--page');
  }
  function setOpen(on: boolean) {
    if (opts.page) {
      if (!on) return;
      openState = true;
      phone.hidden = false;
      phone.classList.add('is-open');
      updateBadge();
      render();
      return;
    }
    openState = on;
    btn.setAttribute('aria-expanded', String(on));
    document.body.classList.toggle('is-phone', on);
    if (on) {
      loadFrame();
      phone.hidden = false;
      requestAnimationFrame(() => phone.classList.add('is-open'));
      if (location.hash !== '#phone') history.replaceState(null, '', '#phone');
      seenCount = storyItems().filter((s) => s.kind === 'viewer').length;
      updateBadge();
      render();
      setTimeout(() => closeBtn.focus({ preventScroll: true }), 40);
    } else {
      phone.classList.remove('is-open');
      setTimeout(() => {
        if (openState) return;
        phone.hidden = true;
        // בטלפון: משחררים את הזיכרון של הטלפון הפנימי (ייטען מחדש בפתיחה הבאה)
        if (frame && matchMedia('(pointer: coarse)').matches) {
          frame.remove();
          frame = null;
        }
      }, 300);
      if (location.hash === '#phone') history.replaceState(null, '', location.pathname + location.search);
      btn.focus({ preventScroll: true });
    }
  }
  btn.onclick = () => setOpen(!openState);
  closeBtn.onclick = () => setOpen(false);
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openState && !document.body.classList.contains('is-story') && !document.querySelector('.pop:not([hidden])')) setOpen(false);
  });
  onViewer(() => openState && render());

  function storyItems(): StoryItem[] {
    if (!data) return [];
    const out: StoryItem[] = [];
    liveStories(ex?.stories ?? []).forEach((s) => out.push({ kind: 'viewer', key: `s-${s.id}`, s, t: Date.parse(s.created_at) }));
    data.missions.forEach((m, i) => m.is_milestone && out.push({ kind: 'official', key: `m-${m.id}`, stop: i, m, t: Date.parse(m.happened_at ?? '') || 0 }));
    return out.sort((a, b) => b.t - a.t);
  }
  function updateBadge() {
    const n = storyItems().filter((s) => s.kind === 'viewer').length;
    const open = (ex?.polls ?? []).some((p) => pollOpen(p));
    const fresh = Math.max(0, n - seenCount);
    badge.hidden = !(fresh || open);
    badge.textContent = open ? 'סקר' : String(fresh);
    btn.classList.toggle('has-poll', open);
  }

  function rings(list: StoryItem[]) {
    const seen = seenSet();
    return h(
      'div',
      { class: 'rings', role: 'list' },
      ...list.map((it, k) => {
        const label = it.kind === 'official' ? it.m.title : it.s.username;
        const face =
          it.kind === 'viewer'
            ? h('img', { src: it.s.image_url, alt: '', loading: 'lazy' })
            : h('b', {}, String(it.stop + 1));
        const b = h('button', { type: 'button', class: `ring ${it.kind === 'official' ? 'is-official' : ''} ${seen.has(it.key) ? 'is-seen' : ''}`, ariaLabel: `סטורי: ${label}` }, h('span', { class: 'ring__face' }, face), h('span', { class: 'ring__name' }, label));
        b.setAttribute('role', 'listitem');
        b.onclick = () => opts.openStories(list, k);
        return b;
      }),
    );
  }

  function storiesTab() {
    const list = storyItems();
    const viewer = list.filter((x) => x.kind === 'viewer');
    const posts = viewer.map((it) => {
      if (it.kind !== 'viewer') return null;
      const s = it.s;
      const k = list.indexOf(it);
      const open = () => opts.openStories(list, k);
      const img = h('button', { type: 'button', class: 'post__img', ariaLabel: `פתיחת הסטורי של ${s.username}` }, h('img', { src: s.image_url, alt: s.caption || '', loading: 'lazy' }));
      img.onclick = open;
      const stop = s.mission_id && data ? data.missions.findIndex((m) => m.id === s.mission_id) : -1;
      return h(
        'article',
        { class: 'post' },
        h('header', { class: 'post__head' }, h('span', { class: 'post__pic' }, s.username.slice(0, 1).toUpperCase()), h('strong', {}, s.username), h('time', {}, ago(Date.now() - Date.parse(s.created_at)))),
        img,
        h(
          'footer',
          { class: 'post__foot' },
          h('span', { class: 'post__likes' }, svg('heart', 16), String(s.likes)),
          s.caption ? h('p', {}, s.caption) : null,
          stop >= 0 ? (() => {
            const b = h('button', { type: 'button', class: 'linkish' }, `עצירה ${stop + 1}`);
            b.onclick = () => (setOpen(false), opts.openStop(stop));
            return b;
          })() : null,
        ),
      );
    });
    return [
      list.length ? rings(list) : null,
      h('div', { class: 'phone__sub' }, h('strong', {}, 'מהצופים'), h('span', {}, 'כל סטורי עובר אישור של מוד')),
      viewer.length ? h('div', { class: 'posts' }, ...posts) : h('div', { class: 'phone__empty' }, h('p', {}, 'עוד אין סטוריז מהצופים. צילמתם רגע טוב מהלייב?'), tabBtn('upload', 'להעלות סטורי')),
    ];
  }

  function tabBtn(t: Tab, label: string) {
    const b = h('button', { type: 'button', class: 'btn btn--primary btn--small' }, label);
    b.onclick = () => go(t);
    return b;
  }

  function uploadTab() {
    const v = getViewer();
    if (!v) {
      const b = h('button', { type: 'button', class: 'btn btn--kick' }, h('span', { class: 'kick-mark', ariaHidden: 'true' }, 'K'), 'התחברות עם Kick');
      b.onclick = () => login(opts.store);
      return [h('div', { class: 'phone__empty' }, svg('upload', 34), h('p', {}, 'כדי להעלות סטורי מתחברים עם Kick. כל סטורי עובר אישור של מוד לפני שהוא מופיע, ונעלם אחרי 48 שעות.'), b)];
    }
    let file: File | null = null;
    const preview = h('div', { class: 'up__preview' }, svg('upload', 30), h('span', {}, 'בחירת תמונה, גרירה או הדבקה (Ctrl+V)'));
    const input = h('input', { type: 'file', accept: 'image/*', class: 'up__file' });
    const take = (f: File | null | undefined) => {
      if (!f || !f.type.startsWith('image/')) return;
      file = f;
      const u = URL.createObjectURL(f);
      preview.replaceChildren(h('img', { src: u, alt: 'התמונה שנבחרה' }));
      send.disabled = false;
    };
    input.onchange = () => take(input.files?.[0]);
    const pick = h('label', { class: 'up__pick' }, preview, input);
    pick.addEventListener('dragover', (e) => e.preventDefault());
    pick.addEventListener('drop', (e) => {
      e.preventDefault();
      take(e.dataTransfer?.files?.[0]);
    });
    const cap = h('textarea', { class: 'f-in', rows: 2, maxLength: 160, placeholder: 'כיתוב קצר (לא חובה)' });
    const cur = data ? currentIndex(data) : -1;
    const tie = h('input', { type: 'checkbox', checked: cur >= 0 });
    const send = h('button', { type: 'submit', class: 'btn btn--primary', disabled: true }, 'שליחה לאישור');
    const form = h(
      'form',
      { class: 'up' },
      pick,
      cap,
      cur >= 0 && data ? h('label', { class: 'check' }, tie, h('span', {}, `לשייך לעצירה ${cur + 1}: ${data.missions[cur].title}`)) : null,
      send,
      h('p', { class: 'f-hint' }, `מחובר כ-${v.username} · `, (() => {
        const b = h('button', { type: 'button', class: 'linkish' }, 'התנתקות');
        b.onclick = logout;
        return b;
      })()),
    );
    form.addEventListener('paste', (e) => take([...(e.clipboardData?.items ?? [])].find((x) => x.type.startsWith('image/'))?.getAsFile()));
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (!file) return;
      send.disabled = true;
      send.textContent = 'שולח…';
      try {
        await opts.store.submitStory(v, { image: file, caption: cap.value, mission_id: tie.checked && data && cur >= 0 ? data.missions[cur].id : null, x: null, y: null });
        fill(screen, h('div', { class: 'phone__empty is-done' }, svg('check', 36), h('p', {}, h('strong', {}, 'נשלח לאישור.'), ' מוד יאשר את הסטורי, ואז הוא יופיע לכולם בטלפון.'), tabBtn('stories', 'חזרה לסטוריז')));
      } catch (err) {
        opts.toast((err as Error).message);
        send.disabled = false;
        send.textContent = 'שליחה לאישור';
      }
    };
    return [h('div', { class: 'phone__sub' }, h('strong', {}, 'סטורי חדש'), h('span', {}, 'צילום מסך מהמשחק או מהלייב')), form];
  }

  function chatTab() {
    const list = [...comments].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 60);
    const where = (c: Comment) => {
      if (c.target_type === 'stop' && data) {
        const i = data.missions.findIndex((m) => m.id === c.target_id);
        return i >= 0 ? `עצירה ${i + 1}` : 'עצירה';
      }
      return { clip: 'קליפ', marker: 'מרקר', story: 'סטורי', stop: 'עצירה' }[c.target_type];
    };
    return [
      h('div', { class: 'phone__sub' }, h('strong', {}, 'הצ׳אט של האתר'), h('span', {}, 'כל התגובות, מהחדש לישן')),
      list.length
        ? h(
            'ol',
            { class: 'chat' },
            ...list.map((c) => {
              const b = h('button', { type: 'button', class: 'chat__msg' }, h('span', { class: 'chat__pic' }, c.username.slice(0, 1).toUpperCase()), h('span', { class: 'chat__main' }, h('span', { class: 'chat__meta' }, h('strong', {}, c.username), h('span', {}, `${where(c)} · ${ago(Date.now() - Date.parse(c.created_at))}`)), h('span', { class: 'chat__body' }, c.body)));
              b.onclick = () => (setOpen(false), opts.openTarget(c));
              return h('li', {}, b);
            }),
          )
        : h('div', { class: 'phone__empty' }, h('p', {}, 'עוד אין תגובות. פותחים עצירה, קליפ או סטורי ומגיבים שם.')),
    ];
  }

  function pollTab() {
    const polls = ex?.polls ?? [];
    const open = polls.find((p) => pollOpen(p));
    const past = polls.filter((p) => p !== open).slice(-4).reverse();
    return [
      open
        ? pollCard(open, { store: opts.store, toast: opts.toast, voting: true, onLocate: open.x != null ? () => (setOpen(false), opts.locatePoll()) : undefined })
        : h('div', { class: 'phone__empty' }, svg('poll', 34), h('p', {}, 'אין סקר פתוח כרגע. כשמוד פותח סקר, מצביעים כאן או בצ׳אט של Kick עם !1 / !2.')),
      past.length ? h('div', { class: 'phone__sub' }, h('strong', {}, 'החלטות קודמות')) : null,
      ...past.map((p) => pollCard(p, { compact: true })),
    ];
  }

  function go(t: Tab) {
    tab = t;
    if (opts.page) history.replaceState(null, '', `#${t}`);
    render();
  }
  function render() {
    if (!openState) return;
    // לא בונים מחדש בזמן הקלדה / העלאה
    if (screen.contains(document.activeElement) && document.activeElement?.matches('textarea, input')) return;
    if (tab === 'upload' && screen.querySelector('.up__preview img')) return;
    fill(
      tabsEl,
      ...TABS.map(([t, label, ic]) => {
        const b = h('button', { type: 'button', class: 'phone__tab' }, svg(ic, 20), h('span', {}, label));
        if (t === tab) b.setAttribute('aria-current', 'page');
        if (t === 'poll' && (ex?.polls ?? []).some((p) => pollOpen(p))) b.classList.add('has-dot');
        b.onclick = () => go(t);
        return b;
      }),
    );
    const keep = screen.scrollTop;
    fill(screen, ...(tab === 'stories' ? storiesTab() : tab === 'upload' ? uploadTab() : tab === 'chat' ? chatTab() : pollTab()));
    screen.scrollTop = keep;
  }

  return {
    setData(d: Data) {
      data = d;
      updateBadge();
      render();
    },
    setExtras(e: Extras) {
      ex = e;
      updateBadge();
      render();
    },
    setComments(c: Comment[]) {
      comments = c;
      if (tab === 'chat') render();
    },
    open(t?: Tab) {
      if (t) tab = t;
      setOpen(true);
    },
    close: () => setOpen(false),
    isOpen: () => openState,
    storyItems,
  };
}
export type Phone = ReturnType<typeof createPhone>;

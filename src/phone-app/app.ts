// phone.html – "הטלפון" כאפליקציה: המבנה של גרסה 4 (בית עם סטוריז, מפה, פיד קליפים, מספרים)
// בעיצוב של האתר (גרסה 6). אפשר להתקין כ-WebApp. ‎#home / #map / #clips / #stats / #m-N / #story-… / #clip-…
import { getViewer, login, loginError, logout, onViewer } from '../auth';
import { playClip } from '../clips';
import { commentCount, commentsBox, initComments } from '../comments';
import { svg } from '../control/icons';
import { pollCard } from '../control/polls';
import { statsView } from '../control/stats';
import { createStoryViewer, seenSet, type StoryItem } from '../control/stories';
import { createStore } from '../data/store';
import { countOf, currentIndex, kickSlug, liveStories, playMs, pollOpen, statusFresh, type Clip, type Comment, type Data, type Extras, type LiveData, type Mission } from '../data/types';
import { fill, h, safeUrl } from '../dom';
import { videoEmbed } from '../journey/content';
import { buildCurve, makeTrail, placeAll } from '../journey/route';
import { fmtPlay } from '../live';

const store = createStore();
// אייקונים בטאב-בר (מאותו סט כמו באתר)
document.querySelectorAll<HTMLElement>('[data-ico]').forEach((el) => el.append(svg(el.dataset.ico!, el.classList.contains('ap-tab__plus') ? 28 : 22)));
const B = import.meta.env.BASE_URL;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;

// ── מצב ──
let data: Data | null = null;
let live: LiveData | null = null;
let ex: Extras | null = null;
let comments: Comment[] = [];
const freshIds = new Set<string>(); // עצירות / סטוריז שנוספו בזמן שהאפליקציה פתוחה

let toastTimer = 0;
function toast(t: string) {
  const el = $('#toast');
  el.textContent = t;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 3400);
}
const num = (n: number) => n.toLocaleString('he-IL');
const isLive = () => !!data && !!live && (statusFresh(live.status) ? !!live.status?.is_live : data.settings.is_live);
const onGame = () => !!live && statusFresh(live.status) && !!live.status?.on_category;
const ago = (iso: string | null | undefined) => {
  if (!iso) return '';
  const m = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (m < 60) return `לפני ${m} דק'`;
  if (m < 1440) return `לפני ${Math.round(m / 60)} שע'`;
  return `לפני ${Math.round(m / 1440)} ימים`;
};
const btn = (cls: string, label: Array<Node | string> | string, onclick: () => void, aria?: string) => {
  const b = h('button', { class: cls }, ...(typeof label === 'string' ? [label] : label));
  b.type = 'button';
  if (aria) b.setAttribute('aria-label', aria);
  b.onclick = onclick;
  return b;
};

// ── צילום המפה במקום של עצירה (רקע לסטורי ולכרטיסים) ──
const mapImg = new Image();
mapImg.crossOrigin = 'anonymous';
let trailRaw: Array<[number, number]> | null = null;
let points: Array<{ x: number; y: number }> = [];
function computePoints() {
  if (!data || !mapImg.naturalWidth) return;
  const W = mapImg.naturalWidth;
  const H = mapImg.naturalHeight;
  const trail = !data.settings.map_image_url && trailRaw ? makeTrail(trailRaw, W, H) : null;
  points = buildCurve(placeAll(data.missions, trail), W, H, trail).stops;
}
/** חיתוך של המפה סביב העצירה + סיכה פועמת במקום */
function snapshot(i: number, w: number, hh: number, span: number): HTMLElement | null {
  computePoints();
  const p = points[i];
  if (!p || !mapImg.naturalWidth) return null;
  const W = mapImg.naturalWidth;
  const H = mapImg.naturalHeight;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = hh;
  const g = c.getContext('2d')!;
  const sw = Math.min(W, Math.min(W, H) * span);
  const sh = Math.min(H, (sw * hh) / w);
  const sx = Math.max(0, Math.min(W - sw, p.x - sw / 2));
  const sy = Math.max(0, Math.min(H - sh, p.y - sh / 2));
  g.fillStyle = '#0b2f4a';
  g.fillRect(0, 0, w, hh);
  g.drawImage(mapImg, sx, sy, sw, sh, 0, 0, w, hh);
  c.className = 'st-img';
  c.setAttribute('role', 'img');
  c.setAttribute('aria-label', `המקום של ${data?.missions[i]?.title ?? 'העצירה'} על המפה`);
  const pin = h('span', { class: 'st-pin', ariaHidden: 'true' });
  pin.style.left = `${((p.x - sx) / sw) * 100}%`;
  pin.style.top = `${((p.y - sy) / sh) * 100}%`;
  return h('div', { class: 'st-crop' }, c, pin);
}
function stopBg(i: number, w = 900, hh = 1600, span = 0.16): HTMLElement | null {
  const m = data?.missions[i];
  const img = safeUrl(m?.image_url);
  if (img) return h('img', { class: 'st-img', src: img, alt: m?.title ?? '' });
  return snapshot(i, w, hh, span);
}

// ══════════════ גיליון תחתון (תגובות / נגן / העלאה / צ׳אט) ══════════════
const sheetWrap = $('[data-sheet]');
let closeSheet: (() => void) | null = null;
function openSheet(title: string, body: Node, opts: { tall?: boolean } = {}) {
  closeSheet?.();
  document.body.classList.add('is-sheet');
  const close = btn('ap-sheet__close', [svg('close', 20)], () => done(), 'סגירה');
  const panel = h('div', { class: `ap-sheet ${opts.tall ? 'ap-sheet--tall' : ''}`, role: 'dialog', ariaModal: 'true', ariaLabel: title }, h('div', { class: 'ap-sheet__grip', ariaHidden: 'true' }), h('header', { class: 'ap-sheet__head' }, h('h3', {}, title), close), h('div', { class: 'ap-sheet__body' }, body));
  const dim = h('div', { class: 'ap-sheet__dim' });
  fill(sheetWrap, dim, panel);
  sheetWrap.hidden = false;
  requestAnimationFrame(() => sheetWrap.classList.add('is-open'));
  const done = () => {
    if (closeSheet !== done) return;
    closeSheet = null;
    sheetWrap.classList.remove('is-open');
    document.body.classList.remove('is-sheet');
    sheetWrap.querySelectorAll('video, iframe').forEach((v) => v.remove());
    setTimeout(() => {
      if (closeSheet) return;
      sheetWrap.hidden = true;
      sheetWrap.replaceChildren();
    }, reduce ? 0 : 240);
    renderHome();
  };
  dim.onclick = done;
  closeSheet = done;
  // החלקה למטה מהידית או מהכותרת
  let y0 = -1;
  for (const el of [panel.querySelector<HTMLElement>('.ap-sheet__grip')!, panel.querySelector<HTMLElement>('.ap-sheet__head')!]) {
    el.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      y0 = e.clientY;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (y0 >= 0) panel.style.transform = `translateY(${Math.max(0, e.clientY - y0)}px)`;
    });
    el.addEventListener('pointerup', (e) => {
      const d = e.clientY - y0;
      y0 = -1;
      panel.style.transform = '';
      if (d > 90) done();
    });
  }
  setTimeout(() => close.focus({ preventScroll: true }), 40);
}
addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Escape' && closeSheet) {
      e.stopImmediatePropagation();
      closeSheet();
    }
  },
  true,
);
const openComments = (type: 'stop' | 'clip', id: string, title: string) => openSheet(title ? `תגובות: ${title}` : 'תגובות', commentsBox(store, type, id, { toast, title: false }), { tall: true });
function watch(m: Mission) {
  const url = safeUrl(m.recap_url);
  if (!url) return;
  const embed = videoEmbed(url);
  if (!embed) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  openSheet(m.title, h('div', { class: 'ap-player' }, embed));
}
function watchLive() {
  if (!data) return;
  const ch = kickSlug(data.settings.kick_channel);
  openSheet('הלייב', h('div', { class: 'ap-live' }, h('div', { class: 'ap-player' }, h('iframe', { src: `https://player.kick.com/${ch}`, allowFullscreen: true, title: 'הלייב', allow: 'autoplay; fullscreen' })), h('a', { class: 'pill', href: `https://kick.com/${ch}`, target: '_blank', rel: 'noopener' }, svg('external', 18), 'לפתוח ב-Kick')));
}
async function share(url: string, title: string) {
  try {
    if (navigator.share) await navigator.share({ title, url });
    else {
      await navigator.clipboard.writeText(url);
      toast('הקישור הועתק');
    }
  } catch {
    /* בוטל */
  }
}

// ══════════════ סטוריז ══════════════
type Ring = { key: string; title: string; items: StoryItem[]; face: () => HTMLElement; today?: boolean; fresh?: boolean };
const viewer = createStoryViewer({
  store,
  toast,
  stopBg: (i) => stopBg(i),
  goStop: (i) => (location.hash = `#m-${i + 1}`),
  watch,
});
const official = (i: number): StoryItem => {
  const m = data!.missions[i];
  return { kind: 'official', key: `m-${m.id}`, stop: i, m, t: Date.parse(m.happened_at ?? '') || 0 };
};
/** הטבעות בבית: "היום" (כל מה שקרה היום), סטוריז של צופים שאושרו, ומיילסטונים – החדש קודם */
function rings(): Ring[] {
  if (!data) return [];
  const ms = data.missions;
  const out: Ring[] = [];
  const now = new Date();
  let today = ms.map((m, i) => ({ m, i })).filter((x) => x.m.happened_at && new Date(x.m.happened_at).toDateString() === now.toDateString());
  if (!today.length) today = ms.map((m, i) => ({ m, i })).filter((x) => x.m.happened_at && Date.now() - Date.parse(x.m.happened_at) < 864e5);
  if (today.length) {
    const sl = today.slice(-12).map((x) => official(x.i));
    const last = today[today.length - 1].i;
    out.push({ key: `today-${now.toDateString()}-${sl.length}`, title: 'היום', items: sl, today: true, face: () => h('span', { class: 'ap-ring__today' }, 'היום') });
    void last;
  }
  const viewerS: StoryItem[] = liveStories(ex?.stories ?? []).map((s) => ({ kind: 'viewer', key: `s-${s.id}`, s, t: Date.parse(s.created_at) }));
  const officialS: StoryItem[] = ms.map((m, i) => ({ m, i })).filter((x) => x.m.is_milestone).map((x) => official(x.i));
  const all = [...viewerS, ...officialS].sort((a, b) => b.t - a.t);
  for (const it of all) {
    if (it.kind === 'viewer')
      out.push({ key: it.key, title: it.s.username, items: [it], fresh: freshIds.has(it.key), face: () => h('img', { src: it.s.image_url, alt: '', loading: 'lazy' }) });
    else
      out.push({
        key: it.key,
        title: it.m.title,
        items: [it],
        fresh: freshIds.has(it.m.id),
        face: () => {
          const bg = stopBg(it.stop, 200, 200, 0.12);
          return bg ?? h('b', {}, String(it.stop + 1));
        },
      });
  }
  return out;
}
/** פותח את הטבעת – והמשך הצפייה ממשיך לטבעות הבאות (כמו בגרסה 4) */
function openRing(k: number) {
  const rs = rings();
  const flat: StoryItem[] = [];
  let start = 0;
  rs.forEach((r, j) => {
    if (j === k) start = flat.length;
    flat.push(...r.items);
  });
  viewer.open(flat, start, () => renderHome());
}
function openStoryByHash(key: string) {
  if (!data) return;
  const rs = rings();
  // ‎#story-N = עצירה מספר N (כמו בגרסה 4); אחרת המפתח של הסטורי (m-<id> / s-<id>)
  const n = /^\d+$/.test(key) ? +key - 1 : -1;
  const want = n >= 0 && data.missions[n] ? `m-${data.missions[n].id}` : key;
  const k = rs.findIndex((r) => r.items.some((it) => it.key === want));
  if (k >= 0) openRing(k);
  else if (n >= 0 && data.missions[n]) viewer.open([official(n)], 0, () => renderHome());
}

// ══════════════ ניווט בין טאבים ══════════════
type Tab = 'home' | 'map' | 'clips' | 'stats';
let tab: Tab = 'home';
let mapFrame: HTMLIFrameElement | null = null;
function mapTab(hash = '') {
  const view = $('#view-map');
  const src = `${B}index.html?embed${hash}`;
  if (!mapFrame) {
    mapFrame = h('iframe', { class: 'ap-frame', src, title: 'המפה', allow: 'autoplay; fullscreen' }) as HTMLIFrameElement;
    view.append(mapFrame);
  } else if (hash) {
    try {
      mapFrame.contentWindow!.location.hash = hash;
    } catch {
      mapFrame.src = src;
    }
  }
}
function show(t: Tab, opts: { stop?: number; clip?: string } = {}) {
  tab = t;
  document.querySelectorAll<HTMLElement>('[data-view]').forEach((v) => (v.hidden = v.dataset.view !== t));
  document.querySelectorAll<HTMLElement>('[data-tab]').forEach((a) => (a.dataset.tab === t ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  document.body.dataset.tab = t;
  if (t === 'map') mapTab(opts.stop != null ? `#m-${opts.stop + 1}` : '');
  if (t === 'stats') renderStats();
  if (t === 'clips') renderClips(opts.clip);
  else pauseFeed();
}
function route() {
  const hs = location.hash.slice(1);
  const m = hs.match(/^m-(\d+)$/);
  const s = hs.match(/^story-(.+)$/);
  const c = hs.match(/^clip-(.+)$/);
  if (m) show('map', { stop: +m[1] - 1 });
  else if (c) show('clips', { clip: decodeURIComponent(c[1]) });
  else if (s) {
    if (tab !== 'home') show('home');
    if (!viewer.isOpen()) openStoryByHash(decodeURIComponent(s[1]));
  } else if (hs === 'map' || hs === 'clips' || hs === 'stats') show(hs);
  else if (hs === 'upload') {
    show('home');
    openUpload();
  } else if (hs === 'chat') {
    show('home');
    openChat();
  } else show('home');
}
addEventListener('hashchange', route);

// ══════════════ העלאת סטורי (＋) ══════════════
function openUpload() {
  openSheet('סטורי חדש', uploadBody(), { tall: true });
}
function uploadBody(): HTMLElement {
  const v = getViewer();
  if (!v)
    return h(
      'div',
      { class: 'ap-empty' },
      svg('upload', 36),
      h('p', {}, h('strong', {}, 'צילמתם רגע טוב מהלייב?'), ' מתחברים עם Kick, מעלים צילום מסך, ומוד מאשר לפני שזה מופיע לכולם.'),
      btn('btn btn--kick', [h('span', { class: 'kick-mark', ariaHidden: 'true' }, 'K'), 'התחברות עם Kick'], () => login(store)),
    );
  let file: File | null = null;
  const preview = h('span', { class: 'ap-up__preview' }, svg('upload', 30), h('span', {}, 'בחירת תמונה'), h('small', {}, 'צילום מסך מהמשחק או מהלייב'));
  const input = h('input', { type: 'file', accept: 'image/*', class: 'ap-up__file' });
  const send = h('button', { type: 'submit', class: 'btn btn--primary', disabled: true }, 'שליחה לאישור');
  const take = (f: File | null | undefined) => {
    if (!f || !f.type.startsWith('image/')) return;
    file = f;
    preview.replaceChildren(h('img', { src: URL.createObjectURL(f), alt: 'התמונה שנבחרה' }));
    send.disabled = false;
  };
  input.onchange = () => take(input.files?.[0]);
  const cap = h('textarea', { class: 'f-in', rows: 2, maxLength: 160, placeholder: 'כיתוב קצר (לא חובה)' });
  const cur = data ? currentIndex(data) : -1;
  const tie = h('input', { type: 'checkbox', checked: cur >= 0 });
  const form = h(
    'form',
    { class: 'ap-up' },
    h('label', { class: 'ap-up__pick' }, preview, input),
    cap,
    cur >= 0 && data ? h('label', { class: 'check' }, tie, h('span', {}, `לשייך לעצירה ${cur + 1}: ${data.missions[cur].title}`)) : null,
    send,
    h('p', { class: 'f-hint' }, `מחובר כ-${v.username} · `, btn('linkish', 'התנתקות', () => (logout(), openUpload()))),
  );
  form.addEventListener('paste', (e) => take([...(e.clipboardData?.items ?? [])].find((x) => x.type.startsWith('image/'))?.getAsFile()));
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!file) return;
    send.disabled = true;
    send.textContent = 'שולח…';
    try {
      await store.submitStory(v, { image: file, caption: cap.value, mission_id: tie.checked && data && cur >= 0 ? data.missions[cur].id : null, x: null, y: null });
      fill(form, h('div', { class: 'ap-empty is-done' }, svg('check', 38), h('p', {}, h('strong', {}, 'נשלח לאישור.'), ' מוד יאשר את הסטורי, ואז הוא יופיע לכולם בשורת הסטוריז.'), btn('btn', 'סגירה', () => closeSheet?.())));
    } catch (err) {
      toast((err as Error).message);
      send.disabled = false;
      send.textContent = 'שליחה לאישור';
    }
  };
  return form;
}

// ══════════════ צ׳אט (כל התגובות) ══════════════
const whereOf = (c: Comment) => {
  if (c.target_type === 'stop' && data) {
    const i = data.missions.findIndex((m) => m.id === c.target_id);
    return { label: i >= 0 ? `עצירה ${i + 1}` : 'עצירה', go: i >= 0 ? () => (closeSheet?.(), (location.hash = `#m-${i + 1}`)) : null };
  }
  if (c.target_type === 'clip') return { label: 'קליפ', go: () => (closeSheet?.(), (location.hash = `#clip-${encodeURIComponent(c.target_id)}`)) };
  return { label: c.target_type === 'story' ? 'סטורי' : 'מרקר', go: null };
};
function chatList(list: Comment[]) {
  return h(
    'ol',
    { class: 'ap-chat' },
    ...list.map((c) => {
      const w = whereOf(c);
      const row = h('div', { class: 'ap-chat__msg' }, h('span', { class: 'ap-chat__pic' }, c.username.slice(0, 1).toUpperCase()), h('div', { class: 'ap-chat__main' }, h('p', { class: 'ap-chat__meta' }, h('strong', {}, c.username), h('span', {}, `${w.label} · ${ago(c.created_at)}`)), h('p', { class: 'ap-chat__body' }, c.body)));
      if (w.go) {
        const b = btn('ap-chat__go', [row], w.go, `${c.username}: ${c.body}`);
        return h('li', {}, b);
      }
      return h('li', {}, row);
    }),
  );
}
function openChat() {
  const list = [...comments].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 80);
  openSheet('הצ׳אט של האתר', list.length ? chatList(list) : h('div', { class: 'ap-empty' }, h('p', {}, 'עוד אין תגובות. פותחים עצירה, קליפ או סטורי ומגיבים שם.')), { tall: true });
}

// ══════════════ בית ══════════════
const home = $('#view-home');
function renderHome() {
  if (!data) return;
  if (viewer.isOpen() || document.body.classList.contains('is-sheet')) return;
  // לא בונים מחדש בזמן הקלדה (תגובה / הצבעה)
  if (home.contains(document.activeElement) && document.activeElement?.matches('textarea, input')) return;
  const d = data;
  const ms = d.missions;
  const cur = currentIndex(d);
  const seen = seenSet();
  const keep = home.querySelector<HTMLElement>('.ap-rings')?.scrollLeft ?? 0;
  const keepY = home.scrollTop;

  const rs = rings();
  const ringRow = h(
    'div',
    { class: 'ap-rings', role: 'list', ariaLabel: 'סטוריז' },
    btn('ap-ring ap-ring--add', [h('span', { class: 'ap-ring__face' }, svg('plus', 26)), h('span', { class: 'ap-ring__name' }, 'הסטורי שלך')], openUpload, 'להעלות סטורי'),
    ...rs.map((r, k) => {
      const unseen = r.items.some((it) => !seen.has(it.key));
      const b = btn(`ap-ring ${unseen ? '' : 'is-seen'} ${r.today ? 'is-today' : ''} ${r.items[0].kind === 'official' && !r.today ? 'is-official' : ''}`, [h('span', { class: 'ap-ring__face' }, r.face()), h('span', { class: 'ap-ring__name' }, r.title), r.fresh ? h('span', { class: 'ap-ring__new' }, 'חדש') : h('span')], () => openRing(k), `סטורי: ${r.title}`);
      b.setAttribute('role', 'listitem');
      return b;
    }),
  );

  const liveNow = isLive();
  const s = live?.status;
  const liveCard = liveNow
    ? btn('ap-card ap-live-card', [h('span', { class: 'ap-live-card__dot', ariaHidden: 'true' }), h('span', { class: 'ap-live-card__txt' }, h('strong', {}, onGame() ? 'משחק GTA 6 עכשיו' : 'בלייב עכשיו'), h('small', {}, [s?.title, statusFresh(s ?? null) && s?.viewers ? `${num(s.viewers)} צופים` : ''].filter(Boolean).join('  |  '))), h('span', { class: 'ap-live-card__go' }, svg('play', 16), 'לצפייה')], watchLive)
    : h('a', { class: 'ap-card ap-off-card', href: `https://kick.com/${kickSlug(d.settings.kick_channel)}`, target: '_blank', rel: 'noopener' }, h('span', {}, h('strong', {}, 'לא בלייב כרגע'), h('small', {}, 'עוקבים ב-Kick כדי לקבל התראה כשמתחילים')), svg('external', 20));

  const m = ms[cur];
  const nC = m ? commentCount('stop', m.id) : 0;
  const nowCard = m
    ? h(
        'article',
        { class: 'ap-card ap-now' },
        h('div', { class: 'ap-now__map' }, stopBg(cur, 900, 480, 0.24) ?? h('span')),
        h(
          'div',
          { class: 'ap-now__body' },
          h('p', { class: 'ap-kicker' }, 'אנחנו עכשיו ב'),
          h('h2', {}, m.title || `עצירה ${cur + 1}`),
          h('p', { class: 'ap-muted' }, [`עצירה ${cur + 1}`, m.chapter, m.stream_day ? `יום ${m.stream_day}` : ''].filter(Boolean).join('  |  ')),
          h('div', { class: 'ap-row' }, h('a', { class: 'pill pill--solid', href: `#m-${cur + 1}` }, svg('pin', 18), 'במפה'), btn('pill', [svg('chat', 18), nC ? `${nC} תגובות` : 'להגיב'], () => openComments('stop', m.id, m.title)), m.recap_url ? btn('pill pill--icon', [svg('play', 18)], () => watch(m), 'לצפייה בקטע') : null),
        ),
      )
    : null;

  const l = live;
  const quick = h(
    'a',
    { class: 'ap-quick', href: '#stats', ariaLabel: 'לכל המספרים' },
    h('span', { class: 'ap-quick__item ap-quick__item--play' }, h('b', {}, l ? fmtPlay(playMs(l)) : '–'), h('small', {}, 'שעות משחק')),
    h('span', { class: 'ap-quick__item' }, h('b', {}, l ? num(countOf(l, 'deaths')) : '–'), h('small', {}, 'מיתות')),
    h('span', { class: 'ap-quick__item' }, h('b', {}, num(ms.length)), h('small', {}, 'עצירות')),
  );

  const poll = (ex?.polls ?? []).find((p) => pollOpen(p));
  const pollBlock = poll ? h('section', { class: 'ap-block' }, h('div', { class: 'ap-block__head' }, h('h3', {}, 'הצ׳אט מחליט')), pollCard(poll, { store, toast, voting: true, onLocate: poll.x != null ? () => (location.hash = '#map') : undefined })) : null;

  const recentC = [...comments].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 3);
  const chatBlock = h(
    'section',
    { class: 'ap-block' },
    h('div', { class: 'ap-block__head' }, h('h3', {}, 'מהצ׳אט של האתר'), comments.length ? btn('ap-link', 'הכול', openChat) : null),
    recentC.length ? chatList(recentC) : h('p', { class: 'ap-muted' }, 'עוד אין תגובות. פותחים עצירה או סטורי ומגיבים שם.'),
  );

  const clips = (l?.clips ?? []).slice(0, 8);
  const clipRow = clips.length
    ? h(
        'section',
        { class: 'ap-block' },
        h('div', { class: 'ap-block__head' }, h('h3', {}, 'קליפים אחרונים'), h('a', { class: 'ap-link', href: '#clips' }, 'הכול')),
        h('div', { class: 'ap-mini-clips' }, ...clips.map((c) => h('a', { class: 'ap-mini-clip', href: `#clip-${encodeURIComponent(c.id)}` }, c.thumbnail_url ? h('img', { src: c.thumbnail_url, alt: '', loading: 'lazy' }) : null, h('span', { class: 'ap-mini-clip__play', ariaHidden: 'true' }, svg('play', 14)), h('span', { class: 'ap-mini-clip__t' }, c.title || 'קליפ')))),
      )
    : null;

  const recent = ms.map((x, i) => ({ x, i })).slice(-6).reverse();
  const recentList = h(
    'section',
    { class: 'ap-block' },
    h('div', { class: 'ap-block__head' }, h('h3', {}, 'העצירות האחרונות'), h('a', { class: 'ap-link', href: '#map' }, 'למפה')),
    h(
      'ol',
      { class: 'ap-stops' },
      ...recent.map(({ x, i }) =>
        h(
          'li',
          {},
          h(
            'a',
            { href: x.is_milestone ? `#story-${i + 1}` : `#m-${i + 1}`, class: `ap-stop ${i === cur ? 'is-now' : ''} ${freshIds.has(x.id) ? 'is-fresh' : ''}` },
            h('span', { class: `ap-stop__no ${x.is_milestone ? 'is-ms' : ''}` }, String(i + 1)),
            h('span', { class: 'ap-stop__txt' }, h('strong', {}, x.title || `עצירה ${i + 1}`), h('small', {}, i === cur ? 'כאן אנחנו עכשיו' : [x.is_milestone ? 'מיילסטון' : '', ago(x.happened_at)].filter(Boolean).join('  |  '))),
            commentCount('stop', x.id) ? h('span', { class: 'ap-stop__c' }, svg('chat', 14), String(commentCount('stop', x.id))) : null,
          ),
        ),
      ),
    ),
  );

  fill(home, h('h1', { class: 'ap-hello' }, d.settings.title || 'סאבתון GTA 6'), ringRow, liveCard, nowCard, quick, pollBlock, chatBlock, clipRow, recentList, h('p', { class: 'ap-foot' }, 'אתר מעריצים לא רשמי. אינו קשור ל-Rockstar Games.'));
  home.querySelector<HTMLElement>('.ap-rings')!.scrollLeft = keep;
  home.scrollTop = keepY;
  // הבר העליון: "בלייב"
  const lb = $<HTMLButtonElement>('[data-live]');
  lb.hidden = !liveNow;
  lb.textContent = onGame() ? 'GTA 6 בלייב' : 'בלייב';
  lb.onclick = watchLive;
  // נקודה על "בית" כשיש סקר פתוח
  document.querySelector('[data-tab="home"]')?.classList.toggle('has-dot', !!poll && tab !== 'home');
}

// ══════════════ מספרים ══════════════
const statsEl = $('#view-stats');
function renderStats() {
  if (!data || tab !== 'stats') return;
  if (statsEl.querySelector('.is-playing')) return;
  const keep = statsEl.scrollTop;
  fill(statsEl, h('h1', { class: 'ap-hello' }, 'המספרים'), h('div', { class: 'ap-stats' }, ...statsView(data, live, ex, { openStop: (i) => (location.hash = `#m-${i + 1}`), openMarker: () => (location.hash = '#map') })));
  statsEl.scrollTop = keep;
}

// ══════════════ פיד קליפים ══════════════
const feedEl = $('#view-clips');
let muted = true;
let feedIO: IntersectionObserver | null = null;
let feedKey = '';
const reelStops = new WeakMap<HTMLElement, () => void>();
let playing: Array<() => void> = [];
function pauseFeed() {
  playing.forEach((f) => f());
  playing = [];
}
function renderClips(focusId?: string) {
  const clips = live?.clips ?? [];
  const key = clips.map((c) => c.id).join();
  if (key === feedKey && feedEl.firstChild && !focusId) {
    observe();
    return;
  }
  feedKey = key;
  pauseFeed();
  feedIO?.disconnect();
  if (!clips.length) {
    fill(feedEl, h('div', { class: 'ap-empty' }, svg('clips', 36), h('p', {}, 'עוד אין קליפים מ-GTA 6. עושים קליפ בלייב והוא מופיע כאן תוך כמה דקות.')));
    return;
  }
  fill(feedEl, h('div', { class: 'ap-feed' }, live?.demoClips ? h('p', { class: 'ap-feed__note' }, 'תצוגה מקדימה: קליפים מהערוץ מכל המשחקים') : null, ...clips.map((c, k) => reel(c, k))));
  observe();
  if (focusId) feedEl.querySelector<HTMLElement>(`[data-clip="${CSS.escape(focusId)}"]`)?.scrollIntoView({ block: 'start' });
}
function observe() {
  feedIO?.disconnect();
  feedIO = new IntersectionObserver(
    (es) => {
      for (const e of es) {
        const el = e.target as HTMLElement;
        if (e.isIntersecting && e.intersectionRatio > 0.6) startReel(el);
        else reelStops.get(el)?.();
      }
    },
    { root: feedEl, threshold: [0, 0.6, 1] },
  );
  feedEl.querySelectorAll('.ap-reel').forEach((r) => feedIO!.observe(r));
}
function startReel(el: HTMLElement) {
  if (tab !== 'clips' || reelStops.has(el)) return;
  const c = (live?.clips ?? []).find((x) => x.id === el.dataset.clip);
  if (!c) return;
  const holder = h('div', { class: 'ap-reel__video' });
  el.querySelector('.ap-reel__media')!.append(holder);
  const stop = playClip(holder, c);
  const v = holder.querySelector('video')!;
  v.muted = muted;
  v.loop = true;
  v.controls = false;
  v.playsInline = true;
  v.play().catch(() => {});
  const s = () => {
    stop();
    holder.remove();
    reelStops.delete(el);
    playing = playing.filter((f) => f !== s);
  };
  reelStops.set(el, s);
  playing.push(s);
}
function reel(c: Clip, k: number) {
  const n = commentCount('clip', c.id);
  const muteBtn = btn('ap-reel__btn ap-reel__mute', [svg(muted ? 'mute' : 'volume', 24)], () => toggleMute(), muted ? 'הפעלת קול' : 'השתקה');
  const media = h(
    'div',
    { class: 'ap-reel__media' },
    c.thumbnail_url ? h('img', { class: 'ap-reel__bg', src: c.thumbnail_url, alt: '', loading: k < 2 ? 'eager' : 'lazy' }) : null,
    c.thumbnail_url ? h('img', { class: 'ap-reel__poster', src: c.thumbnail_url, alt: '', loading: k < 2 ? 'eager' : 'lazy' }) : null,
  );
  const toggleMute = () => {
    muted = !muted;
    feedEl.querySelectorAll('video').forEach((v) => (v.muted = muted));
    feedEl.querySelectorAll('.ap-reel__mute').forEach((b) => {
      b.replaceChildren(svg(muted ? 'mute' : 'volume', 24));
      b.setAttribute('aria-label', muted ? 'הפעלת קול' : 'השתקה');
    });
  };
  media.onclick = toggleMute;
  const stopIdx = data ? data.missions.reduce((b, m, i) => (m.happened_at && Date.parse(m.happened_at) <= Date.parse(c.created_at) ? i : b), -1) : -1;
  const art = h(
    'article',
    { class: 'ap-reel' },
    media,
    h(
      'div',
      { class: 'ap-reel__side' },
      btn('ap-reel__btn', [svg('chat', 24), h('span', {}, n ? String(n) : '')], () => openComments('clip', c.id, c.title), 'תגובות'),
      btn('ap-reel__btn', [svg('share', 24)], () => share(`${location.origin}${location.pathname}#clip-${encodeURIComponent(c.id)}`, c.title), 'שיתוף'),
      stopIdx >= 0 && !live?.demoClips ? h('a', { class: 'ap-reel__btn', href: `#m-${stopIdx + 1}`, ariaLabel: `לעצירה ${stopIdx + 1}` }, svg('pin', 24)) : null,
      muteBtn,
    ),
    h('div', { class: 'ap-reel__info' }, h('strong', {}, c.title || 'קליפ'), h('small', {}, [c.creator ? `קליפ של ${c.creator}` : '', `${num(c.views)} צפיות`, ago(c.created_at)].filter(Boolean).join('  |  '))),
  );
  art.dataset.clip = c.id;
  return art;
}

// ══════════════ כותרת: התקנה (PWA) ══════════════
let deferred: (Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }) | null = null;
const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);
const install = $<HTMLButtonElement>('[data-install]');
install.hidden = !(ios && !standalone);
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e as typeof deferred;
  install.hidden = standalone;
});
addEventListener('appinstalled', () => {
  install.hidden = true;
  toast('הותקן. הסאבתון מחכה לך במסך הבית.');
});
install.onclick = async () => {
  if (deferred) {
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === 'accepted') install.hidden = true;
    deferred = null;
    return;
  }
  openSheet('התקנה באייפון', h('ol', { class: 'ap-ios' }, h('li', {}, 'לוחצים על כפתור השיתוף של Safari (הריבוע עם החץ, למטה).'), h('li', {}, 'בוחרים "הוספה למסך הבית".'), h('li', {}, 'לוחצים "הוספה". האייקון של הסאבתון מופיע במסך הבית ונפתח כמו אפליקציה.')));
};
$<HTMLButtonElement>('[data-upload]').onclick = openUpload;
onViewer(() => {
  // התחברות / התנתקות בזמן שגיליון ההעלאה פתוח – בונים אותו מחדש
  const head = sheetWrap.querySelector('.ap-sheet__head h3');
  if (head?.textContent === 'סטורי חדש') openUpload();
});

// ══════════════ טעינה ══════════════
fetch(`${B}trail.json`)
  .then((r) => (r.ok ? r.json() : null))
  .then((t) => (trailRaw = t))
  .catch(() => {})
  .finally(() => {
    mapImg.onload = () => {
      computePoints();
      renderHome();
    };
    mapImg.src = `${B}map-original.webp`;
  });

store
  .load()
  .then((d) => {
    data = d;
    computePoints();
    renderHome();
    route();
    store.subscribe((nd) => {
      const known = new Set(data!.missions.map((m) => m.id));
      const added = nd.missions.filter((m) => !known.has(m.id));
      data = nd;
      computePoints();
      if (added.length) {
        added.forEach((m) => freshIds.add(m.id));
        const a = added[added.length - 1];
        toast(a.is_milestone ? `מיילסטון חדש: ${a.title}` : `עצירה חדשה: ${a.title}`);
      }
      renderHome();
      renderStats();
    });
    store.loadLive().then((l) => {
      live = l;
      renderHome();
      renderStats();
      if (tab === 'clips') renderClips();
    });
    store.subscribeLive((l) => {
      live = l;
      renderHome();
      renderStats();
      if (tab === 'clips') renderClips();
    });
    const onExtras = (e: Extras) => {
      const before = new Set((ex ? liveStories(ex.stories) : []).map((s) => `s-${s.id}`));
      const now = liveStories(e.stories).map((s) => `s-${s.id}`);
      if (ex) now.filter((k) => !before.has(k)).forEach((k) => (freshIds.add(k), toast('סטורי חדש בשורת הסטוריז')));
      ex = e;
      renderHome();
      renderStats();
    };
    store.loadExtras(false).then(onExtras).catch(console.error);
    store.subscribeExtras(onExtras, false);
    initComments(store, (list) => {
      comments = list;
      renderHome();
    });
  })
  .catch((e) => {
    console.error(e);
    fill(home, h('p', { class: 'ap-empty' }, 'הנתונים לא נטענו. נסו לרענן.'));
  });

if (loginError) setTimeout(() => toast('ההתחברות עם Kick לא הצליחה. נסו שוב.'), 600);
// זמן המשחק מתקתק
setInterval(() => {
  const b = home.querySelector('.ap-quick__item--play b');
  if (b && live) b.textContent = fmtPlay(playMs(live));
}, 15_000);

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register(`${B}sw.js`, { scope: B }).catch(() => {});

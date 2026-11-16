// חלונית עצירה / קליפ: בטלפון גיליון מלמטה, במחשב מגירה מהצד. <dialog> אמיתי: מלכודת פוקוס ו-Esc.
import { countOf, currentIndex, type Clip, type Mission } from '../data/types';
import { h, safeUrl } from '../dom';
import { placeAll, loadTrail } from './geo';
import { createPlayer, playable } from './player';
import { on, state } from './state';
import { createTalk } from './talk';
import { asset, bdi, dur, ico, num, whenText, ago } from './ui';

const dlg = h('dialog', { class: 'sheet' });
dlg.setAttribute('aria-labelledby', 'sheet-title');
const panel = h('div', { class: 'sheet__panel' });
dlg.append(panel);

let cleanup: Array<() => void> = [];
let openKey = '';
let onClose: () => void = () => {};

export function mountSheet(closeHandler: () => void) {
  document.body.append(dlg);
  onClose = closeHandler;
  dlg.addEventListener('close', () => {
    teardown();
    openKey = '';
    document.documentElement.classList.remove('has-sheet');
    onClose();
  });
  // לחיצה על הרקע סוגרת
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  });
  on('data', () => {
    if (openKey.startsWith('stop:')) refreshStop();
  });
  on('live', () => {
    if (openKey.startsWith('clip:') && !panel.querySelector('.player')) refreshClip();
    if (openKey.startsWith('stop:')) refreshStop();
  });
}

function teardown() {
  cleanup.forEach((f) => f());
  cleanup = [];
}

function show() {
  if (!dlg.open) {
    dlg.showModal();
    document.documentElement.classList.add('has-sheet');
  }
  panel.scrollTop = 0;
  panel.querySelector<HTMLElement>('.sheet__close')?.focus({ preventScroll: true });
}

export function closeSheet() {
  if (dlg.open) dlg.close();
}
export const sheetKey = () => openKey;

/** מחליף את תוכן החלונית בלי לאבד את פוקוס המקלדת (אם הוא היה על כפתור הסגירה או נפל) */
function paint(...nodes: Array<Node | null>) {
  const a = document.activeElement as HTMLElement | null;
  const sel = a instanceof HTMLTextAreaElement ? [a.selectionStart, a.selectionEnd] : null;
  const st = panel.scrollTop;
  panel.replaceChildren(...nodes.filter((n): n is Node => !!n));
  panel.scrollTop = st;
  if (!dlg.open) return;
  // צומת שנשאר (תיבת תגובה, נגן) – מחזירים אליו את הפוקוס; אחרת לכפתור הסגירה
  if (a && a !== document.body && panel.contains(a)) {
    a.focus({ preventScroll: true });
    if (sel && a instanceof HTMLTextAreaElement) a.setSelectionRange(sel[0], sel[1]);
  } else if (!panel.contains(document.activeElement)) panel.querySelector<HTMLElement>('.sheet__close')?.focus({ preventScroll: true });
}

function closeBtn() {
  return h('button', { type: 'button', class: 'sheet__close', ariaLabel: 'סגירה', onclick: () => dlg.close() }, ico.close());
}

/** כתובת קליפ של Kick → הקליפ מהרשימה (כדי לנגן בתוך האתר) */
function clipFromUrl(url: string | null): Clip | null {
  const id = url?.match(/clips?\/(clip_[\w-]+)/i)?.[1] ?? url?.match(/[?&]clip=(clip_[\w-]+)/i)?.[1];
  return (id && state.live?.clips.find((c) => c.id === id)) || null;
}

function miniMap(m: Mission, i: number) {
  const custom = safeUrl(state.data.settings.map_image_url);
  const pts = placeAll(state.data.missions, !custom);
  const p = pts[i];
  if (!p) return null;
  const img = h('img', { src: custom ?? asset('map-original.webp'), alt: '', loading: 'lazy', draggable: false });
  img.style.transform = `translate(${-p.x * 100}%, ${-p.y * 100}%)`;
  return h('a', { class: 'mini', href: `#/map?stop=${encodeURIComponent(m.id)}`, ariaLabel: 'הצגה על המפה' },
    img,
    h('span', { class: `mini__pin ${m.is_milestone ? 'is-ms' : ''}`, ariaHidden: 'true' }),
    h('span', { class: 'mini__label' }, ico.map(), 'על המפה'),
  );
}

// ── עצירה ──
let stopId = '';
let stopSig = '';
let mediaNode: HTMLElement | null = null;
let mediaUrl = '';
let talkNode: HTMLElement | null = null;

export function openStop(id: string) {
  const key = `stop:${id}`;
  if (openKey === key && dlg.open) return;
  teardown();
  openKey = key;
  stopId = id;
  stopSig = '';
  mediaNode = null;
  mediaUrl = '';
  talkNode = null;
  loadTrail().then(() => openKey === key && refreshStop(true));
  refreshStop();
  show();
}

function recapMedia(m: Mission): HTMLElement | null {
  const url = m.recap_url;
  const clip = clipFromUrl(url);
  const p = clip ? playable(clip.video_url) : playable(url);
  const img = safeUrl(m.image_url) ?? clip?.thumbnail_url ?? null;
  if (p) {
    // לא מנגנים לבד: כפתור הפעלה גדול על התמונה
    const box = h('div', { class: 'media' });
    const start = h('button', { type: 'button', class: 'media__start' },
      img ? h('img', { src: img, alt: '' }) : h('span', { class: 'media__blank' }),
      h('span', { class: 'media__play' }, ico.play(28), h('span', {}, 'לצפייה בקטע')),
    );
    start.onclick = () => {
      const pl = createPlayer(p, { poster: img, title: m.title, fallbackHref: url });
      box.replaceChildren(pl.el);
      cleanup.push(pl.destroy);
      pl.el.querySelector<HTMLElement>('video, iframe')?.focus();
    };
    box.append(start);
    return box;
  }
  if (img) return h('figure', { class: 'media' }, h('img', { class: 'media__img', src: img, alt: m.title }));
  return null;
}

function refreshStop(force = false) {
  const ms = state.data.missions;
  const i = ms.findIndex((m) => m.id === stopId);
  const m = ms[i];
  if (!m) {
    if (!state.loaded) return;
    paint(closeBtn(), h('div', { class: 'sheet__body' }, h('h2', { id: 'sheet-title', class: 'sheet__title' }, 'העצירה הזו כבר לא על הדרך'), h('p', {}, 'ייתכן שהיא נמחקה או שהקישור שגוי.')));
    return;
  }
  const lv = state.live;
  const sig = JSON.stringify([m, i, ms.length, currentIndex(state.data), lv ? countOf(lv, 'deaths', m.id) : -1, lv ? countOf(lv, 'cats', m.id) : -1, lv?.clips.length ?? -1, state.data.settings.map_image_url]);
  if (sig === stopSig && !force) return;
  stopSig = sig;

  const clipsKey = `${m.recap_url}|${m.image_url}|${lv?.clips.length ?? 0}`;
  if (mediaUrl !== clipsKey && !mediaNode?.querySelector('.player')) {
    mediaNode = recapMedia(m);
    mediaUrl = clipsKey;
  }
  talkNode ??= (() => {
    const t = createTalk('stop', m.id, 'העצירה הזו');
    cleanup.push(t.destroy);
    return t.el;
  })();

  const cur = currentIndex(state.data);
  const status = i === cur ? 'אתה כאן' : i > cur ? 'בהמשך הדרך' : null;
  const live = state.live;
  const deaths = live ? countOf(live, 'deaths', m.id) : 0;
  const cats = live ? countOf(live, 'cats', m.id) : 0;
  const recap = safeUrl(m.recap_url);
  const dl = safeUrl(m.download_url);
  const playableInline = !!mediaNode?.querySelector('.media__start, .player');

  const prev = ms[i - 1];
  const next = ms[i + 1];
  const navBtn = (t: Mission | undefined, dir: 'prev' | 'next') =>
    t
      ? h('a', { class: `step step--${dir}`, href: `#/stop/${encodeURIComponent(t.id)}`, onclick: (e: MouseEvent) => { e.preventDefault(); location.replace(`#/stop/${encodeURIComponent(t.id)}`); } },
          dir === 'prev' ? ico.prev() : null,
          h('span', {}, h('small', {}, dir === 'prev' ? 'העצירה הקודמת' : 'העצירה הבאה'), h('span', { class: 'step__t' }, t.title || `עצירה ${ms.indexOf(t) + 1}`)),
          dir === 'next' ? ico.next() : null,
        )
      : h('span', { class: 'step step--none' });

  const paras = (m.body || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  paint(
    closeBtn(),
    h('header', { class: `sheet__sign ${m.is_milestone ? 'is-ms' : ''} ${m.kind === 'moment' ? 'is-moment' : ''}` },
      h('span', { class: 'sheet__tab' }, `יציאה ${i + 1}`, m.is_milestone ? ', מיילסטון' : m.kind === 'moment' ? ', רגע' : ''),
      h('h2', { id: 'sheet-title', class: 'sheet__title' }, m.title || `עצירה ${i + 1}`),
      h('p', { class: 'sheet__where' },
        status ? h('b', { class: 'sheet__status' }, status) : null,
        [m.chapter, m.stream_day ? `יום ${m.stream_day}` : null, whenText(m.happened_at)].filter(Boolean).join(', '),
      ),
    ),
    h('div', { class: 'sheet__body' },
      mediaNode,
      (recap && !playableInline) || dl
        ? h('div', { class: 'sheet__actions' },
            recap && !playableInline ? h('a', { class: 'btn btn--sign', href: recap, target: '_blank', rel: 'noopener' }, ico.play(18), 'לצפייה בקטע', ico.out()) : null,
            dl ? h('a', { class: 'btn btn--ghost', href: dl, target: '_blank', rel: 'noopener', download: '' }, ico.download(), 'הורדה') : null,
          )
        : null,
      m.summary ? h('p', { class: 'sheet__lede' }, m.summary) : null,
      m.quote ? h('blockquote', { class: 'quote' }, h('p', {}, m.quote), m.quote_by ? h('cite', {}, bdi(m.quote_by)) : null) : null,
      ...paras.map((p) => h('p', { class: 'sheet__p' }, p)),
      live
        ? h('div', { class: 'here-counts', ariaLabel: 'בעצירה הזו' },
            h('span', { class: 'mini-dia mini-dia--d' }, ico.skull(18), h('b', {}, num(deaths)), h('span', {}, deaths === 1 ? 'מיתה' : 'מיתות')),
            h('span', { class: 'mini-dia mini-dia--c' }, ico.cat(18), h('b', {}, num(cats)), h('span', {}, cats === 1 ? 'חתול' : 'חתולים')),
            h('span', { class: 'here-counts__l' }, 'בעצירה הזו'),
          )
        : null,
      miniMap(m, i),
      h('nav', { class: 'steps', ariaLabel: 'מעבר בין עצירות' }, navBtn(prev, 'prev'), navBtn(next, 'next')),
      talkNode,
    ),
  );
}

// ── קליפ ──
let clipId = '';
export function openClip(id: string) {
  const key = `clip:${id}`;
  if (openKey === key && dlg.open) return;
  teardown();
  openKey = key;
  clipId = id;
  refreshClip();
  show();
}

function refreshClip() {
  const c = state.live?.clips.find((x) => x.id === clipId);
  if (!c) {
    paint(closeBtn(), h('div', { class: 'sheet__body' },
      h('h2', { id: 'sheet-title', class: 'sheet__title sheet__title--plain' }, state.live ? 'הקליפ לא נמצא' : 'טוען קליפ…'),
      state.live ? h('p', {}, 'אולי הוא נמחק ב-Kick.') : null));
    return;
  }
  teardown();
  const kick = `https://kick.com/${state.data.settings.kick_channel || 'odedsvr'}/clips/${c.id}`;
  const p = playable(c.video_url);
  let media: HTMLElement;
  if (p) {
    const pl = createPlayer(p, { poster: c.thumbnail_url, title: c.title, fallbackHref: kick });
    cleanup.push(pl.destroy);
    media = pl.el;
  } else {
    media = h('div', { class: 'player is-failed' }, h('div', { class: 'player__fail' }, h('a', { class: 'btn btn--sign', href: kick, target: '_blank', rel: 'noopener' }, 'לצפייה ב-Kick', ico.out())));
  }
  const talk = createTalk('clip', c.id, 'הקליפ הזה');
  cleanup.push(talk.destroy);
  paint(
    closeBtn(),
    h('div', { class: 'sheet__body sheet__body--clip' },
      media,
      h('h2', { id: 'sheet-title', class: 'sheet__title sheet__title--plain', dir: 'auto' }, c.title || 'קליפ'),
      h('p', { class: 'clipmeta' },
        c.creator ? h('span', {}, 'נחתך ע״י ', bdi(c.creator)) : null,
        h('span', {}, ico.eye(), ` ${num(c.views)} צפיות`),
        c.duration ? h('span', {}, dur(c.duration)) : null,
        h('time', { dateTime: c.created_at }, ago(c.created_at)),
      ),
      h('a', { class: 'btn btn--ghost', href: kick, target: '_blank', rel: 'noopener' }, 'הקליפ ב-Kick', ico.out()),
      talk.el,
    ),
  );
}

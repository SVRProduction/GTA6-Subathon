// קליפים מהקטגוריה: רשת בפאנל, ניגון בתוך האתר (HLS). hls.js נטען רק כשצריך, ובספארי לא בכלל.
import type { Clip, Data, Mission } from './data/types';
import { h } from './dom';
import { ico } from './icons';

const dur = (s: number | null) => (s == null ? '' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
const ago = (iso: string) => {
  const m = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (m < 60) return `לפני ${m} דק'`;
  if (m < 60 * 24) return `לפני ${Math.round(m / 60)} שע'`;
  return `לפני ${Math.round(m / 1440)} ימים`;
};

/** העצירה שהייתה פעילה כשהקליפ צולם: האחרונה שקרתה לפניו */
export function clipStop(c: Clip, missions: Mission[]) {
  const t = Date.parse(c.created_at);
  let best = -1;
  missions.forEach((m, i) => {
    if (m.happened_at && Date.parse(m.happened_at) <= t) best = i;
  });
  return best;
}

let hlsMod: Promise<typeof import('hls.js')> | null = null;
/** מנגן קליפ בתוך האלמנט; מחזיר פונקציה שעוצרת */
export function playClip(box: HTMLElement, c: Clip) {
  const v = h('video', { controls: true, playsInline: true, autoplay: true, poster: c.thumbnail_url ?? undefined }) as HTMLVideoElement;
  box.replaceChildren(v);
  const src = c.video_url ?? '';
  let stop = () => v.pause();
  // hls.js (MSE) קודם; ניגון מובנה רק כשאין MSE (אייפון). Chrome מדווח "maybe" על HLS מובנה גם כשלא באמת מנגן
  const native = () => {
    v.src = src;
  };
  if (!/\.m3u8/.test(src) || !('MediaSource' in window || 'ManagedMediaSource' in window)) native();
  else {
    hlsMod ??= import('hls.js');
    hlsMod.then(({ default: Hls }) => {
      if (!Hls.isSupported()) return native();
      const hls = new Hls({ maxBufferLength: 20 });
      hls.loadSource(src);
      hls.attachMedia(v);
      stop = () => hls.destroy();
    }, native);
  }
  return () => stop();
}

export function clipCard(c: Clip, opts: { stop?: string; onPlay: (c: Clip, el: HTMLElement) => void }) {
  const media = h(
    'button',
    { class: 'clip__media', type: 'button', ariaLabel: `ניגון: ${c.title || 'קליפ'}` },
    c.thumbnail_url ? h('img', { src: c.thumbnail_url, alt: '', loading: 'lazy' }) : null,
    h('span', { class: 'clip__play' }, ico.play()),
    c.duration ? h('span', { class: 'clip__dur' }, dur(c.duration)) : null,
  );
  const card = h(
    'article',
    { class: 'clip' },
    media,
    h('div', { class: 'clip__body' }, h('strong', { class: 'clip__title' }, c.title || 'קליפ'), h('span', { class: 'clip__meta' }, [ago(c.created_at), `${c.views.toLocaleString('he-IL')} צפיות`, c.creator ? `קליפ של ${c.creator}` : '', opts.stop ?? ''].filter(Boolean).join(' · '))),
  );
  media.onclick = () => opts.onPlay(c, media);
  return card;
}

/** תוכן הפאנל "קליפים" */
export function clipsView(clips: Clip[], d: Data, opts: { demo: boolean; channel: string; onStop: (i: number) => void; comments?: (c: Clip) => HTMLElement }) {
  let sort: 'new' | 'top' = 'new';
  let stopPlaying: (() => void) | null = null;
  const grid = h('div', { class: 'clips' });
  const onPlay = (c: Clip, el: HTMLElement) => {
    stopPlaying?.();
    el.classList.add('is-playing');
    stopPlaying = playClip(el, c);
  };
  const draw = () => {
    stopPlaying?.();
    stopPlaying = null;
    const list = [...clips].sort((a, b) => (sort === 'new' ? Date.parse(b.created_at) - Date.parse(a.created_at) : b.views - a.views));
    grid.replaceChildren(
      ...list.map((c) => {
        const i = clipStop(c, d.missions);
        const card = clipCard(c, { stop: i >= 0 ? `עצירה ${i + 1}` : '', onPlay });
        if (i >= 0) {
          const go = h('button', { class: 'clip__stop btn btn--quiet', type: 'button' }, ico.pin(), `לעצירה ${i + 1}`);
          go.onclick = () => opts.onStop(i);
          card.querySelector('.clip__body')!.append(go);
        }
        if (opts.comments) card.append(opts.comments(c));
        return card;
      }),
    );
  };
  const tab = (key: typeof sort, label: string) => {
    const b = h('button', { type: 'button', class: 'seg__btn', ariaPressed: String(sort === key) }, label);
    b.onclick = () => {
      sort = key;
      seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      draw();
    };
    return b;
  };
  const seg = h('div', { class: 'seg', role: 'group', ariaLabel: 'מיון' }, tab('new', 'הכי חדשים'), tab('top', 'הכי נצפים'));
  draw();
  return [
    h('p', { class: 'stop__meta stamp' }, clips.length ? `${clips.length} קליפים מ-GTA 6` : 'קליפים'),
    h('h2', { class: 'stop__title', id: 'panel-title' }, 'קליפים מהלייב'),
    opts.demo ? h('p', { class: 'clips__note' }, 'תצוגה מקדימה: אלה הקליפים האחרונים מהערוץ מכל המשחקים. מ-19.11 יופיעו כאן רק קליפים מ-GTA 6, לבד.') : null,
    clips.length ? seg : null,
    clips.length
      ? grid
      : h('div', { class: 'clips__empty' }, h('p', {}, 'עוד אין קליפים מ-GTA 6. עושים קליפ בלייב והוא מופיע כאן תוך כמה דקות.'), h('a', { class: 'btn', href: `https://kick.com/${opts.channel}/clips`, target: '_blank', rel: 'noopener' }, 'כל הקליפים ב-Kick')),
  ];
}

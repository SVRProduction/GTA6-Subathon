// קליפים מהקטגוריה: רשת בפאנל, ניגון בתוך האתר (HLS). hls.js נטען רק כשצריך, ובספארי לא בכלל.
import type { Clip, Data, LiveData, Mission } from './data/types';
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
  // משימה שהסתיימה לפני הקליפ לא מקבלת אותו (חוץ מהקטע שנבחר בכרטיס שלה)
  const ended = (m: Mission) => !!m.finished_at && Date.parse(m.finished_at) < t && c.kind !== 'range';
  if (c.mission_id) {
    const k = missions.findIndex((m) => m.id === c.mission_id);
    if (k >= 0) return ended(missions[k]) ? -1 : k;
  }
  // קליפ של מוות/מעצר/כישלון בלי משימה = עצמאי (עודד הסתובב)
  if (c.kind === 'moment') return -1;
  let best = -1;
  missions.forEach((m, i) => {
    if (m.happened_at && Date.parse(m.happened_at) <= t) best = i;
  });
  return best >= 0 && ended(missions[best]) ? -1 : best;
}

/** הקטע שנבחר בכרטיס העצירה (מדקה–עד דקה), אם נחתך */
export function rangeClip(missionId: string, live: LiveData | null): Clip | null {
  return live?.clips.find((c) => c.kind === 'range' && c.mission_id === missionId) ?? null;
}

/** "צפה בקטע": מנגן את כל הטווח מההקלטה בקיק; אם היא כבר לא קיימת – את 3 הדקות שנשמרו אצלנו */
export function playRange(box: HTMLElement, c: Clip) {
  if (!c.vod_url || c.vod_from == null || c.vod_to == null) return playClip(box, c);
  const v = h('video', { controls: true, playsInline: true, autoplay: true, poster: c.thumbnail_url ?? undefined }) as HTMLVideoElement;
  box.replaceChildren(v);
  const from = c.vod_from;
  const to = c.vod_to;
  let stopFn = () => v.pause();
  let fellBack = false;
  const fallback = () => {
    if (fellBack) return;
    fellBack = true;
    stopFn();
    stopFn = playClip(box, c);
  };
  // עוצרים בסוף הטווח
  v.addEventListener('timeupdate', () => {
    if (v.currentTime >= to) v.pause();
  });
  const src = c.vod_url;
  if (!('MediaSource' in window || 'ManagedMediaSource' in window)) {
    v.src = src;
    v.addEventListener('loadedmetadata', () => (v.currentTime = from), { once: true });
    v.addEventListener('error', fallback, { once: true });
  } else {
    hlsMod ??= import('hls.js');
    hlsMod.then(({ default: Hls }) => {
      if (!Hls.isSupported()) return fallback();
      const hls = new Hls({ startPosition: from, maxBufferLength: 30 });
      hls.on(Hls.Events.ERROR, (_e, d) => d.fatal && fallback());
      hls.loadSource(src);
      hls.attachMedia(v);
      stopFn = () => hls.destroy();
    }, fallback);
  }
  return () => stopFn();
}

/** תמונה לתצוגה מקדימה של עצירה: התמונה של הקליפ הנצפה ביותר שצולם בזמן העצירה (null = אין) */
export function stopClipThumb(i: number, missions: Mission[], live: LiveData | null): string | null {
  if (!live || live.demoClips) return null; // בדמו הקליפים לא שייכים לעצירות
  let best: Clip | null = null;
  for (const c of live.clips) {
    if (!c.thumbnail_url || !/^https:\/\//.test(c.thumbnail_url)) continue;
    if (clipStop(c, missions) !== i) continue;
    if (!best || (c.views ?? 0) > (best.views ?? 0)) best = c;
  }
  return best?.thumbnail_url ?? null;
}

let hlsMod: Promise<typeof import('hls.js')> | null = null;
/** מנגן קליפ בתוך האלמנט; מחזיר פונקציה שעוצרת */
export function playClip(box: HTMLElement, c: Clip) {
  const v = h('video', { controls: true, playsInline: true, autoplay: true, poster: c.thumbnail_url ?? undefined }) as HTMLVideoElement;
  box.replaceChildren(v);
  // עותק שנשמר אצלנו קודם (הקישור של Kick נעלם כשהשידור נמחק)
  const src = c.archived_url ?? c.video_url ?? '';
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

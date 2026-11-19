// "צפייה בקטע מהלייב": מנגן את ההקלטה של השידור ב-Kick מהדקה שנרשמה בעצירה (clip_start) ועד clip_end.
// בלי להעלות שום קובץ: ההקלטה נשארת ב-Kick, האתר רק קופץ לנקודה בזמן.
import { h } from './dom';
import type { Mission } from './data/types';

type Vod = { uuid: string; start: number; end: number; live: boolean };

/** "1:23:10" / "23:10" / "83" (דקות) → שניות */
export function parseClock(s?: string | null): number | null {
  const t = (s ?? '').trim();
  if (!t) return null;
  const p = t.split(':').map((x) => Number(x));
  if (p.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (p.length === 1) return p[0] * 60;
  if (p.length === 2) return p[0] * 60 + p[1];
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  return null;
}

export const hasVodRange = (m: Mission) => parseClock(m.clip_start) != null;

const lists = new Map<string, Promise<Vod[]>>();
function vods(channel: string) {
  let p = lists.get(channel);
  if (!p) {
    p = fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(channel)}/videos`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Array<{ is_live?: boolean; start_time?: string; created_at?: string; duration?: number; video?: { uuid?: string } }>) =>
        rows
          .filter((v) => v.video?.uuid)
          .map((v) => {
            const start = Date.parse(`${(v.start_time ?? v.created_at ?? '').replace(' ', 'T')}Z`);
            return { uuid: v.video!.uuid!, start, end: v.is_live ? Infinity : start + (v.duration ?? 0), live: !!v.is_live };
          }),
      );
    p.catch(() => lists.delete(channel));
    lists.set(channel, p);
  }
  return p;
}

/** השידור שבו קרתה העצירה (לפי "מתי קרה"); אחרת השידור החי, אחרת האחרון */
async function findVod(channel: string, at: number | null) {
  const all = await vods(channel);
  if (!all.length) return null;
  if (at != null) {
    const hit = all.find((v) => at >= v.start - 10 * 60_000 && at <= v.end);
    if (hit) return hit;
  }
  return all.find((v) => v.live) ?? all[0];
}

/** קישור לנקודה בזמן בעמוד ההקלטה ב-Kick (גיבוי, ולכפתור "פתיחה ב-Kick") */
export const kickVodLink = (channel: string, uuid: string, sec: number) => `https://kick.com/${channel}/videos/${uuid}?t=${Math.floor(sec)}`;

let hlsMod: Promise<typeof import('hls.js')> | null = null;

/** מנגן את הקטע בתוך box. מחזיר פונקציה שעוצרת */
export function playVodRange(box: HTMLElement, m: Mission, channel: string, toast: (t: string) => void) {
  const from = parseClock(m.clip_start) ?? 0;
  const to = parseClock(m.clip_end);
  const v = h('video', { controls: true, playsInline: true, autoplay: true }) as HTMLVideoElement;
  const note = h('p', { class: 'vod-note' }, 'טוען את הקטע מההקלטה ב-Kick…');
  const open = h('a', { class: 'btn btn--small', target: '_blank', rel: 'noopener', hidden: true }, 'פתיחה ב-Kick');
  box.replaceChildren(v, h('div', { class: 'vod-bar' }, note, open));
  box.classList.add('is-playing');
  let stop = () => v.pause();
  let stopped = false;
  v.addEventListener('timeupdate', () => {
    if (to != null && v.currentTime >= to) {
      v.pause();
      note.textContent = 'סוף הקטע';
    }
  });
  (async () => {
    const vod = await findVod(channel, m.happened_at ? Date.parse(m.happened_at) : null);
    if (!vod) throw new Error('no vod');
    open.href = kickVodLink(channel, vod.uuid, from);
    open.hidden = false;
    const j = await fetch(`https://kick.com/api/v1/video/${vod.uuid}`).then((r) => (r.ok ? r.json() : null));
    const src: string | undefined = j?.source;
    if (!src || stopped) throw new Error('no source');
    const native = () => {
      v.src = src;
      v.addEventListener('loadedmetadata', () => (v.currentTime = from), { once: true });
    };
    if (!('MediaSource' in window || 'ManagedMediaSource' in window)) native();
    else {
      hlsMod ??= import('hls.js');
      const { default: Hls } = await hlsMod;
      if (!Hls.isSupported()) native();
      else {
        const hls = new Hls({ maxBufferLength: 20, startPosition: from });
        hls.loadSource(src);
        hls.attachMedia(v);
        stop = () => hls.destroy();
      }
    }
    note.textContent = to != null ? `מהדקה ${m.clip_start} עד ${m.clip_end}` : `מהדקה ${m.clip_start}`;
  })().catch(() => {
    note.textContent = 'לא הצלחנו לנגן כאן.';
    if (open.hidden) toast('ההקלטה של השידור לא נמצאה ב-Kick');
  });
  return () => {
    stopped = true;
    stop();
  };
}

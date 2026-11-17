// תוכן של עצירה, משותף לפאנל הצד, לכרטיס הקטן וליומן המסע
import { h, safeUrl } from '../dom';
import type { Mission } from '../data/types';
import { ico } from '../icons';

/** מספר עצירה, שתי ספרות: 01, 02… */
export const stopNo = (i: number) => String(i + 1).padStart(2, '0');

/** שורת מטא קצרה: יום, ואם יש, פרק (נקודה מפרידה אחת לכל היותר) */
export function metaText(m: Mission) {
  const day = m.stream_day ? `יום ${m.stream_day}` : '';
  return [day, m.chapter || ''].filter(Boolean).join(' · ');
}

export const kindLabel = (m: Mission) => (m.is_milestone ? 'מיילסטון' : m.kind === 'moment' ? 'רגע מהלייב' : 'משימה');

/** וידאו שאפשר לנגן בתוך העמוד (קובץ ישיר או YouTube); קישורי Kick נפתחים בלשונית */
export function videoEmbed(url: string): HTMLElement | null {
  if (/\.(mp4|webm|mov)(\?|$)/i.test(url) || url.startsWith('data:video/'))
    return h('video', { src: url, controls: true, playsInline: true, preload: 'metadata' });
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|live\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
  if (yt) {
    const t = url.match(/[?&]t=(\d+)/);
    return h('iframe', {
      src: `https://www.youtube-nocookie.com/embed/${yt[1]}${t ? `?start=${t[1]}` : ''}`,
      allow: 'accelerometer; autoplay; encrypted-media; picture-in-picture; fullscreen',
      title: 'קטע מהלייב',
    });
  }
  return null;
}

export async function share(m: Mission, i: number, toast: (t: string) => void) {
  const url = `${location.origin}${location.pathname}#m-${i + 1}`;
  try {
    if (navigator.share) await navigator.share({ title: m.title, url });
    else {
      await navigator.clipboard.writeText(url);
      toast('הקישור הועתק');
    }
  } catch {
    /* המשתמש ביטל */
  }
}

/** תמונה; אם יש גם סרטון שמתנגן בעמוד – כפתור הפעלה שמחליף את התמונה בסרטון */
function playable(img: HTMLElement, embed: HTMLElement | null) {
  const fig = h('figure', { class: 'stop__media' }, img);
  if (embed) {
    fig.append(
      h('button', {
        class: 'stop__play',
        type: 'button',
        ariaLabel: 'הפעלת הקטע',
        onclick: () => fig.replaceChildren(embed),
      }, ico.play()),
    );
  }
  return fig;
}

/** תמונה ממוזערת של סרטון YouTube */
function ytThumb(url: string | null) {
  const id = url?.match(/(?:youtube\.com\/(?:watch\?v=|live\/|shorts\/)|youtu\.be\/)([\w-]{11})/)?.[1];
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}

/** הגוף המלא של עצירה: מדיה, ריקאפ, ציטוט, פעולות */
export function stopBody(m: Mission, i: number, toast: (t: string) => void, opts: { embed: boolean; snapshot?: HTMLElement | null }) {
  const url = safeUrl(m.recap_url);
  const dl = safeUrl(m.download_url);
  const img = safeUrl(m.image_url);
  const embed = opts.embed && url ? videoEmbed(url) : null;
  const text = m.body || (opts.embed ? m.summary : '');
  return [
    embed && !img
      ? h('div', { class: 'stop__media' }, embed)
      : img
        ? playable(h('img', { src: img, alt: `תמונה מהקטע: ${m.title}`, loading: 'lazy' }), embed)
        : ytThumb(url)
          ? h('figure', { class: 'stop__media' }, h('img', { src: ytThumb(url)!, alt: `תמונה מהקטע: ${m.title}`, loading: 'lazy' }))
          : opts.snapshot
            ? h('figure', { class: 'stop__media stop__media--map' }, opts.snapshot)
            : null,
    text ? h('p', { class: 'stop__body' }, text) : null,
    m.quote ? h('blockquote', { class: 'stop__quote' }, h('p', {}, m.quote), m.quote_by ? h('cite', {}, m.quote_by) : null) : null,
    (url && !embed) || dl
      ? h(
          'div',
          { class: 'stop__actions' },
          url && !embed ? h('a', { class: 'btn btn--primary', href: url, target: '_blank', rel: 'noopener' }, ico.play(), 'צפייה בקטע') : null,
          dl ? h('a', { class: 'btn', href: dl, download: '', target: '_blank', rel: 'noopener' }, ico.download(), 'הורדה') : null,
        )
      : null,
  ];
}

// נגן: m3u8 (קליפים של Kick) דרך hls.js, mp4 ישיר, YouTube בהטמעה. כל השאר – קישור החוצה.
import { h, safeUrl } from '../dom';
import { ico } from './ui';

export type Playable = { kind: 'hls' | 'file' | 'youtube'; src: string } | null;

export function playable(url: string | null | undefined): Playable {
  const u = safeUrl(url);
  if (!u) return null;
  if (/\.m3u8(\?|$)/i.test(u)) return { kind: 'hls', src: u };
  if (/\.(mp4|webm|mov)(\?|$)/i.test(u) || /^data:video\//i.test(u)) return { kind: 'file', src: u };
  const yt = u.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([\w-]{11})/i);
  if (yt) return { kind: 'youtube', src: `https://www.youtube-nocookie.com/embed/${yt[1]}?autoplay=1&rel=0` };
  return null;
}

/** אלמנט נגן. מחזיר גם destroy כדי לעצור את ה-HLS כשסוגרים */
export function createPlayer(p: NonNullable<Playable>, opts: { poster?: string | null; title: string; fallbackHref?: string | null }) {
  const box = h('div', { class: 'player' });
  let destroy = () => {};

  if (p.kind === 'youtube') {
    const f = h('iframe', { src: p.src, title: opts.title, allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', loading: 'lazy' });
    f.setAttribute('allowfullscreen', '');
    box.append(f);
    return { el: box, destroy };
  }

  const v = h('video', { controls: true, playsInline: true, preload: 'metadata' });
  v.setAttribute('playsinline', '');
  const poster = safeUrl(opts.poster);
  if (poster) v.poster = poster;
  v.setAttribute('aria-label', opts.title);
  box.append(v);

  const fail = () => {
    box.classList.add('is-failed');
    const href = safeUrl(opts.fallbackHref);
    box.append(
      h('div', { class: 'player__fail' },
        h('p', {}, 'הסרטון לא נטען כאן.'),
        href ? h('a', { class: 'btn btn--sign', href, target: '_blank', rel: 'noopener' }, 'לצפייה ב-Kick', ico.out()) : null,
      ),
    );
  };
  v.addEventListener('error', () => !box.classList.contains('is-failed') && fail(), { once: true });

  const start = () => v.play().catch(() => {});

  // hls.js קודם (MSE). HLS מובנה רק כשאין MSE (אייפון ישן): ה-HLS המובנה של Chrome לא מנגן את ה-ts של Kick
  if (p.kind === 'file') {
    v.src = p.src;
    start();
  } else {
    import('hls.js').then(({ default: Hls }) => {
      if (!Hls.isSupported()) {
        v.src = p.src;
        start();
        return;
      }
      const hls = new Hls({ maxBufferLength: 20 });
      hls.on(Hls.Events.ERROR, (_e, d) => {
        if (d.fatal) {
          hls.destroy();
          fail();
        }
      });
      hls.loadSource(p.src);
      hls.attachMedia(v);
      hls.on(Hls.Events.MANIFEST_PARSED, start);
      destroy = () => hls.destroy();
    }, fail);
  }
  return {
    el: box,
    destroy: () => {
      v.pause();
      destroy();
    },
  };
}

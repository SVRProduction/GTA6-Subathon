// סרגל חדשות בתחתית המפה (בסגנון Weazel News): האירועים האחרונים גוללים לאט. לחיצה פותחת את האירוע.
import { h } from '../dom';
import type { FeedEv } from './feed';

const EMOJI: Record<FeedEv['kind'], string> = { ms: '🏆', stop: '📍', death: '💀', cat: '🚨', marker: '📌', clip: '🎬', comment: '💬', story: '📸', poll: '🗳️' };

export function createTicker(stage: HTMLElement, open: (e: FeedEv) => void) {
  const track = h('div', { class: 'ticker__track' });
  const el = h('div', { class: 'ticker', hidden: true, role: 'marquee', ariaLabel: 'מה קרה לאחרונה' }, h('span', { class: 'ticker__brand' }, 'WEAZEL', h('b', {}, 'NEWS')), h('div', { class: 'ticker__win' }, track));
  stage.append(el);
  let key = '';
  return {
    set(all: FeedEv[]) {
      const list = all.slice(0, 8);
      const k = list.map((e) => e.key).join('|');
      if (k === key) return;
      key = k;
      el.hidden = !list.length;
      const items = list.map((e) => {
        const b = h('button', { type: 'button', class: 'ticker__item' }, `${EMOJI[e.kind] ?? '•'} ${e.title}`, e.sub ? h('small', {}, ` · ${e.sub}`) : null);
        b.onclick = () => open(e);
        return b;
      });
      // פעמיים ברצף כדי שהגלילה תהיה רציפה
      track.replaceChildren(...items, ...items.map((b) => {
        const c = b.cloneNode(true) as HTMLElement;
        c.setAttribute('aria-hidden', 'true');
        c.tabIndex = -1;
        c.onclick = (b as HTMLButtonElement).onclick;
        return c;
      }));
      track.style.setProperty('--dur', `${Math.max(24, list.length * 7)}s`);
    },
  };
}

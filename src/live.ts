// תג "משחק עכשיו" במפה. המונים וזמן המשחק נמצאים בדף הסטטיסטיקות (stats.html).
import { kickSlug, statusFresh, type Data, type LiveData } from './data/types';
import { h } from './dom';

/** 187:05 → שעות:דקות */
export const fmtPlay = (ms: number) => {
  const m = Math.floor(ms / 60_000);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
};
/** "4.5 שעות" / "40 דק'" – לפאנל */
export const fmtHours = (ms: number) => (ms < 3600_000 ? `${Math.round(ms / 60_000)} דק'` : `${(ms / 3600_000).toFixed(ms < 36_000_000 ? 1 : 0)} שעות`);

export function createLive(stage: HTMLElement, opts: { onWatch: (channel: string) => void }) {
  let live: LiveData | null = null;
  let data: Data | null = null;

  // ── תג למעלה ──
  const badge = h('button', { class: 'onair', type: 'button', hidden: true });
  badge.onclick = () => data && opts.onWatch(kickSlug(data.settings.kick_channel));

  stage.append(badge);

  function render() {
    if (!live || !data) return;
    const s = live.status;
    const fresh = statusFresh(s);
    // הסטטוס האוטומטי קובע; המתג הידני באדמין רק כשהבדיקה האוטומטית לא פעילה
    const isLive = fresh ? !!s?.is_live : data.settings.is_live;
    const onGame = fresh ? !!s?.on_category : data.settings.is_live;
    badge.hidden = !isLive || !kickSlug(data.settings.kick_channel);
    badge.className = `onair ${onGame ? 'is-game' : ''}`;
    badge.textContent = onGame ? 'משחק GTA 6 עכשיו' : 'בלייב עכשיו';
    badge.title = s?.title ?? '';
    badge.dataset.viewers = fresh && s?.viewers ? `${s.viewers.toLocaleString('he-IL')} צופים` : '';
    stage.classList.toggle('is-onair', isLive);

  }
  // התג נעלם לבד אם הבדיקות נעצרו
  window.setInterval(render, 30_000);

  return {
    setData(d: Data) {
      data = d;
      render();
    },
    setLive(l: LiveData) {
      live = l;
      render();
    },
    get: () => live,
    /** בזמן הלייב: האם לפתוח את הנגן בפאנל של העצירה הנוכחית */
    isLive: () => !!live && !!data && (statusFresh(live.status) ? !!live.status?.is_live : data.settings.is_live),
  };
}

export type Live = ReturnType<typeof createLive>;

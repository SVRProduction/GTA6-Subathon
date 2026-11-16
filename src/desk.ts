// "שולחן השדרן": שורת עכשיו, עמודת לייב, פיד פעילות חי, "מה פספסתי", ולשוניות בטלפון.
// המפה עצמה (main.ts) לא משתנה – היא רק יושבת בעמודה, והפאנל של העצירה עובר לעמודת הצד.
import { clipCard, clipStop, playClip } from './clips';
import { countOf, currentIndex, kickSlug, playMs, statusFresh, type Clip, type Comment, type Data, type LiveData, type Store } from './data/types';
import { fill, h } from './dom';
import { fmtPlay } from './live';

export type DeskMode = 'wide' | 'mid' | 'phone';
type Kind = 'stop' | 'ms' | 'death' | 'cat' | 'clip' | 'comment';
interface Ev {
  key: string;
  t: number;
  kind: Kind;
  title: string;
  sub?: string;
  stop?: number;
  clip?: Clip;
}

const KINDS: Record<Kind, { label: string; mark: string }> = {
  ms: { label: 'מיילסטון', mark: '★' },
  stop: { label: 'עצירה', mark: '●' },
  death: { label: 'מוות', mark: '💀' },
  cat: { label: 'חתול', mark: '🐈' },
  clip: { label: 'קליפ', mark: '▶' },
  comment: { label: 'תגובה', mark: '💬' },
};
const FILTERS: Array<[string, string, Kind[] | null]> = [
  ['all', 'הכול', null],
  ['stops', 'עצירות', ['stop', 'ms']],
  ['deaths', 'מוות וחתולים', ['death', 'cat']],
  ['clips', 'קליפים', ['clip']],
  ['comments', 'תגובות', ['comment']],
];
const LAST_KEY = 'desk-last-visit';
const num = (n: number) => n.toLocaleString('he-IL');
const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const hm = (t: number) => new Date(t).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
const ago = (ms: number) => {
  const m = Math.round(ms / 60_000);
  if (m < 1) return 'עכשיו';
  if (m < 60) return `לפני ${m} דק'`;
  if (m < 1440) return `לפני ${Math.round(m / 60)} שעות`;
  return `לפני ${Math.round(m / 1440)} ימים`;
};
function dayLabel(t: number) {
  const d = new Date(t);
  const today = new Date();
  const y = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'היום';
  if (d.toDateString() === y.toDateString()) return 'אתמול';
  return d.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric' });
}

export function createDesk(opts: {
  store: Store;
  stage: HTMLElement;
  panel: HTMLElement;
  goToStop: (i: number) => void;
  openStop: (i: number) => void;
  onLayout: () => void;
}) {
  const q = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
  const cols = q('[data-cols]');
  const side = q('[data-col="feed"]');
  const liveCol = q('[data-live-col]');
  const sideStop = q('[data-side-pane="stop"]');
  const feedPane = q('[data-side-pane="feed"]');
  const feedList = q('[data-feed]');
  const chipsEl = q('[data-chips]');
  const missedEl = q('[data-missed]');
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-side-tab]')];
  let data: Data | null = null;
  let live: LiveData | null = null;
  let comments: Comment[] = [];
  let filter = 'all';
  let seen = new Set<string>();
  let firstRender = true;
  let missedDone = false;
  let unread = 0;
  let mode: DeskMode = 'wide';
  let phoneTab: 'map' | 'live' | 'feed' = 'map';
  const loadedAt = Date.now();

  // ── מבנה לפי רוחב: 3 עמודות / 2 עמודות (הלייב כלשונית בצד) / טלפון עם לשוניות ──
  const liveTab = h('button', { type: 'button', role: 'tab', ariaSelected: 'false', className: 'side-tab--live' }, 'לייב');
  liveTab.dataset.sideTab = 'live';
  tabs[0].parentElement!.prepend(liveTab);
  tabs.unshift(liveTab);
  function place() {
    const w = innerWidth;
    const next: DeskMode = w >= 1280 ? 'wide' : w >= 900 ? 'mid' : 'phone';
    // הפאנל של העצירה: בעמודת הצד (מחשב) או כגיליון מעל המפה (טלפון)
    if (next === 'phone') {
      if (opts.panel.parentElement !== opts.stage) opts.stage.append(opts.panel);
    } else if (opts.panel.parentElement !== sideStop) sideStop.append(opts.panel);
    // עמודת הלייב: עמודה שלישית (רחב) או לשונית בעמודת הצד (בינוני)
    if (next === 'mid') {
      if (liveCol.parentElement !== side) side.append(liveCol);
    } else if (liveCol.parentElement !== cols) cols.append(liveCol);
    if (next !== mode) {
      mode = next;
      document.body.dataset.mode = mode;
      if (mode !== 'mid' && current() === 'live') showSide('feed');
      if (mode === 'mid' && current() === 'live') liveCol.hidden = false;
      setPhoneTab(phoneTab);
    }
    opts.onLayout();
  }
  const current = () => tabs.find((t) => t.getAttribute('aria-selected') === 'true')?.dataset.sideTab ?? 'feed';
  function showSide(which: string) {
    tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.sideTab === which)));
    feedPane.hidden = which !== 'feed';
    sideStop.hidden = which !== 'stop';
    if (mode === 'mid') liveCol.hidden = which !== 'live';
    if (which === 'feed') {
      unread = 0;
      badge();
    }
  }
  tabs.forEach((t) => (t.onclick = () => showSide(t.dataset.sideTab!)));

  // ── טלפון: לשוניות בתחתית ──
  const tabBtns = [...document.querySelectorAll<HTMLButtonElement>('[data-tab]')];
  function setPhoneTab(t: typeof phoneTab) {
    phoneTab = t;
    document.body.dataset.tab = t;
    tabBtns.forEach((b) => (b.dataset.tab === t ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
    if (t === 'feed') {
      showSide(current() === 'stop' ? 'stop' : 'feed');
      unread = 0;
      badge();
    }
    requestAnimationFrame(opts.onLayout);
  }
  tabBtns.forEach((b) => (b.onclick = () => setPhoneTab(b.dataset.tab as typeof phoneTab)));
  function badge() {
    const el = q('[data-tab-badge]');
    el.hidden = unread <= 0;
    el.textContent = unread > 9 ? '9+' : String(unread);
  }

  // ── שורת "עכשיו" ──
  function nowbar() {
    if (!data) return;
    const s = live?.status ?? null;
    const fresh = statusFresh(s);
    const isLive = fresh ? !!s?.is_live : data.settings.is_live;
    const onGame = fresh ? !!s?.on_category : data.settings.is_live;
    document.body.classList.toggle('is-live', isLive);
    q('[data-desk-title]').textContent = data.settings.title || 'סאבתון GTA 6';
    q('[data-live-state]').textContent = isLive ? (onGame ? 'בשידור · GTA 6' : 'בשידור · לא על GTA') : 'לא בשידור';
    const i = currentIndex(data);
    const m = data.missions[i];
    const mission = q('[data-now-mission]');
    fill(
      mission,
      m
        ? h(
            'button',
            { type: 'button', className: 'nowbar__go', onclick: () => opts.openStop(i), title: 'לעצירה הנוכחית במפה' },
            h('span', { className: 'nowbar__k' }, 'עכשיו'),
            h('span', { className: `nowbar__no ${m.is_milestone ? 'is-ms' : ''}` }, String(i + 1)),
            h('span', { className: 'nowbar__title' }, m.title || 'משימה'),
          )
        : null,
    );
    const segs = live?.segments ?? [];
    const lastSeg = segs[segs.length - 1];
    const sessionMs = onGame && lastSeg ? Date.now() - Date.parse(lastSeg.started_at) : 0;
    const cell = (k: string, v: string, cls = '') => h('div', { className: cls }, h('dt', {}, k), h('dd', {}, v));
    fill(
      q('[data-now-nums]'),
      onGame ? cell('בשידור', clock(sessionMs), 'is-session') : cell('לייב אחרון', lastSeg ? ago(Date.now() - Date.parse(lastSeg.ended_at)) : '–'),
      fresh && s?.viewers ? cell('צופים', num(s.viewers)) : null,
      live ? cell('שעות משחק', fmtPlay(playMs(live))) : null,
      live ? cell('💀', num(countOf(live, 'deaths')), 'is-deaths') : null,
      live ? cell('🐈', num(countOf(live, 'cats'))) : null,
    );
    q('[data-tab-dot]').classList.toggle('is-on', isLive);
  }
  // השעון של השידור מתקתק כל שנייה, בלי לבנות מחדש
  setInterval(() => {
    const dd = document.querySelector('.is-session dd');
    const segs = live?.segments ?? [];
    const lastSeg = segs[segs.length - 1];
    if (dd && lastSeg) dd.textContent = clock(Date.now() - Date.parse(lastSeg.started_at));
  }, 1000);

  // ── עמודת הלייב: הנגן של Kick כשבאוויר, אחרת הקליפים האחרונים ──
  let liveKey = '';
  let stopPlaying: (() => void) | null = null;
  function liveColumn() {
    if (!data) return;
    const ch = kickSlug(data.settings.kick_channel);
    const s = live?.status ?? null;
    const isLive = statusFresh(s) ? !!s?.is_live : data.settings.is_live;
    const clips = [...(live?.clips ?? [])].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    const key = `${isLive}|${ch}|${clips.slice(0, 5).map((c) => c.id).join()}`;
    if (key === liveKey) return; // לא בונים מחדש את הנגן בכל עדכון
    if (liveCol.querySelector('.is-playing') && !isLive) return;
    liveKey = key;
    stopPlaying?.();
    stopPlaying = null;
    // בדמו הסטטוס 'בשידור' מדומה – לא מציגים נגן של ערוץ שבפועל כבוי
    if (isLive && opts.store.mode !== 'demo') {
      fill(
        liveCol,
        h('p', { className: 'col-head' }, h('span', { className: 'onair-dot is-on' }), 'בשידור עכשיו'),
        h('div', { className: 'player-frame' }, h('iframe', { src: `https://player.kick.com/${ch}?muted=true&autoplay=true`, title: 'הלייב ב-Kick', allow: 'autoplay; fullscreen; picture-in-picture', allowFullscreen: true })),
        h('p', { className: 'live-title' }, s?.title ?? ''),
        h(
          'div',
          { className: 'live-links' },
          h('a', { className: 'btn btn--small', href: `https://kick.com/${ch}`, target: '_blank', rel: 'noopener' }, 'פתיחה ב-Kick'),
          h('a', { className: 'btn btn--small btn--quiet', href: `https://kick.com/popout/${ch}/chat`, target: '_blank', rel: 'noopener' }, 'הצ׳אט'),
        ),
        recentClips(clips.slice(0, 4)),
      );
      return;
    }
    const top = clips[0];
    const big = h('div', { className: 'live-big' });
    const show = (c: Clip) => {
      stopPlaying?.();
      big.replaceChildren(
        clipCard(c, {
          stop: (() => {
            const i = data ? clipStop(c, data.missions) : -1;
            return i >= 0 ? `עצירה ${i + 1}` : '';
          })(),
          onPlay: (cl, el) => {
            stopPlaying?.();
            el.classList.add('is-playing');
            stopPlaying = playClip(el, cl);
          },
        }),
      );
    };
    if (top) show(top);
    fill(
      liveCol,
      isLive
        ? h('div', { className: 'demo-note' }, h('p', { className: 'col-head' }, h('span', { className: 'onair-dot is-on' }), 'בשידור (תצוגה מקדימה)'), h('p', { className: 'muted' }, 'כשהאתר מחובר לשרת והערוץ בשידור, הנגן של Kick מופיע כאן. בינתיים: הקליפים האחרונים.'))
        : h('p', { className: 'col-head' }, h('span', { className: 'onair-dot' }), 'הלייב כבוי כרגע'),
      top ? big : h('p', { className: 'muted' }, 'עוד אין קליפים. כשיהיו, הקליף האחרון יופיע כאן.'),
      recentClips(clips.slice(1, 6), show),
      h('a', { className: 'btn btn--small', href: `https://kick.com/${ch}`, target: '_blank', rel: 'noopener' }, `לערוץ ב-Kick`),
    );
  }
  function recentClips(list: Clip[], onPick?: (c: Clip) => void) {
    if (!list.length) return null;
    return h(
      'div',
      { className: 'mini-clips' },
      h('p', { className: 'col-sub' }, 'קליפים אחרונים'),
      h(
        'ol',
        {},
        ...list.map((c) =>
          h(
            'li',
            {},
            h(
              'button',
              {
                type: 'button',
                className: 'mini-clip',
                onclick: () => (onPick ? onPick(c) : window.open(`https://kick.com/${kickSlug(data!.settings.kick_channel)}/clips/${c.id}`, '_blank', 'noopener')),
              },
              c.thumbnail_url ? h('img', { src: c.thumbnail_url, alt: '', loading: 'lazy' }) : h('span', { className: 'mini-clip__ph' }),
              h('span', { className: 'mini-clip__t' }, h('strong', {}, c.title || 'קליפ'), h('small', {}, `${ago(Date.now() - Date.parse(c.created_at))} · ${num(c.views)} צפיות`)),
            ),
          ),
        ),
      ),
    );
  }

  // ── פיד הפעילות ──
  function events(): Ev[] {
    if (!data) return [];
    const d = data;
    const out: Ev[] = [];
    const idx = new Map(d.missions.map((m, i) => [m.id, i]));
    const stopName = (id: string | null) => {
      const i = id ? idx.get(id) : undefined;
      return i == null ? '' : `במשימה ${i + 1}: ${d.missions[i].title}`;
    };
    d.missions.forEach((m, i) => {
      if (!m.happened_at) return;
      out.push({ key: `s:${m.id}`, t: Date.parse(m.happened_at), kind: m.is_milestone ? 'ms' : 'stop', title: `${i + 1}. ${m.title || 'עצירה'}`, sub: m.summary || m.chapter || '', stop: i });
    });
    (live?.recent ?? []).forEach((e, k) => {
      if (e.delta < 0) return; // ביטולים לא נכנסים לפיד
      const i = e.mission_id ? idx.get(e.mission_id) : undefined;
      out.push({ key: `c:${e.counter}:${e.created_at}:${e.mission_id}:${k - (live?.recent ?? []).findIndex((x) => x.created_at === e.created_at && x.counter === e.counter)}`, t: Date.parse(e.created_at), kind: e.counter === 'deaths' ? 'death' : 'cat', title: e.counter === 'deaths' ? 'מת' : 'דרס חתול', sub: stopName(e.mission_id), stop: i });
    });
    if (!live?.demoClips)
      (live?.clips ?? []).forEach((c) => {
        const i = clipStop(c, d.missions);
        out.push({ key: `k:${c.id}`, t: Date.parse(c.created_at), kind: 'clip', title: c.title || 'קליפ חדש', sub: c.creator ? `קליפ של ${c.creator}` : 'קליפ חדש', stop: i >= 0 ? i : undefined, clip: c });
      });
    comments.forEach((c) => {
      const i = c.target_type === 'stop' ? idx.get(c.target_id) : undefined;
      out.push({ key: `m:${c.id}`, t: Date.parse(c.created_at), kind: 'comment', title: c.username, sub: c.body, stop: i });
    });
    return out.filter((e) => Number.isFinite(e.t)).sort((a, b) => b.t - a.t).slice(0, 120);
  }

  function feed() {
    const all = events();
    const f = FILTERS.find((x) => x[0] === filter)?.[2];
    const list = f ? all.filter((e) => f.includes(e.kind)) : all;
    // פריטים חדשים (שלא היו בציור הקודם) מקבלים הבהוב קצר
    // חדש = לא היה בציור הקודם וגם קרה אחרי שהדף נפתח (טעינה מאוחרת של תגובות/קליפים לא נחשבת חדשה)
    const fresh = new Set(firstRender ? [] : all.filter((e) => !seen.has(e.key) && e.t > loadedAt - 60_000).map((e) => e.key));
    if (!firstRender && fresh.size) {
      const visible = mode === 'phone' ? phoneTab === 'feed' : current() === 'feed';
      if (!visible) {
        unread += fresh.size;
        badge();
      }
    }
    seen = new Set(all.map((e) => e.key));
    const rows: HTMLElement[] = [];
    let day = '';
    for (const e of list) {
      const dl = dayLabel(e.t);
      if (dl !== day) {
        day = dl;
        rows.push(h('li', { className: 'feed__day', ariaHidden: 'true' }, dl));
      }
      const go = e.stop != null ? () => (e.kind === 'stop' || e.kind === 'ms' || e.kind === 'comment' ? opts.openStop(e.stop!) : opts.goToStop(e.stop!)) : undefined;
      const body = h(
        go ? 'button' : 'div',
        { className: 'ev__body', ...(go ? { type: 'button', onclick: go } : {}) } as never,
        h('span', { className: 'ev__top' }, h('span', { className: 'ev__kind' }, KINDS[e.kind].label), h('time', { dateTime: new Date(e.t).toISOString(), title: new Date(e.t).toLocaleString('he-IL') }, hm(e.t))),
        h('strong', { className: 'ev__title' }, e.title),
        e.sub ? h('span', { className: 'ev__sub' }, e.sub) : null,
      );
      rows.push(h('li', { className: `ev ev--${e.kind} ${fresh.has(e.key) ? 'is-new' : ''}` }, h('span', { className: 'ev__mark', ariaHidden: 'true' }, KINDS[e.kind].mark), body));
    }
    if (!rows.length) rows.push(h('li', { className: 'feed__empty' }, 'אין עדיין פעילות מהסוג הזה.'));
    feedList.replaceChildren(...rows);
    // "מה פספסתי" – פעם אחת, אחרי שגם העצירות וגם נתוני הלייב נטענו
    if (!missedDone && data && live) {
      missedDone = true;
      missed(all);
    }
    firstRender = false;
  }
  function chips() {
    fill(
      chipsEl,
      ...FILTERS.map(([key, label]) => {
        const b = h('button', { type: 'button', className: 'chip', ariaPressed: String(filter === key) }, label);
        b.onclick = () => {
          filter = key;
          chips();
          feed();
        };
        return b;
      }),
    );
  }

  // ── "מה פספסתי": מה קרה מאז הביקור הקודם ──
  function missed(all: Ev[]) {
    let last = 0;
    try {
      last = Number(localStorage.getItem(LAST_KEY) || 0);
    } catch {
      /* חסום */
    }
    const markSeen = () => {
      try {
        localStorage.setItem(LAST_KEY, String(Date.now()));
      } catch {
        /* חסום */
      }
    };
    addEventListener('pagehide', markSeen);
    if (!last || Date.now() - last < 10 * 60_000) {
      markSeen();
      return;
    }
    const since = all.filter((e) => e.t > last);
    if (!since.length) return;
    const c = (k: Kind[]) => since.filter((e) => k.includes(e.kind)).length;
    const parts = [
      [c(['stop', 'ms']), 'עצירות חדשות'],
      [c(['ms']), 'מתוכן מיילסטונים'],
      [c(['death']), 'מיתות'],
      [c(['cat']), 'חתולים'],
      [c(['clip']), 'קליפים'],
      [c(['comment']), 'תגובות'],
    ].filter(([n]) => (n as number) > 0) as Array<[number, string]>;
    const firstStop = since.filter((e) => e.kind === 'stop' || e.kind === 'ms').pop();
    missedEl.hidden = false;
    fill(
      missedEl,
      h('p', { className: 'missed__head' }, h('strong', {}, 'מה פספסת'), h('span', {}, `מאז הביקור הקודם, ${ago(Date.now() - last)}`)),
      h('ul', { className: 'missed__nums' }, ...parts.map(([n, l]) => h('li', {}, h('b', {}, num(n)), h('span', {}, l)))),
      h(
        'div',
        { className: 'missed__actions' },
        firstStop?.stop != null ? h('button', { type: 'button', className: 'btn btn--small btn--primary', onclick: () => opts.openStop(firstStop.stop!) }, 'להתחיל מאיפה שהפסקתי') : null,
        h('button', { type: 'button', className: 'btn btn--small btn--quiet', onclick: () => { missedEl.hidden = true; markSeen(); } }, 'הבנתי'),
      ),
    );
  }

  chips();
  place();
  addEventListener('resize', place);
  setPhoneTab('map');

  const all = () => {
    nowbar();
    liveColumn();
    feed();
  };
  return {
    setData(d: Data) {
      data = d;
      all();
    },
    setLive(l: LiveData) {
      live = l;
      all();
    },
    setComments(c: Comment[]) {
      comments = c;
      feed();
    },
    /** העצירה שבפאנל השתנתה (גם אוטומטית בגלילה): מספר העצירה על לשונית הפרטים */
    stopChanged(n: number | null) {
      const t = tabs.find((x) => x.dataset.sideTab === 'stop');
      if (t) t.textContent = n == null ? 'פרטים' : `פרטים · ${n}`;
    },
    /** לחיצה על סיכה / "כל העצירות" / "קליפים": מציגים את לשונית הפרטים */
    showDetails() {
      if (mode !== 'phone') showSide('stop');
      else if (phoneTab !== 'map') setPhoneTab('map');
    },
    showFeed() {
      if (mode !== 'phone') showSide('feed');
    },
    mode: () => mode,
    store: opts.store,
  };
}

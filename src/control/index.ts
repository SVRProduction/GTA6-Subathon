// "Mission Control": כל מה שמעל המפה בגרסה 6 – סרגל שפותח חלונות קופצים (סטטיסטיקות, פיד, קליפים, עצירות, שכבות),
// מרקרים חופשיים, הטלפון הנשלף עם הסטוריז, סקרים, ולמודים – מצב עריכה ומדריך.
import { clipsView } from '../clips';
import { commentCount, commentsBox } from '../comments';
import { currentIndex, kickSlug, MARKER_TYPES, pollOpen, type Clip, type Comment, type Data, type Extras, type LiveData, type Marker, type MarkerType, type Mission, type Poll, type Store } from '../data/types';
import { fill, h, safeUrl } from '../dom';
import type { World } from '../journey/world';
import { kindLabel, metaText } from '../journey/content';
import { getViewer, onViewer } from '../auth';
import { onModChange } from '../data/modSession';
import { createEditor } from './edit';
import { ago, feedEvents, feedView, missedSummary, type FeedEv } from './feed';
import { guideSeen, openGuide } from './guide';
import { markerIcon, svg } from './icons';
import { createMarkerLayer } from './markers';
import { createPhone } from './phone';
import { countdown, pollCard, pollForm } from './polls';
import { closePopup, openPopup, popupKey, refreshPopup } from './popup';
import { statsView } from './stats';
import { createStoryViewer, type StoryItem } from './stories';

type PopKey = 'stats' | 'feed' | 'clips' | 'stops' | 'layers' | 'poll' | 'newpoll';
const MOD_KEY = 'mc-mod';

export function createControl(o: {
  store: Store;
  stage: HTMLElement;
  world: World;
  toast: (t: string) => void;
  data: () => Data | null;
  live: () => LiveData | null;
  goStop: (i: number) => void;
  openStop: (i: number) => void;
  /** מיקום העצירה במפה (פיקסלים של התמונה) */
  stopPoint: (i: number) => { x: number; y: number } | null;
  /** טיסה לנקודה במפה (0–1) – למרקרים ולסקר */
  flyTo: (x: number, y: number) => void;
  mapImage: HTMLImageElement;
  clipComments: (c: Clip) => HTMLElement;
}) {
  const { store, stage, toast } = o;
  let ex: Extras | null = null;
  let comments: Comment[] = [];
  let feedFilter = 'all';
  let seenFeed = new Set<string>();
  let feedReady = false;
  let unread = 0;
  let mod = false;

  // ── מוד? מי שהתחבר עם Kick ונמצא ברשימת המודים (או בעלים). בדמו גם ‎?mod ──
  const qs = new URLSearchParams(location.search);
  try {
    if (qs.get('mod') === '0') localStorage.removeItem(MOD_KEY);
    else if (qs.has('mod')) localStorage.setItem(MOD_KEY, '1');
  } catch {
    /* חסום */
  }
  const demoMod = () => {
    if (store.mode === 'supabase') return false;
    try {
      return !!localStorage.getItem(MOD_KEY);
    } catch {
      return false;
    }
  };
  const isModNow = async () => demoMod() || (await store.isAuthed());
  let unsubExtras: (() => void) | null = null;
  function applyMod(v: boolean, first = false) {
    if (!first && v === mod) return;
    mod = v;
    document.body.classList.toggle('is-mod', v);
    if (!v && editor.isOn()) editor.setOn(false);
    renderToolbar();
    if (v && !guideSeen()) setTimeout(() => !popupKey() && openGuide(), 1400);
    // מוד רואה גם פריטים מוסתרים – טוענים ונרשמים מחדש לפי ההרשאה
    unsubExtras?.();
    store.loadExtras(v).then(setExtras).catch(console.error);
    unsubExtras = store.subscribeExtras(setExtras, v);
  }
  // אחרי התחברות Kick: בודקים בשקט אם זה מוד. "לא ברשימה" נזכר ל-5 דקות בלבד,
  // כך שמוד שהבעלים הוסיף עכשיו מקבל את הכלים ברענון של כמה דקות (או מיד אחרי התחברות מחדש)
  const NOT_MOD = 'kick-not-mod';
  async function tryModLogin(fresh = false) {
    const v = getViewer();
    if (!v || (await store.isAuthed())) return;
    try {
      const [uid, t] = (sessionStorage.getItem(NOT_MOD) ?? '').split('|');
      if (!fresh && uid === v.kick_user_id && Date.now() - Number(t) < 5 * 60_000) return;
    } catch {
      /* חסום */
    }
    try {
      await store.modLogin(v);
    } catch (e) {
      if ((e as { status?: number }).status !== 403) return;
      try {
        sessionStorage.setItem(NOT_MOD, `${v.kick_user_id}|${Date.now()}`);
      } catch {
        /* חסום */
      }
    }
  }
  const modReady = tryModLogin()
    .then(isModNow)
    .then((v) => {
      applyMod(v, true);
      return v;
    });
  onModChange(() => modReady.then(() => isModNow().then((v) => applyMod(v))));
  onViewer((v) => {
    if (v) tryModLogin(true);
  });

  // ── שכבת המרקרים ──
  const layer = createMarkerLayer({ stage, world: o.world, onOpen: (m) => (editor.isOn() ? editor.markerForm(m) : openMarker(m)), onPoll: () => openPoll() });

  // ── עורך (למודים) ──
  const editor = createEditor({
    stage,
    world: o.world,
    store,
    layer,
    toast,
    data: o.data,
    onStopSaved: () => {
      const d = o.data();
      if (d) setTimeout(() => o.goStop(currentIndex(d)), 400);
    },
  });
  editor.onChange(() => renderToolbar());

  // ── סטוריז + הטלפון ──
  const viewer = createStoryViewer({ store, toast, stopBg: (i) => crop(i, 900, 1600, 0.16), goStop: (i) => o.openStop(i) });
  const phone = createPhone({
    stage,
    store,
    toast,
    openStories: (list, i) => viewer.open(list, i, () => phone.isOpen() && phone.setExtras(ex!)),
    openStop: o.openStop,
    openTarget: (c) => openTarget(c),
    locatePoll: () => {
      const p = activePoll();
      if (p?.x != null) o.flyTo(p.x, p.y!);
    },
  });

  /** רקע לסטורי רשמי: התמונה של העצירה, או חיתוך של המפה סביב המקום עם סימון */
  function crop(i: number, w: number, hgt: number, span: number): HTMLElement | null {
    const d = o.data();
    const m = d?.missions[i];
    const img = safeUrl(m?.image_url);
    if (img) return h('img', { class: 'st-img', src: img, alt: m?.title ?? '' });
    const p = o.stopPoint(i);
    const im = o.mapImage;
    if (!p || !im.complete || !im.naturalWidth) return null;
    const { w: W, h: H } = o.world.size();
    const k = im.naturalWidth / W;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = hgt;
    const g = c.getContext('2d')!;
    const sw = Math.min(W, H) * span * k;
    const sh = (sw * hgt) / w;
    g.fillStyle = '#0b2f4a';
    g.fillRect(0, 0, w, hgt);
    g.drawImage(im, p.x * k - sw / 2, p.y * k - sh / 2, sw, sh, 0, 0, w, hgt);
    c.className = 'st-img';
    c.setAttribute('role', 'img');
    c.setAttribute('aria-label', `המקום של ${m?.title ?? 'העצירה'} על המפה`);
    const wrap = h('div', { class: 'st-crop' }, c, h('span', { class: 'st-pin', ariaHidden: 'true' }));
    return wrap;
  }

  // ── סרגל הכלים ──
  const tb = h('nav', { class: 'tb', ariaLabel: 'המסע' });
  stage.querySelector('.hud')!.append(tb);
  const tbBtn = (key: string, icon: string, label: string, kbd: string, onClick: () => void, extra = '') => {
    const b = h('button', { type: 'button', class: `tb__btn ${extra}`, title: kbd ? `${label} (${kbd})` : label }, svg(icon, 20), h('span', { class: 'tb__label' }, label));
    b.dataset.key = key;
    b.onclick = onClick;
    return b;
  };
  function renderToolbar() {
    const on = popupKey();
    const items = [
      tbBtn('stats', 'stats', 'סטטיסטיקות', 'S', () => toggle('stats')),
      tbBtn('feed', 'feed', 'פיד חי', 'F', () => toggle('feed')),
      h('span', { class: 'tb__gap', ariaHidden: 'true' }),
      tbBtn('clips', 'clips', 'קליפים', 'C', () => toggle('clips')),
      tbBtn('stops', 'stops', 'עצירות', 'L', () => toggle('stops')),
      tbBtn('layers', 'layers', 'שכבות', '', () => toggle('layers'), 'tb__btn--more'),
    ];
    if (mod)
      items.push(
        h('span', { class: 'tb__sep', ariaHidden: 'true' }),
        tbBtn('edit', 'edit', editor.isOn() ? 'סיום עריכה' : 'עריכה', 'E', () => editor.toggle(), `tb__btn--mod ${editor.isOn() ? 'is-on' : ''}`),
        tbBtn('newpoll', 'poll', 'סקר', 'P', () => toggle('newpoll'), 'tb__btn--mod'),
        tbBtn('guide', 'help', 'מדריך', '?', () => openGuide(), 'tb__btn--mod tb__btn--icon'),
      );
    fill(tb, ...items);
    tb.querySelectorAll<HTMLElement>('.tb__btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.key === on || (b.dataset.key === 'edit' && editor.isOn()))));
    const f = tb.querySelector<HTMLElement>('[data-key="feed"]');
    if (f && unread > 0) f.append(h('span', { class: 'tb__dot' }, unread > 9 ? '9+' : String(unread)));
  }

  function toggle(k: PopKey) {
    if (popupKey() === k) return closePopup();
    open(k);
  }
  function open(k: PopKey) {
    const d = o.data();
    if (!d) return;
    if (k === 'stats') openPopup({ key: k, kicker: 'המספרים', title: `${d.settings.title || 'סאבתון GTA 6'} במספרים`, body: statsBody(), size: 'l', hash: '#stats', onClose: renderToolbar });
    else if (k === 'feed') {
      unread = 0;
      openPopup({ key: k, kicker: 'בזמן אמת', title: 'פיד חי', body: feedBody(), size: 'm', hash: '#feed', onClose: renderToolbar });
    } else if (k === 'clips') openPopup({ key: k, kicker: 'מהלייב', title: 'קליפים', body: clipsBody(), size: 'l', hash: '#clips', onClose: renderToolbar });
    else if (k === 'stops') openPopup({ key: k, kicker: `${d.missions.length} עצירות עד עכשיו`, title: 'כל העצירות', body: stopsBody(), size: 'm', hash: '#stops', onClose: renderToolbar });
    else if (k === 'layers') openPopup({ key: k, kicker: 'מה רואים על המפה', title: 'שכבות ומקרא', body: layersBody(), size: 's', hash: '#layers', onClose: renderToolbar });
    else if (k === 'poll') openPoll();
    else if (k === 'newpoll' && mod) {
      // אותו טופס נשאר בזמן בחירת מיקום על המפה, כך שהשאלה והאפשרויות לא נמחקות
      pollDraftEl ??= pollForm({
        onSubmit: async (dr) => {
          try {
            await store.createPoll(dr);
            pollDraftEl = null;
            closePopup();
            toast('הסקר נפתח. הוא כבר מופיע באוברליי ובטלפון.');
          } catch (e) {
            toast((e as Error).message);
          }
        },
        pickPoint: (cb) => {
          const wasOn = editor.isOn();
          closePopup();
          editor.pickPoint((p) => {
            cb(p);
            if (!wasOn) editor.setOn(false);
            open('newpoll');
          });
        },
      });
      openPopup({ key: k, kicker: 'למודים', title: 'סקר חדש לצ׳אט', size: 's', onClose: renderToolbar, body: pollDraftEl });
    }
    renderToolbar();
  }
  let pollDraftEl: HTMLFormElement | null = null;

  // ── תוכן החלונות ──
  const statsBody = () => statsView(o.data()!, o.live(), ex, { openStop: (i) => (closePopup(), o.openStop(i)), openMarker: () => open('layers') });

  function feedBody(): Node[] {
    const d = o.data()!;
    const all = feedEvents(d, o.live(), comments, ex);
    const nodes: Node[] = [];
    const missed = missedBox(all);
    if (missed) nodes.push(missed);
    nodes.push(...feedView(all, { filter: feedFilter, onFilter: (f) => ((feedFilter = f), refreshPopup('feed', feedBody())), open: openEvent, fresh: freshKeys }));
    return nodes;
  }
  let freshKeys = new Set<string>();
  let missedShown: HTMLElement | null | undefined;
  function missedBox(all: FeedEv[]) {
    if (missedShown !== undefined) return missedShown;
    const s = missedSummary(all);
    if (!s) return (missedShown = null);
    const ok = h('button', { type: 'button', class: 'btn btn--small btn--quiet' }, 'הבנתי');
    const box = h(
      'section',
      { class: 'missed' },
      h('p', { class: 'missed__head' }, h('strong', {}, 'מה פספסת'), h('span', {}, `מאז הביקור הקודם, ${ago(Date.now() - s.since)}`)),
      h('ul', { class: 'missed__nums' }, ...s.parts.map(([n, l]) => h('li', {}, h('b', {}, n.toLocaleString('he-IL')), h('span', {}, l)))),
      h('div', { class: 'missed__actions' }, s.firstStop != null ? (() => {
        const b = h('button', { type: 'button', class: 'btn btn--small btn--primary' }, 'להתחיל מאיפה שהפסקתי');
        b.onclick = () => (closePopup(), o.openStop(s.firstStop!));
        return b;
      })() : null, ok),
    );
    ok.onclick = () => {
      s.markSeen();
      box.dataset.dismissed = '1';
      box.remove();
      missedShown = null;
    };
    return (missedShown = box);
  }
  function openEvent(e: FeedEv) {
    if (e.marker) return openMarker(e.marker);
    if (e.story) {
      const list = phone.storyItems();
      const i = list.findIndex((x) => x.kind === 'viewer' && x.s.id === e.story!.id);
      closePopup();
      return viewer.open(list, Math.max(0, i));
    }
    if (e.poll) return openPoll(e.poll);
    if (e.stop != null) {
      closePopup();
      return e.kind === 'death' || e.kind === 'cat' ? o.goStop(e.stop) : o.openStop(e.stop);
    }
  }

  function clipsBody(): Node[] {
    const d = o.data()!;
    const l = o.live();
    return clipsView(l?.clips ?? [], d, { demo: !!l?.demoClips, channel: kickSlug(d.settings.kick_channel), onStop: (i) => (closePopup(), o.openStop(i)), comments: o.clipComments }).slice(2) as Node[];
  }

  function stopsBody(): Node[] {
    const d = o.data()!;
    const cur = currentIndex(d);
    const search = h('input', { class: 'f-in', type: 'search', placeholder: 'חיפוש עצירה…', ariaLabel: 'חיפוש עצירה' });
    const list = h('ol', { class: 'list' });
    const draw = () => {
      const q = search.value.trim();
      fill(
        list,
        ...d.missions
          .map((m, i) => ({ m, i }))
          .filter(({ m }) => !q || m.title.includes(q) || (m.chapter ?? '').includes(q))
          .reverse()
          .map(({ m, i }) => {
            const b = h('button', { type: 'button', class: `list__row ${m.is_milestone ? 'is-ms' : ''} ${i === cur ? 'is-now' : ''}` }, h('span', { class: 'list__no' }, String(i + 1)), h('span', { class: 'list__name' }, h('strong', {}, m.title), h('span', {}, i === cur ? 'כאן אנחנו עכשיו' : [kindLabel(m), metaText(m)].filter(Boolean).join('  |  '))));
            b.onclick = () => (closePopup(), o.openStop(i));
            return h('li', {}, b);
          }),
      );
    };
    search.oninput = draw;
    draw();
    return [search, list];
  }

  function layersBody(): Node[] {
    const hidden = layer.hidden();
    const row = (key: MarkerType | 'route', label: string, icon: Node, count: number | null) => {
      const cb = h('input', { type: 'checkbox', checked: !hidden.has(key) });
      cb.onchange = () => layer.toggle(key, cb.checked);
      return h('label', { class: 'ly' }, cb, h('span', { class: `ly__ic ${key === 'route' ? 'is-route' : `mk--${key}`}` }, icon), h('span', { class: 'ly__label' }, label), count != null ? h('b', { class: 'ly__n' }, count.toLocaleString('he-IL')) : null);
    };
    const counts = new Map<string, number>();
    (ex?.markers ?? []).forEach((m) => counts.set(m.type, (counts.get(m.type) ?? 0) + 1));
    // בטלפון כפתורי התצוגה של המפה מוסתרים מהמסך, אז הם כאן
    const viewBtn = (sel: string, icon: string, label: string) => {
      const b = h('button', { type: 'button', class: 'btn btn--small' }, svg(icon, 16), label);
      b.onclick = () => {
        closePopup();
        stage.querySelector<HTMLElement>(sel)?.click();
      };
      return b;
    };
    const guideBtn = h('button', { type: 'button', class: 'btn btn--small tb__btn--mod' }, svg('help', 16), 'מדריך למודים');
    guideBtn.onclick = () => openGuide();
    return [
      h('div', { class: 'ly-view' }, viewBtn('[data-explore]', 'explore', 'לטייל חופשי'), viewBtn('[data-cinema]', 'cinema', 'מצב קולנוע'), mod ? guideBtn : null),
      h('p', { class: 'f-hint' }, 'שתי שכבות: המסלול (העצירות, לפי הסדר) ומרקרים חופשיים בכל מקום על המפה.'),
      h('div', { class: 'lys' }, row('route', 'המסלול והעצירות', svg('stops', 16), o.data()?.missions.length ?? 0), ...(Object.keys(MARKER_TYPES) as MarkerType[]).map((t) => row(t, MARKER_TYPES[t].label, markerIcon(t, 16), counts.get(t) ?? 0))),
      h('div', { class: 'keys' }, h('p', { class: 'pop__sub' }, 'מקשים'), h('ul', {}, ...[['↑ ↓', 'עצירה הבאה / הקודמת'], ['S', 'סטטיסטיקות'], ['F', 'פיד חי'], ['C', 'קליפים'], ['T', 'הטלפון'], ['K', 'מצב קולנוע'], ['Esc', 'סגירה']].map(([k, l]) => h('li', {}, h('kbd', {}, k), h('span', {}, l))))),
    ];
  }

  // ── מרקר ──
  function openMarker(m: Marker) {
    const d = o.data();
    const i = m.mission_id && d ? d.missions.findIndex((x) => x.id === m.mission_id) : -1;
    const img = safeUrl(m.image_url);
    const actions = h('div', { class: 'mkp__actions' });
    if (i >= 0) {
      const b = h('button', { type: 'button', class: 'btn btn--small' }, svg('stops', 16), `עצירה ${i + 1}: ${d!.missions[i].title}`);
      b.onclick = () => (closePopup(), o.openStop(i));
      actions.append(b);
    }
    const fly = h('button', { type: 'button', class: 'btn btn--small' }, svg('pin', 16), 'במפה');
    fly.onclick = () => (closePopup(), o.flyTo(m.x, m.y));
    actions.append(fly);
    if (mod) {
      const edit = h('button', { type: 'button', class: 'btn btn--small tb__btn--mod' }, svg('edit', 16), 'עריכה');
      edit.onclick = () => editor.markerForm(m);
      actions.append(edit);
    }
    openPopup({
      key: `marker-${m.id}`,
      kicker: MARKER_TYPES[m.type].label,
      title: m.title || MARKER_TYPES[m.type].label,
      size: 's',
      hash: `#marker-${m.id}`,
      body: [
        h('div', { class: `mkp__hero mk--${m.type}` }, img ? h('img', { src: img, alt: m.title }) : h('span', { class: 'mkp__badge' }, m.type === 'custom' && m.emoji ? h('span', { class: 'mk__emoji' }, m.emoji) : markerIcon(m.type, 40))),
        h('p', { class: 'mkp__meta' }, ago(Date.now() - Date.parse(m.created_at))),
        m.body ? h('p', { class: 'mkp__body' }, m.body) : null,
        actions,
        commentsBox(store, 'marker', m.id, { toast }),
      ].filter(Boolean) as Node[],
    });
  }

  // ── סקר ──
  const activePoll = () => (ex?.polls ?? []).find((p) => pollOpen(p)) ?? null;
  function openPoll(p?: Poll) {
    const poll = p ?? activePoll() ?? (ex?.polls ?? []).slice(-1)[0];
    if (!poll) return toast('אין סקר כרגע');
    openPopup({ key: 'poll', kicker: 'החלטת הצ׳אט', title: poll.question, size: 's', hash: '#poll', onClose: renderToolbar, body: pollBody(poll) });
  }
  function pollBody(poll: Poll): Node[] {
    const fresh = (ex?.polls ?? []).find((x) => x.id === poll.id) ?? poll;
    const nodes: Node[] = [pollCard(fresh, { store, toast, voting: true, onLocate: fresh.x != null ? () => (closePopup(), o.flyTo(fresh.x!, fresh.y!)) : undefined })];
    if (mod && pollOpen(fresh)) {
      const close = h('button', { type: 'button', class: 'btn btn--small tb__btn--mod' }, 'סגירת הסקר עכשיו');
      close.onclick = () => store.closePoll(fresh.id).then(() => toast('הסקר נסגר'), (e) => toast((e as Error).message));
      nodes.push(h('div', { class: 'mkp__actions' }, close));
    }
    return nodes;
  }
  // תג "סקר פתוח" מעל כפתור הטלפון, עם ספירה לאחור
  const chip = h('button', { type: 'button', class: 'poll-chip', hidden: true });
  chip.onclick = () => openPoll();
  stage.append(chip);
  function chipTick() {
    const p = activePoll();
    chip.hidden = !p || viewer.isOpen();
    if (p) {
      const left = Date.parse(p.ends_at) - Date.now();
      const total = p.votes.reduce((a, b) => a + b, 0);
      fill(chip, h('span', { class: 'poll-chip__dot', ariaHidden: 'true' }), h('span', { class: 'poll-chip__k' }, 'סקר פתוח'), h('span', { class: 'poll-chip__q' }, p.question), h('span', { class: 'poll-chip__t' }, `${countdown(left)} · ${total.toLocaleString('he-IL')} קולות`));
      chip.setAttribute('aria-label', `סקר פתוח: ${p.question}. נשארו ${countdown(left)}`);
      // מוד שצופה כשהזמן נגמר: סוגר את הסקר (בשרת זה קורה גם לבד, כל 2 דקות)
      if (left <= 0 && mod) store.closePoll(p.id).catch(() => {});
    }
  }
  setInterval(chipTick, 1000);

  // ── תגובה מהצ'אט של האתר → היעד שלה ──
  function openTarget(c: Comment) {
    const d = o.data();
    if (c.target_type === 'stop' && d) {
      const i = d.missions.findIndex((m) => m.id === c.target_id);
      if (i >= 0) o.openStop(i);
    } else if (c.target_type === 'marker') {
      const m = ex?.markers.find((x) => x.id === c.target_id);
      if (m) openMarker(m);
    } else if (c.target_type === 'story') {
      const list = phone.storyItems();
      const i = list.findIndex((x) => x.kind === 'viewer' && x.s.id === c.target_id);
      if (i >= 0) viewer.open(list, i);
    } else open('clips');
  }

  // ── קיצורי מקלדת ──
  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest('input, textarea, select') || viewer.isOpen()) return;
    const k = e.key.toLowerCase();
    const map: Record<string, () => void> = {
      s: () => toggle('stats'),
      ד: () => toggle('stats'),
      f: () => toggle('feed'),
      כ: () => toggle('feed'),
      c: () => toggle('clips'),
      ב: () => toggle('clips'),
      l: () => toggle('stops'),
      ך: () => toggle('stops'),
      t: () => (phone.isOpen() ? phone.close() : phone.open()),
      א: () => (phone.isOpen() ? phone.close() : phone.open()),
    };
    if (mod) Object.assign(map, { e: () => editor.toggle(), ק: () => editor.toggle(), p: () => toggle('newpoll'), פ: () => toggle('newpoll'), '?': () => openGuide() });
    const f = map[k];
    if (!f) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    f();
  }, true);

  // ── ניתוב לפי הכתובת (‎#stats, #feed, #phone, #story-…, #marker-…) ──
  function route() {
    const hs = location.hash.slice(1);
    if (['stats', 'feed', 'clips', 'stops', 'layers', 'poll'].includes(hs)) open(hs as PopKey);
    else if (hs === 'phone') {
      closePopup();
      phone.open();
    }
    else if (hs === 'guide') modReady.then((v) => v && openGuide());
    else if (hs.startsWith('story-')) {
      const key = hs.slice(6);
      const list = phone.storyItems();
      const i = list.findIndex((x) => x.key === key);
      if (i >= 0) viewer.open(list, i);
    } else if (hs.startsWith('marker-')) {
      const m = ex?.markers.find((x) => x.id === hs.slice(7));
      if (m) openMarker(m);
    }
  }
  let routed = false;
  addEventListener('hashchange', route);

  // ── עדכונים ──
  function refreshOpen() {
    const k = popupKey();
    if (!k) return;
    // לא מרעננים מתחת ליד של מי שמקליד או צופה בקליפ
    const busy = !!document.querySelector('.pop .is-playing, .pop iframe') || [...document.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>('.pop textarea, .pop input')].some((t) => t === document.activeElement || ((t as HTMLTextAreaElement).value && t.type !== 'checkbox' && t.type !== 'search'));
    if (busy) return;
    if (k === 'stats') refreshPopup(k, statsBody());
    else if (k === 'feed') refreshPopup(k, feedBody());
    else if (k === 'poll') {
      const cur = document.querySelector('.pop .pc');
      const p = activePoll() ?? (ex?.polls ?? []).slice(-1)[0];
      if (cur && p) refreshPopup(k, pollBody(p));
    } else if (k === 'layers') refreshPopup(k, layersBody());
  }
  function trackFeed() {
    const d = o.data();
    if (!d || !o.live()) return;
    const all = feedEvents(d, o.live(), comments, ex);
    const keys = new Set(all.map((e) => e.key));
    if (feedReady) {
      freshKeys = new Set(all.filter((e) => !seenFeed.has(e.key) && e.t > Date.now() - 5 * 60_000).map((e) => e.key));
      if (freshKeys.size && popupKey() !== 'feed') unread += freshKeys.size;
    }
    seenFeed = keys;
    feedReady = true;
    renderToolbar();
  }
  function afterAll() {
    if (!routed && o.data() && ex) {
      routed = true;
      route();
    }
  }

  function setExtras(e: Extras) {
    ex = e;
    layer.set(e.markers, activePoll());
    phone.setExtras(e);
    chipTick();
    trackFeed();
    refreshOpen();
    afterAll();
  }

  return {
    setData(d: Data) {
      phone.setData(d);
      trackFeed();
      refreshOpen();
      afterAll();
    },
    setLive() {
      trackFeed();
      refreshOpen();
    },
    setComments(c: Comment[]) {
      comments = c;
      phone.setComments(c);
      trackFeed();
    },
    place: () => layer.place(),
    isMod: () => mod,
    editStop: (m: Mission) => editor.stopForm(m),
    open,
    commentCount,
  };
}
export type Control = ReturnType<typeof createControl>;

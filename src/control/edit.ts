// מצב עריכה למודים, ישר על המפה: מרקרים חופשיים (בוחרים סוג ← לוחצים בכל מקום / לחיצה ארוכה בטלפון),
// גרירה להזזה, עריכה ומחיקה; עצירה חדשה במסלול במקום שלוחצים; בחירת מיקום לסקר.
import { currentIndex, MARKER_TYPES, newMission, type Data, type Marker, type MarkerType, type Mission, type Store } from '../data/types';
import { h } from '../dom';
import type { World } from '../journey/world';
import { markerIcon, svg } from './icons';
import type { MarkerLayer } from './markers';
import { closePopup, openPopup } from './popup';

type Tool = MarkerType | 'stop' | null;
const PALETTE: MarkerType[] = ['death', 'car', 'weapon', 'property', 'heist', 'chase', 'moment', 'custom'];
const EMOJIS = ['🛥️', '🚁', '🏍️', '✈️', '🎯', '🔥', '👑', '🐊', '💎', '🎉', '🍔', '⚡'];

/** מקטין תמונה לפני העלאה (מרקר / עצירה) */
async function shrink(file: File, max = 900): Promise<File> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/jpeg', 0.85));
  return new File([blob], 'marker.jpg', { type: 'image/jpeg' });
}

export function createEditor(opts: {
  stage: HTMLElement;
  world: World;
  store: Store;
  layer: MarkerLayer;
  toast: (t: string) => void;
  data: () => Data | null;
  /** אחרי שמירת עצירה חדשה: מזיזים את המסע אליה */
  onStopSaved: (m: Mission) => void;
  /** אחרי מחיקת עצירה (לסגור את התפריט שלה אם פתוח) */
  onStopDeleted?: (id: string) => void;
}) {
  let on = false;
  let tool: Tool = null;
  let picking: ((p: { x: number; y: number }) => void) | null = null;

  const hint = h('p', { class: 'ed-hint', role: 'status', ariaLive: 'polite' });
  const tray = h('div', { class: 'ed-tray', role: 'toolbar', ariaLabel: 'כלי עריכה', hidden: true });
  opts.stage.append(tray);

  function toolBtn(t: Exclude<Tool, null>) {
    const label = t === 'stop' ? 'עצירה' : MARKER_TYPES[t].label;
    const b = h('button', { type: 'button', class: `ed-tool ${t === 'stop' ? 'is-stop' : `mk--${t}`}`, ariaPressed: 'false', title: t === 'stop' ? 'עצירה חדשה במסלול' : MARKER_TYPES[t].hint }, h('span', { class: 'ed-tool__ic' }, t === 'stop' ? svg('stops', 18) : markerIcon(t, 18)), h('span', { class: 'ed-tool__label' }, label));
    b.dataset.tool = t;
    b.onclick = () => setTool(tool === t ? null : t);
    return b;
  }
  const done = h('button', { type: 'button', class: 'ed-done' }, svg('check', 18), 'סיום');
  done.onclick = () => setOn(false);
  // ✓ סיום משימה: המשימה הנוכחית נגמרה, בלי לעבור לבאה (פטרולים, הסתובבות)
  const finish = h('button', { type: 'button', class: 'ed-done ed-finish', title: 'המשימה הנוכחית הושלמה – עודד מסתובב חופשי עד העצירה הבאה' }, '✓ סיום משימה');
  finish.onclick = async () => {
    const d = opts.data();
    const m = d ? d.missions[currentIndex(d)] : null;
    if (!m) return opts.toast('אין משימה נוכחית');
    if (m.finished_at) return opts.toast('המשימה כבר סומנה כהושלמה');
    try {
      await opts.store.saveMission({ ...m, finished_at: new Date().toISOString() });
      opts.toast(`"${m.title}" הושלמה ✓`);
    } catch (err) {
      opts.toast((err as Error).message);
    }
  };
  tray.append(h('div', { class: 'ed-tools' }, toolBtn('stop'), h('span', { class: 'ed-sep', ariaHidden: 'true' }), ...PALETTE.map(toolBtn)), hint, finish, done);

  function setHint() {
    hint.textContent = picking
      ? 'לחצו על המפה כדי לבחור מיקום לסקר (Esc לביטול)'
      : tool === 'stop'
        ? 'לחצו על המפה במקום שבו קרתה העצירה החדשה'
        : tool
          ? `לחצו בכל מקום על המפה כדי להוסיף "${MARKER_TYPES[tool].label}"`
          : 'בחרו כלי, או גררו מרקר כדי להזיז אותו. בטלפון: לחיצה ארוכה על המפה.';
  }
  function setTool(t: Tool) {
    tool = t;
    tray.querySelectorAll<HTMLElement>('.ed-tool').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
    opts.stage.classList.toggle('is-placing', !!t || !!picking);
    opts.stage.classList.toggle('is-picking', !!picking);
    setHint();
  }
  function setOn(v: boolean) {
    on = v;
    tray.hidden = !v;
    opts.stage.classList.toggle('is-editing', v);
    document.body.classList.toggle('is-editing', v);
    if (!v) {
      picking = null;
      setTool(null);
    } else setHint();
    listeners.forEach((f) => f(v));
  }
  const listeners = new Set<(on: boolean) => void>();

  /** נקודה במסך → מיקום יחסי במפה (0–1) */
  const toMap = (cx: number, cy: number) => {
    const r = opts.stage.getBoundingClientRect();
    const p = opts.world.unproject(cx - r.left, cy - r.top);
    const { w, h: hh } = opts.world.size();
    return { x: +(p.x / w).toFixed(5), y: +(p.y / hh).toFixed(5) };
  };
  const onUi = (t: EventTarget | null) => !!(t as HTMLElement)?.closest?.('button, a, input, textarea, select, .panel, .hud .odo, .ed-tray, .phone, .pop, .tb, .pc, .phone-btn, .poll-chip, .onair, .mh');

  // ── לחיצה על המפה: מוסיפים במקום ──
  let downAt: { x: number; y: number; t: number } | null = null;
  let longTimer = 0;
  opts.stage.addEventListener('pointerdown', (e) => {
    if (!on || onUi(e.target) || (e.target as HTMLElement).closest('.mk, .pin')) return;
    downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
    // טלפון / מגע: לחיצה ארוכה פותחת את בחירת הסוג במקום
    if (e.pointerType !== 'mouse' && !tool && !picking) {
      clearTimeout(longTimer);
      longTimer = window.setTimeout(() => {
        if (!downAt) return;
        navigator.vibrate?.(20);
        const p = toMap(downAt.x, downAt.y);
        downAt = null;
        choose(p);
      }, 520);
    }
  });
  opts.stage.addEventListener('pointermove', (e) => {
    if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 10) {
      downAt = null;
      clearTimeout(longTimer);
    }
  });
  opts.stage.addEventListener('pointerup', (e) => {
    clearTimeout(longTimer);
    if (!on || !downAt) return;
    const d = downAt;
    downAt = null;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8 || performance.now() - d.t > 500) return;
    const p = toMap(e.clientX, e.clientY);
    if (picking) {
      const cb = picking;
      picking = null;
      setTool(tool);
      cb(p);
      return;
    }
    if (tool === 'stop') stopForm(null, p);
    else if (tool) markerForm({ type: tool, ...p });
  });
  // מחשב: קליק ימני במצב עריכה = "מה להוסיף כאן?"
  opts.stage.addEventListener('contextmenu', (e) => {
    if (!on || onUi(e.target)) return;
    e.preventDefault();
    choose(toMap(e.clientX, e.clientY));
  });

  /** בחירת סוג במקום שנלחץ (לחיצה ארוכה / קליק ימני) */
  function choose(p: { x: number; y: number }) {
    const grid = h(
      'div',
      { class: 'ed-grid' },
      ...(['stop', ...PALETTE] as Array<Exclude<Tool, null>>).map((t) => {
        const b = toolBtn(t);
        b.onclick = () => (t === 'stop' ? stopForm(null, p) : markerForm({ type: t, ...p }));
        return b;
      }),
    );
    openPopup({ key: 'ed-choose', kicker: 'מצב עריכה', title: 'מה להוסיף כאן?', body: grid, size: 's' });
  }

  // ── גרירת מרקרים ──
  opts.stage.addEventListener('pointerdown', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.mk');
    if (!on || !el?.dataset.id) return;
    const m = opts.layer.list().find((x) => x.id === el.dataset.id);
    if (!m) return;
    e.stopPropagation();
    const x0 = e.clientX;
    const y0 = e.clientY;
    // תופסים את המגן, אבל המיקום של המרקר הוא העוקץ שמתחתיו: שומרים את ההפרש, כדי שהמרקר לא יקפוץ ויישאר מתחת לאצבע
    const { w: W0, h: H0 } = opts.world.size();
    const r0 = opts.stage.getBoundingClientRect();
    const tip = opts.world.project({ x: m.x * W0, y: m.y * H0 });
    const offX = r0.left + tip.x - x0;
    const offY = r0.top + tip.y - y0;
    const at = (ev: PointerEvent) => toMap(ev.clientX + offX, ev.clientY + offY);
    let moved = false;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
      moved = true;
      el.classList.add('is-drag');
      opts.layer.setDrag(m.id, at(ev));
    };
    const up = async (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.classList.remove('is-drag');
      if (!moved) return;
      el.dataset.dragged = '1';
      const p = at(ev);
      try {
        await opts.store.saveMarker({ ...m, ...p });
        opts.toast('המרקר הוזז');
      } catch (err) {
        opts.toast((err as Error).message);
      }
      opts.layer.setDrag(m.id, null);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }, true);

  // ── טופס מרקר (חדש / עריכה) ──
  function markerForm(init: Partial<Marker> & { type: MarkerType; x: number; y: number }) {
    const d = opts.data();
    const isNew = !init.id;
    let type: MarkerType = init.type;
    let image = init.image_url ?? null;
    let emoji = init.emoji ?? (type === 'custom' ? EMOJIS[0] : null);
    const title = h('input', { class: 'f-in', maxLength: 80, value: init.title ?? '', placeholder: MARKER_TYPES[type].hint });
    const body = h('textarea', { class: 'f-in', rows: 3, maxLength: 600, value: init.body ?? '', placeholder: 'מה קרה כאן? (לא חובה)' });
    const typeRow = h('div', { class: 'ed-types', role: 'radiogroup', ariaLabel: 'סוג' });
    const emojiRow = h('div', { class: 'ed-emojis', role: 'radiogroup', ariaLabel: 'אימוג׳י' });
    const custom = h('input', { class: 'f-in f-in--emoji', maxLength: 4, placeholder: 'אחר', ariaLabel: 'אימוג׳י אחר' });
    const imgBox = h('div', { class: 'ed-img' });
    const syncTypes = () => {
      typeRow.replaceChildren(
        ...(PALETTE.includes(type) || type === 'decision' ? (type === 'decision' ? [...PALETTE, 'decision' as MarkerType] : PALETTE) : PALETTE).map((t) => {
          const b = h('button', { type: 'button', class: `ed-type mk--${t}`, role: 'radio', ariaChecked: String(t === type), title: MARKER_TYPES[t].label }, markerIcon(t, 18), h('span', {}, MARKER_TYPES[t].label));
          b.onclick = () => {
            type = t;
            if (t === 'custom' && !emoji) emoji = EMOJIS[0];
            title.placeholder = MARKER_TYPES[t].hint;
            syncTypes();
          };
          return b;
        }),
      );
      emojiRow.hidden = type !== 'custom';
      emojiRow.replaceChildren(
        ...EMOJIS.map((em) => {
          const b = h('button', { type: 'button', class: 'ed-emoji', role: 'radio', ariaChecked: String(em === emoji) }, em);
          b.onclick = () => ((emoji = em), syncTypes());
          return b;
        }),
        custom,
      );
    };
    custom.oninput = () => custom.value.trim() && (emoji = custom.value.trim());
    const syncImg = () => {
      const file = h('input', { type: 'file', accept: 'image/*', class: 'up__file' });
      file.onchange = async () => {
        const f = file.files?.[0];
        if (!f) return;
        opts.toast('מעלה תמונה…');
        try {
          image = await opts.store.upload(await shrink(f));
          syncImg();
        } catch (err) {
          opts.toast((err as Error).message);
        }
      };
      const rm = h('button', { type: 'button', class: 'linkish' }, 'הסרה');
      rm.onclick = () => ((image = null), syncImg());
      imgBox.replaceChildren(...[image ? h('img', { src: image, alt: '' }) : null, h('label', { class: 'btn btn--small' }, svg('upload', 16), image ? 'החלפת תמונה' : 'תמונה (לא חובה)', file), image ? rm : null].filter((x) => !!x) as HTMLElement[]);
    };
    syncTypes();
    syncImg();
    const save = h('button', { type: 'submit', class: 'btn btn--primary' }, isNew ? 'הוספה למפה' : 'שמירה');
    const del = isNew ? null : h('button', { type: 'button', class: 'btn btn--danger' }, svg('trash', 16), 'מחיקה');
    const form = h(
      'form',
      { class: 'f' },
      h('div', { class: 'f-row' }, h('span', {}, 'סוג'), typeRow),
      emojiRow,
      h('label', { class: 'f-row' }, h('span', {}, 'כותרת'), title),
      h('label', { class: 'f-row' }, h('span', {}, 'תיאור'), body),
      h('div', { class: 'f-row' }, h('span', {}, 'תמונה'), imgBox),
      type === 'death' && isNew ? h('p', { class: 'f-hint' }, 'מרקר מוות מעלה גם את מונה המיתות ב-1.') : null,
      h('div', { class: 'f-actions' }, save, del),
    );
    if (del) {
      del.onclick = async () => {
        if (!del.dataset.armed) {
          del.dataset.armed = '1';
          del.lastChild!.textContent = 'בטוח? לחצו שוב';
          setTimeout(() => {
            delete del.dataset.armed;
            del.lastChild!.textContent = 'מחיקה';
          }, 3000);
          return;
        }
        try {
          await opts.store.deleteMarker(init.id!);
          if (init.type === 'death') await opts.store.bump('deaths', -1, init.mission_id ?? null);
          closePopup();
          opts.toast('המרקר נמחק');
        } catch (err) {
          opts.toast((err as Error).message);
        }
      };
    }
    form.onsubmit = async (e) => {
      e.preventDefault();
      save.disabled = true;
      const cur = d ? d.missions[currentIndex(d)] : null;
      const m: Marker = {
        id: init.id ?? crypto.randomUUID(),
        type,
        x: init.x,
        y: init.y,
        title: title.value.trim(),
        body: body.value.trim(),
        emoji: type === 'custom' ? emoji : null,
        image_url: image,
        mission_id: init.mission_id ?? cur?.id ?? null,
        created_at: init.created_at ?? new Date().toISOString(),
      };
      try {
        await opts.store.saveMarker(m);
        // מוות = גם ספירה (רק במרקר חדש, או כשסוג שונה למוות)
        if (type === 'death' && (isNew || init.type !== 'death')) await opts.store.bump('deaths', 1, m.mission_id);
        if (init.type === 'death' && !isNew && type !== 'death') await opts.store.bump('deaths', -1, m.mission_id);
        closePopup();
        opts.toast(isNew ? `נוסף למפה: ${m.title || MARKER_TYPES[type].label}` : 'נשמר');
        if (isNew) setTool(null);
      } catch (err) {
        opts.toast((err as Error).message);
        save.disabled = false;
      }
    };
    openPopup({ key: 'ed-marker', kicker: isNew ? 'מרקר חדש' : 'עריכת מרקר', title: isNew ? MARKER_TYPES[type].label : init.title || MARKER_TYPES[type].label, body: form, size: 's' });
    setTimeout(() => title.focus(), 60);
  }

  // ── טופס עצירה (חדשה במקום שנלחץ / עריכה של קיימת) ──
  function stopForm(existing: Mission | null, p: { x: number; y: number } | null) {
    const d = opts.data();
    if (!d) return;
    const m = existing ?? newMission(d.missions.length ? Math.max(...d.missions.map((x) => x.order_index)) + 1 : 0);
    const last = d.missions[d.missions.length - 1];
    let point = p ?? (m.map_x != null && m.map_y != null ? { x: m.map_x, y: m.map_y } : null);
    const title = h('input', { class: 'f-in', maxLength: 80, value: m.title, placeholder: 'שם המשימה', required: true });
    const summary = h('textarea', { class: 'f-in', rows: 2, maxLength: 200, value: m.summary, placeholder: 'תקציר קצר (מופיע ליד הסיכה)' });
    const recap = h('input', { class: 'f-in', type: 'url', dir: 'ltr', value: m.recap_url ?? '', placeholder: 'https://kick.com/…/clips/…' });
    const ms = h('input', { type: 'checkbox', checked: m.is_milestone });
    const now = h('input', { type: 'checkbox', checked: !existing });
    const where = h('span', { class: 'f-hint' }, point ? 'המיקום נבחר על המפה.' : 'מיקום אוטומטי: בהמשך המסלול.');
    const move = existing ? h('button', { type: 'button', class: 'btn btn--small' }, svg('pin', 16), 'הזזה על המפה') : null;
    if (move)
      move.onclick = () => {
        closePopup();
        pickPoint((np) => {
          point = np;
          stopForm({ ...m, title: title.value, summary: summary.value, recap_url: recap.value || null, is_milestone: ms.checked, map_x: np.x, map_y: np.y }, np);
        });
      };
    const save = h('button', { type: 'submit', class: 'btn btn--primary' }, existing ? 'שמירה' : 'הוספת העצירה');
    const del = existing ? h('button', { type: 'button', class: 'btn btn--danger' }, svg('trash', 16), 'מחיקה') : null;
    const form = h(
      'form',
      { class: 'f' },
      h('label', { class: 'f-row' }, h('span', {}, 'שם'), title),
      h('label', { class: 'f-row' }, h('span', {}, 'תקציר'), summary),
      h('label', { class: 'check check--ms' }, ms, h('span', {}, h('strong', {}, 'מיילסטון'), h('small', {}, 'סיכה צהובה גדולה, סטורי רשמי ופס ההתקדמות'))),
      existing ? null : h('label', { class: 'check' }, now, h('span', {}, 'זאת העצירה שאנחנו בה עכשיו')),
      h('label', { class: 'f-row' }, h('span', {}, 'קישור לקטע (לא חובה)'), recap),
      h('div', { class: 'f-cols' }, where, move),
      h('p', { class: 'f-hint' }, 'ריקאפ מלא, תמונה, הורדה וציטוט – בעמוד הניהול.'),
      h('div', { class: 'f-actions' }, save, del),
    );
    if (del) {
      del.onclick = async () => {
        if (!del.dataset.armed) {
          del.dataset.armed = '1';
          del.lastChild!.textContent = 'בטוח? לחצו שוב';
          setTimeout(() => {
            delete del.dataset.armed;
            del.lastChild!.textContent = 'מחיקה';
          }, 3000);
          return;
        }
        // אם מוחקים את העצירה הנוכחית – "אנחנו כאן" עובר לעצירה שלפניה
        const idx = d.missions.findIndex((x) => x.id === m.id);
        const wasCurrent = idx >= 0 && currentIndex(d) === idx;
        del.disabled = true;
        try {
          await opts.store.deleteMission(m.id);
          if (wasCurrent && idx > 0) await opts.store.saveSettings({ ...d.settings, current_mission_id: d.missions[idx - 1].id });
          closePopup();
          opts.onStopDeleted?.(m.id);
          opts.toast('העצירה נמחקה');
        } catch (e) {
          del.disabled = false;
          opts.toast((e as Error).message || 'המחיקה נכשלה');
        }
      };
    }
    form.onsubmit = async (e) => {
      e.preventDefault();
      save.disabled = true;
      const next: Mission = {
        ...m,
        title: title.value.trim(),
        summary: summary.value.trim(),
        recap_url: recap.value.trim() || null,
        is_milestone: ms.checked,
        map_x: point?.x ?? null,
        map_y: point?.y ?? null,
        chapter: m.chapter ?? last?.chapter ?? null,
        stream_day: m.stream_day ?? last?.stream_day ?? null,
      };
      try {
        await opts.store.saveMission(next);
        if (!existing && now.checked) await opts.store.saveSettings({ ...d.settings, current_mission_id: next.id });
        closePopup();
        setTool(null);
        opts.toast(existing ? 'העצירה נשמרה' : `עצירה חדשה: ${next.title}`);
        opts.onStopSaved(next);
      } catch (err) {
        opts.toast((err as Error).message);
        save.disabled = false;
      }
    };
    openPopup({ key: 'ed-stop', kicker: existing ? 'עריכת עצירה' : 'עצירה חדשה במסלול', title: existing ? m.title || 'עצירה' : `עצירה ${d.missions.length + 1}`, body: form, size: 's' });
    setTimeout(() => title.focus(), 60);
  }

  /** בחירת נקודה על המפה (לסקר / הזזת עצירה) */
  function pickPoint(cb: (p: { x: number; y: number }) => void) {
    if (!on) setOn(true);
    picking = cb;
    setTool(null);
    opts.stage.classList.add('is-placing', 'is-picking');
    setHint();
  }

  addEventListener('keydown', (e) => {
    if (!on || e.key !== 'Escape' || document.querySelector('.pop:not([hidden])')) return;
    if (picking || tool) {
      picking = null;
      setTool(null);
    } else setOn(false);
  });

  return {
    isOn: () => on,
    setOn,
    toggle: () => setOn(!on),
    onChange: (f: (on: boolean) => void) => listeners.add(f),
    markerForm: (m: Marker) => markerForm(m),
    stopForm: (m: Mission) => stopForm(m, null),
    pickPoint,
  };
}
export type Editor = ReturnType<typeof createEditor>;

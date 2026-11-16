import { $, fill, fmtDate, h } from '../dom';
import { createStore } from '../data/store';
import { countOf, currentIndex, newMission, statusFresh, type Comment, type CounterName, type Data, type Extras, type LiveData, type Mission } from '../data/types';
import { safeUrl } from '../dom';
import { createPicker } from './picker';
import { markersPanel, pollsPanel, storiesPanel } from './extras';

const DEFAULT_MAP = `${import.meta.env.BASE_URL}map.webp`;
const mapUrl = () => safeUrl(data.settings.map_image_url) || DEFAULT_MAP;
// השביל הראשי (רק למפה המקורית)
let trailRaw: Array<[number, number]> | null = null;
fetch(`${import.meta.env.BASE_URL}trail.json`)
  .then((r) => (r.ok ? r.json() : null))
  .then((t) => (trailRaw = t))
  .catch(() => {});

/** מקטין תמונה לעד 4096px בצד הארוך (JPEG) – מפה כבדה מדי לא תעבוד בטלפונים */
async function downscale(file: File, max = 4096): Promise<File> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  if (k === 1 && file.size < 8 * 1024 * 1024) return file;
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/jpeg', 0.9));
  return new File([blob], 'image.jpg', { type: 'image/jpeg' });
}

const store = createStore();
const app = $('app');
const editor = $<HTMLDialogElement>('editor');
let data: Data;
let live: LiveData | null = null;
let settingsOpen = false;
let comments: Comment[] = [];
let showHidden = false;
let ex: Extras = { markers: [], stories: [], polls: [] };

let toastTimer = 0;
function toast(text: string, bad = false) {
  const t = $('toast');
  t.textContent = text;
  t.className = `show ${bad ? 'bad' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.className = ''), 4000);
}

/** מריץ פעולה מול השרת ומציג שגיאה אם נכשלה */
async function run(action: () => Promise<void>, ok?: string) {
  try {
    await action();
    if (store.mode === 'supabase') data = await store.load();
    ex = await store.loadExtras(true).catch(() => ex);
    render();
    if (ok) toast(ok);
    return true;
  } catch (e) {
    toast((e as Error).message || 'הפעולה נכשלה', true);
    return false;
  }
}

/** אישור בשתי לחיצות (בלי חלון confirm, שחסום בחלק מהדפדפנים המוטמעים) */
function twice(e: MouseEvent, action: () => void) {
  const btn = e.currentTarget as HTMLButtonElement;
  if (btn.dataset.armed) {
    action();
    return;
  }
  const label = btn.textContent;
  btn.dataset.armed = '1';
  btn.textContent = 'בטוח? לחצו שוב';
  setTimeout(() => {
    delete btn.dataset.armed;
    btn.textContent = label;
  }, 3000);
}

/** "תמונה מהקטע": הדבקת צילום מסך (Ctrl+V), גרירה או בחירת קובץ; מוקטנת ל-1600px לפני העלאה */
function shotField(input: HTMLInputElement) {
  const preview = h('div', { class: 'shot__preview' });
  const show = () => {
    const u = safeUrl(input.value);
    preview.replaceChildren(u ? h('img', { src: u, alt: 'תמונה מהקטע' }) : h('span', {}, 'עוד אין תמונה'));
  };
  const take = async (f: File | null | undefined) => {
    if (!f || !f.type.startsWith('image/')) return;
    toast('מעלה את התמונה…');
    try {
      input.value = await store.upload(await downscale(f, store.mode === 'demo' ? 900 : 1600));
      show();
      toast('התמונה נוספה');
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const file = h('input', { type: 'file', accept: 'image/*', class: 'file' });
  file.onchange = () => take(file.files?.[0]).then(() => (file.value = ''));
  const zone = h(
    'div',
    { class: 'shot', tabIndex: 0 },
    preview,
    h('div', { class: 'shot__how' }, h('strong', {}, 'הדביקו צילום מסך מהלייב (Ctrl+V)'), h('span', {}, 'או גררו תמונה לכאן, או '), h('label', { class: 'shot__pick' }, 'בחרו קובץ', file)),
  );
  zone.addEventListener('paste', (e) => {
    const it = [...(e.clipboardData?.items ?? [])].find((x) => x.type.startsWith('image/'));
    if (it) {
      e.preventDefault();
      take(it.getAsFile());
    }
  });
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('is-over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('is-over');
    take(e.dataTransfer?.files?.[0]);
  });
  input.addEventListener('input', show);
  show();
  return h(
    'div',
    { class: 'field' },
    h('span', {}, 'תמונה מהקטע'),
    zone,
    h('small', {}, 'מופיעה בראש הפאנל, ובמיילסטון גם בתוך הסיכה על המפה. אפשר גם קישור:'),
    input,
  );
}

function field(label: string, input: HTMLElement, hint?: string) {
  return h('label', { class: 'field' }, h('span', {}, label), input, hint ? h('small', {}, hint) : null);
}

// ── התחברות ──
function renderLogin() {
  const email = h('input', { type: 'email', required: true, autocomplete: 'username' });
  const pass = h('input', { type: 'password', required: true, autocomplete: 'current-password' });
  const form = h(
    'form',
    { class: 'panel login' },
    h('p', { class: 'stamp' }, 'חדר הבקרה'),
    h('h1', {}, 'ניהול המסע'),
    h('p', { class: 'muted' }, 'כניסה למי שמעדכן את המפה בזמן הלייב.'),
    field('אימייל', email),
    field('סיסמה', pass),
    h('button', { class: 'btn primary', type: 'submit' }, 'כניסה'),
  );
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await store.signIn(email.value, pass.value);
      await start();
    } catch {
      toast('אימייל או סיסמה שגויים', true);
    }
  };
  app.replaceChildren(form);
}

// ── עורך נקודה ──
function openEditor(m: Mission, isNew: boolean) {
  const title = h('input', { value: m.title, required: true, maxLength: 80 });
  const summary = h('textarea', { value: m.summary, rows: 2, maxLength: 200 });
  const body = h('textarea', { value: m.body, rows: 5 });
  const kind = h('select', {}, h('option', { value: 'mission' }, 'משימה'), h('option', { value: 'moment' }, 'קטע חשוב'));
  kind.value = m.kind;
  const milestone = h('input', { type: 'checkbox', checked: m.is_milestone });
  const day = h('input', { type: 'number', min: '1', value: m.stream_day ? String(m.stream_day) : '' });
  const when = h('input', { type: 'datetime-local', value: m.happened_at ? toLocal(m.happened_at) : '' });
  const recap = h('input', { type: 'url', value: m.recap_url ?? '', placeholder: 'https://kick.com/…/clips/…', dir: 'ltr' });
  const download = h('input', { type: 'url', value: m.download_url ?? '', placeholder: 'https://…', dir: 'ltr' });
  const image = h('input', { type: 'url', value: m.image_url ?? '', placeholder: 'https://…', dir: 'ltr' });
  const chapter = h('input', { value: m.chapter ?? '', placeholder: 'למשל: פרק 2 · הביצות', maxLength: 40 });
  const quote = h('textarea', { value: m.quote ?? '', rows: 2, maxLength: 220 });
  const quoteBy = h('input', { value: m.quote_by ?? '', placeholder: 'למשל: הצ׳אט', maxLength: 40 });
  const others = data.missions.some((x) => x.id === m.id) ? data.missions : [...data.missions, m];
  const picker = createPicker({
    trail: data.settings.map_image_url ? null : trailRaw,
    mapUrl: mapUrl(),
    missions: others,
    editingId: m.id,
    value: m.map_x != null && m.map_y != null ? { x: m.map_x, y: m.map_y } : null,
  });

  const uploader = (target: HTMLInputElement, accept: string) => {
    const file = h('input', { type: 'file', accept, class: 'file' });
    file.onchange = async () => {
      if (!file.files?.[0]) return;
      toast('מעלה…');
      try {
        target.value = await store.upload(file.files[0]);
        toast('הקובץ הועלה');
      } catch (e) {
        toast((e as Error).message, true);
      }
      file.value = '';
    };
    return file;
  };

  const form = h(
    'form',
    {},
    h('header', { class: 'editor__head' }, h('p', { class: 'stamp' }, isNew ? `עצירה ${data.missions.length + 1}` : 'עריכה'), h('h2', {}, isNew ? 'עצירה חדשה על המפה' : m.title || 'עריכת עצירה')),
    h(
      'fieldset',
      { class: 'group' },
      h('legend', {}, 'מה קרה ואיפה'),
      field('שם', title),
      field('תקציר קצר', summary, 'מופיע בכרטיס הקטן ליד הסיכה'),
      h('div', { class: 'field' }, h('span', {}, 'איפה על המפה'), picker.el),
      h('label', { class: 'check check--ms' }, milestone, h('span', {}, h('strong', {}, 'מיילסטון'), h('small', {}, 'סיכה צהובה גדולה, סימון בפס ההתקדמות וריקאפ מלא'))),
    ),
    h(
      'fieldset',
      { class: 'group' },
      h('legend', {}, 'ריקאפ ומדיה'),
      shotField(image),
      field('ריקאפ מלא', body, 'מה קרה ולמה זה חשוב לעלילה'),
      field('קישור לקטע מהלייב', recap, 'קליפ או VOD של Kick, YouTube, או קובץ mp4 ישיר שמתנגן בתוך האתר'),
      field('קישור להורדה', download),
      h('div', { class: 'upload' }, h('span', {}, 'או העלאת קובץ להורדה:'), uploader(download, 'video/*,audio/*,image/*')),
    ),
    h(
      'details',
      { class: 'group group--more', open: !isNew },
      h('summary', {}, 'עוד פרטים: סוג, יום, פרק וציטוט'),
      h('div', { class: 'row' }, field('סוג', kind), field('יום בסאבתון', day), field('מתי קרה', when)),
      field('פרק בעלילה', chapter, 'מקבץ את הסיכות בפס הפרקים. ריק = לפי יום'),
      h('div', { class: 'row' }, field('ציטוט', quote), field('מי אמר', quoteBy)),
    ),
    h(
      'div',
      { class: 'actions' },
      h('button', { class: 'btn primary', type: 'submit' }, 'שמירה'),
      h('button', { class: 'btn', type: 'button', onclick: () => editor.close() }, 'ביטול'),
    ),
  );
  form.onsubmit = async (e) => {
    e.preventDefault();
    const next: Mission = {
      ...m,
      title: title.value.trim(),
      summary: summary.value.trim(),
      body: body.value.trim(),
      kind: kind.value as Mission['kind'],
      is_milestone: milestone.checked,
      stream_day: day.value ? Number(day.value) : null,
      happened_at: when.value ? new Date(when.value).toISOString() : null,
      recap_url: recap.value.trim() || null,
      download_url: download.value.trim() || null,
      image_url: image.value.trim() || null,
      chapter: chapter.value.trim() || null,
      quote: quote.value.trim() || null,
      quote_by: quoteBy.value.trim() || null,
      map_x: picker.get()?.x ?? null,
      map_y: picker.get()?.y ?? null,
    };
    const save = async () => {
      await store.saveMission(next);
      // נקודה חדשה היא בדרך כלל "איפה שאנחנו עכשיו" – חוסך לחיצה באמצע לייב
      if (isNew) await store.saveSettings({ ...data.settings, current_mission_id: next.id });
    };
    if (await run(save, 'נשמר – הצופים כבר רואים את זה')) editor.close();
  };
  // הדבקת תמונה בכל מקום בעורך (כשלא מקלידים בשדה טקסט) נכנסת כתמונה מהקטע
  form.addEventListener('paste', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('.shot') || ['TEXTAREA'].includes(t.tagName) || (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'url')) return;
    const it = [...(e.clipboardData?.items ?? [])].find((x) => x.type.startsWith('image/'));
    if (!it) return;
    e.preventDefault();
    form.querySelector<HTMLElement>('.shot')?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: e.clipboardData, bubbles: false }));
  });
  editor.replaceChildren(form);
  editor.showModal();
}

function toLocal(iso: string) {
  const d = new Date(iso);
  return new Date(+d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

// ── מסך ראשי ──
/** כפתורי הספירה: גדולים, לטלפון שליד המחשב בזמן הלייב */
function countersPanel(compact: boolean) {
  const cur = data.missions[currentIndex(data)];
  const box = (c: CounterName, icon: string, label: string) => {
    const n = live ? countOf(live, c) : 0;
    const here = live && cur ? countOf(live, c, cur.id) : 0;
    const plus = h('button', { class: `big big--${c}`, type: 'button', ariaLabel: `${label} +1` }, h('span', { class: 'big__icon' }, icon), h('span', { class: 'big__label' }, label), h('b', { class: 'big__n' }, n.toLocaleString('he-IL')));
    plus.onclick = async () => {
      plus.classList.remove('is-hit');
      void plus.offsetWidth;
      plus.classList.add('is-hit');
      navigator.vibrate?.(30);
      try {
        await store.bump(c, 1, cur?.id ?? null);
      } catch (e) {
        toast((e as Error).message, true);
      }
    };
    const undo = h('button', { class: 'btn undo', type: 'button', disabled: n <= 0 }, `↶ ביטול ${label}`);
    undo.onclick = () => store.bump(c, -1, cur?.id ?? null).then(() => toast('בוטל'), (e) => toast((e as Error).message, true));
    return h('div', { class: 'counter' }, plus, h('div', { class: 'counter__foot' }, h('small', {}, cur ? `במשימה הנוכחית: ${here}` : ''), undo));
  };
  const st = live?.status;
  const fresh = statusFresh(st ?? null);
  const status = fresh
    ? st!.is_live
      ? st!.on_category
        ? '🔴 בלייב על GTA 6: זמן המשחק נספר'
        : `🟡 בלייב, אבל לא על GTA 6 (${st!.category ?? 'קטגוריה לא ידועה'}): זמן המשחק לא נספר`
      : '⚫ לא בלייב'
    : store.mode === 'demo'
      ? '⚪ מצב דמו'
      : '⚪ הבדיקה האוטומטית מול Kick לא פעילה (ראה README: kick-sync)';
  return h(
    'section',
    { class: `panel counters ${compact ? 'counters--full' : ''}` },
    h('div', { class: 'panel-head' }, h('h2', {}, 'ספירות'), compact ? h('a', { class: 'btn', href: '#' }, 'לכל הניהול') : h('a', { class: 'btn', href: '#counters' }, 'מסך ספירות מלא')),
    h('p', { class: 'live-line' }, status),
    h('div', { class: 'counters__row' }, box('deaths', '💀', 'מוות'), box('cats', '🐈', 'חתול')),
    h('small', { class: 'counters__hint' }, cur ? `נספר על: ${cur.title || 'המשימה הנוכחית'}. מודרטורים יכולים גם לכתוב בצ'אט !מוות או !חתול (אחרי חיבור האפליקציה של Kick).` : ''),
  );
}

/** העצירה הנוכחית והפעולה הכי חשובה בלייב: עצירה חדשה */
function nowCard() {
  const { missions } = data;
  const i = currentIndex(data);
  const m = missions[i];
  const nextOrder = missions.length ? Math.max(...missions.map((x) => x.order_index)) + 1 : 0;
  const add = h('button', { class: 'btn primary btn--big', type: 'button' }, '+ עצירה חדשה');
  add.onclick = () => {
    const last = missions[missions.length - 1];
    openEditor({ ...newMission(nextOrder), chapter: last?.chapter ?? null, stream_day: last?.stream_day ?? null }, true);
  };
  return h(
    'section',
    { class: 'now-card' },
    h(
      'div',
      { class: 'now-card__info' },
      h('p', { class: 'stamp' }, m ? 'אנחנו עכשיו ב' : 'עוד לא התחלנו'),
      m ? h('h2', {}, h('span', { class: `num ${m.is_milestone ? 'num--ms' : ''}` }, String(i + 1)), m.title || '(ללא שם)') : h('h2', {}, 'העצירה הראשונה מחכה'),
      m ? h('p', { class: 'muted' }, [m.chapter, m.stream_day ? `יום ${m.stream_day}` : '', fmtDate(m.happened_at)].filter(Boolean).join('  |  ')) : null,
    ),
    h('div', { class: 'now-card__actions' }, add, m ? h('button', { class: 'btn', type: 'button', onclick: () => openEditor(m, false) }, 'עריכת הנוכחית') : null),
  );
}

/** תגובות אחרונות מהצופים: הסתרה, מחיקה וחסימה */
function commentsPanel() {
  const titleOf = (c: Comment) => {
    if (c.target_type === 'stop') {
      const i = data.missions.findIndex((m) => m.id === c.target_id);
      return i >= 0 ? { label: `עצירה ${i + 1}: ${data.missions[i].title}`, href: `./#m-${i + 1}` } : { label: 'עצירה שנמחקה', href: '' };
    }
    if (c.target_type === 'marker') {
      const m = ex.markers.find((x) => x.id === c.target_id);
      return { label: `מרקר: ${m?.title || 'מרקר שנמחק'}`, href: m ? `./#marker-${m.id}` : '' };
    }
    if (c.target_type === 'story') {
      const st = ex.stories.find((x) => x.id === c.target_id);
      return { label: `סטורי של ${st?.username || 'צופה'}`, href: '' };
    }
    const clip = live?.clips.find((x) => x.id === c.target_id);
    return { label: `קליפ: ${clip?.title || 'קליפ'}`, href: '' };
  };
  const list = [...comments].filter((c) => showHidden || !c.hidden).reverse().slice(0, 60);
  const toggle = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: showHidden, onchange: (e: Event) => { showHidden = (e.target as HTMLInputElement).checked; render(); } }), h('span', {}, 'להציג גם מוסתרות'));
  return h(
    'section',
    { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', {}, `תגובות אחרונות (${comments.filter((c) => !c.hidden).length})`), toggle),
    list.length
      ? h(
          'ol',
          { class: 'cmt-mod' },
          ...list.map((c) => {
            const t = titleOf(c);
            return h(
              'li',
              { class: c.hidden ? 'is-hidden' : '' },
              h(
                'div',
                { class: 'cmt-mod__main' },
                h('p', { class: 'cmt-mod__meta' }, h('strong', {}, c.username), h('span', {}, fmtDate(c.created_at)), t.href ? h('a', { href: t.href, target: '_blank' }, t.label) : h('span', {}, t.label)),
                h('p', { class: 'cmt-mod__body' }, c.body),
              ),
              h(
                'div',
                { class: 'ops' },
                h('button', { type: 'button', onclick: () => run(() => store.moderateComment(c.id, c.hidden ? 'show' : 'hide'), c.hidden ? 'התגובה חזרה' : 'התגובה הוסתרה') }, c.hidden ? 'החזרה' : 'הסתרה'),
                h('button', { type: 'button', class: 'danger', onclick: (e: MouseEvent) => twice(e, () => run(() => store.moderateComment(c.id, 'delete'), 'נמחקה')) }, 'מחיקה'),
                h('button', { type: 'button', class: 'danger', title: 'חוסם את המשתמש מלהגיב ומסתיר את כל התגובות שלו', onclick: (e: MouseEvent) => twice(e, () => run(() => store.banUser(c.kick_user_id, c.username), `${c.username} נחסם`)) }, 'חסימה'),
              ),
            );
          }),
        )
      : h('p', { class: 'empty' }, 'עוד אין תגובות. צופים מגיבים מהפאנל של כל עצירה ומתחת לקליפים, אחרי התחברות עם Kick.'),
  );
}

function render() {
  if (location.hash === '#counters') {
    fill(app, countersPanel(true));
    return;
  }
  const { missions, settings } = data;
  const cur = currentIndex(data);

  const sTitle = h('input', { value: settings.title });
  const sKick = h('input', { value: settings.kick_channel, placeholder: 'odedsvr', dir: 'ltr' });
  const sCat = h('input', { value: settings.kick_category, placeholder: 'grand-theft-auto-vi', dir: 'ltr' });
  const sStart = h('input', { type: 'datetime-local', value: settings.started_at ? toLocal(settings.started_at) : '' });
  const sLive = h('input', { type: 'checkbox', checked: settings.is_live });
  const sZoom = h('input', { type: 'range', min: '1.5', max: '6', step: '0.25', value: String(settings.map_zoom || 3) });
  const mapFile = h('input', { type: 'file', accept: 'image/*', class: 'file' });
  mapFile.onchange = async () => {
    const f = mapFile.files?.[0];
    if (!f) return;
    toast('מעלה את המפה…');
    try {
      const url = await store.upload(await downscale(f, store.mode === 'demo' ? 1600 : 4096));
      await run(() => store.saveSettings({ ...data.settings, map_image_url: url }), 'המפה הוחלפה – הצופים כבר רואים אותה');
    } catch (e) {
      toast((e as Error).message, true);
    }
    mapFile.value = '';
  };
  const mapBox = h(
    'div',
    { class: 'mapbox' },
    h('img', { src: mapUrl(), alt: 'המפה הנוכחית' }),
    h(
      'div',
      { class: 'mapbox__side' },
      h('strong', {}, settings.map_image_url ? 'המפה שהעלית' : 'המפה המקורית של האתר'),
      h('small', {}, 'המפה מוצגת בדיוק כמו שהיא, בלי שינויים. כדאי תמונה חדה ברזולוציה גבוהה (2000px ומעלה). תמונות גדולות מ-4096px מוקטנות אוטומטית.'),
      h('label', { class: 'btn' }, 'העלאת מפה', mapFile),
      settings.map_image_url
        ? h('button', { class: 'btn', type: 'button', onclick: (e: MouseEvent) => twice(e, () => run(() => store.saveSettings({ ...settings, map_image_url: null }), 'חזרנו למפה המקורית')) }, 'חזרה למפה המקורית')
        : null,
    ),
  );
  const settingsForm = h(
    'form',
    { class: 'panel settings' },
    h('h2', {}, 'הגדרות האתר'),
    h('div', { class: 'row' }, field('כותרת הסאבתון', sTitle), field('ערוץ Kick', sKick), field('תחילת הסאבתון', sStart)),
    field('קטגוריה ב-Kick', sCat, 'הכתובת של הקטגוריה (מה שאחרי kick.com/category/). רק הזמן בקטגוריה הזו נספר, ורק הקליפים ממנה מופיעים.'),
    h('label', { class: 'check' }, sLive, h('span', {}, 'אני בלייב עכשיו (גיבוי ידני: משמש רק כשהבדיקה האוטומטית מול Kick לא פעילה)')),
    field('המפה', mapBox),
    field('כמה קרוב המצלמה במסע', sZoom, 'שמאלה = רואים יותר מהמפה, ימינה = קרוב יותר'),
    h('button', { class: 'btn', type: 'submit' }, 'שמירת הגדרות'),
  );
  settingsForm.onsubmit = (e) => {
    e.preventDefault();
    run(
      () =>
        store.saveSettings({
          ...settings,
          title: sTitle.value.trim(),
          kick_channel: sKick.value.trim(),
          kick_category: sCat.value.trim().replace(/^.*\/category\//, '') || 'grand-theft-auto-vi',
          started_at: sStart.value ? new Date(sStart.value).toISOString() : null,
          is_live: sLive.checked,
          map_zoom: Number(sZoom.value),
        }),
      'ההגדרות נשמרו',
    );
  };

  const nextOrder = missions.length ? Math.max(...missions.map((m) => m.order_index)) + 1 : 0;
  const list = h(
    'ol',
    { class: 'list' },
    ...missions.map((m, i) =>
      h(
        'li',
        { class: i === cur ? 'now' : '' },
        h('span', { class: `num ${m.is_milestone ? 'num--ms' : ''}` }, String(i + 1)),
        h(
          'div',
          { class: 'info' },
          h('strong', {}, m.title || '(ללא שם)'),
          h('small', {}, [m.is_milestone ? 'מיילסטון' : m.kind === 'moment' ? 'קטע' : 'משימה', m.stream_day ? `יום ${m.stream_day}` : '', fmtDate(m.happened_at), i === cur ? 'כאן אנחנו עכשיו' : ''].filter(Boolean).join('  |  ')),
        ),
        h(
          'div',
          { class: 'ops' },
          h('button', { type: 'button', title: 'סמן כנוכחית', ariaLabel: 'סמן כנוכחית', disabled: i === cur, onclick: () => run(() => store.saveSettings({ ...settings, current_mission_id: m.id }), 'סומנה כמשימה הנוכחית') }, '📍'),
          h('button', { type: 'button', title: 'למעלה', ariaLabel: 'הזז למעלה', disabled: i === 0, onclick: () => run(() => store.swap(m, missions[i - 1])) }, '↑'),
          h('button', { type: 'button', title: 'למטה', ariaLabel: 'הזז למטה', disabled: i === missions.length - 1, onclick: () => run(() => store.swap(m, missions[i + 1])) }, '↓'),
          h('button', { type: 'button', onclick: () => openEditor(m, false) }, 'עריכה'),
          h('button', {
            type: 'button',
            class: 'danger',
            onclick: (e: MouseEvent) => twice(e, () => run(() => store.deleteMission(m.id), 'נמחק')),
          }, 'מחיקה'),
        ),
      ),
    ),
  );

  fill(
    app,
    h(
      'header',
      { class: 'top' },
      h('div', { class: 'top__title' }, h('p', { class: 'stamp' }, 'חדר הבקרה'), h('h1', {}, settings.title || 'ניהול המסע')),
      h('a', { class: 'btn', href: './', target: '_blank' }, 'לאתר'),
      store.mode === 'supabase'
        ? h('button', { class: 'btn', type: 'button', onclick: async () => { await store.signOut(); renderLogin(); } }, 'יציאה')
        : null,
    ),
    store.mode === 'demo'
      ? h('p', { class: 'banner' }, 'מצב דמו: השינויים נשמרים רק בדפדפן הזה. אחרי חיבור Supabase (ראה README) הם יגיעו לכל הצופים בזמן אמת.')
      : null,
    nowCard(),
    countersPanel(false),
    h(
      'section',
      { class: 'panel' },
      h(
        'div',
        { class: 'panel-head' },
        h('h2', {}, `העצירות (${missions.length})`),
        h('button', {
          class: 'btn',
          type: 'button',
          onclick: () => {
            // ממשיכים את הפרק והיום של הנקודה האחרונה – באמצע לייב רק שם ומיקום
            const last = missions[missions.length - 1];
            openEditor({ ...newMission(nextOrder), chapter: last?.chapter ?? null, stream_day: last?.stream_day ?? null }, true);
          },
        }, '+ עצירה חדשה'),
      ),
      missions.length ? list : h('p', { class: 'empty' }, 'עדיין אין עצירות. מוסיפים את המשימה הראשונה כשהלייב מתחיל.'),
    ),
    storiesPanel({ store, ex, data, run, twice }),
    pollsPanel({ store, ex, data, run, twice }),
    markersPanel({ store, ex, data, run, twice }),
    commentsPanel(),
    (() => {
      // נשאר פתוח גם אחרי שמירה (העמוד נבנה מחדש בכל שינוי)
      const fold = h('details', { class: 'fold', open: settingsOpen }, h('summary', {}, h('span', {}, 'הגדרות האתר'), h('small', {}, 'שם, ערוץ, קטגוריה, מפה וזום')), settingsForm);
      fold.addEventListener('toggle', () => (settingsOpen = fold.open));
      return fold;
    })(),
  );
  // לפעולה הכי נפוצה בלייב: גלילה לרשימה מעלה את העצירה הנוכחית
  // (גוללים רק בתוך הרשימה, לא את כל העמוד)
  const box = app.querySelector<HTMLElement>('.list');
  const now = box?.querySelector<HTMLElement>('li.now');
  if (box && now) box.scrollTop = now.offsetTop - box.offsetTop - box.clientHeight / 2 + now.clientHeight / 2;
}

async function start() {
  if (!(await store.isAuthed())) return renderLogin();
  // מצב דמו: מי שנכנס לניהול הוא מוד גם במפה (כפתור "עריכה"). ב-Supabase המפה בודקת את ההתחברות עצמה.
  if (store.mode === 'demo') {
    try {
      localStorage.setItem('mc-mod', '1');
    } catch {
      /* חסום */
    }
  }
  try {
    data = await store.load();
  } catch (e) {
    app.replaceChildren(h('p', { class: 'banner bad' }, `טעינת הנתונים נכשלה: ${(e as Error).message}`));
    return;
  }
  render();
  // עדכון ממוד אחר – לא מרעננים בזמן שעורך פתוח כדי לא לאבד הקלדה
  store.subscribe((d) => {
    data = d;
    if (!editor.open) render();
  });
  const onLive = (l: LiveData) => {
    live = l;
    if (!editor.open) render();
  };
  store.loadLive().then(onLive).catch(() => {});
  const onComments = (c: Comment[]) => {
    comments = c;
    if (!editor.open) render();
  };
  store.loadComments(true).then(onComments).catch(() => {});
  store.subscribeComments(onComments, true);
  store.subscribeLive(onLive);
  // סטוריז, מרקרים וסקרים (כולל סטוריז שמחכים לאישור)
  const onExtras = (e: Extras) => {
    ex = e;
    // לא בונים מחדש בזמן הקלדה בטופס הסקר
    const typing = document.activeElement instanceof HTMLInputElement && !!document.activeElement.closest('.pl-form');
    if (!editor.open && !typing) render();
  };
  store.loadExtras(true).then(onExtras).catch(() => {});
  store.subscribeExtras(onExtras, true);
  addEventListener('hashchange', render);
}
start();

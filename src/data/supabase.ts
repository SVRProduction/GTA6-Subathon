import { createClient } from '@supabase/supabase-js';
import { STORAGE_BUCKET } from '../config';
import { DEFAULT_OWNERS, getModSession, kickName, setModSession, type ModSession } from './modSession';
import { DEFAULT_SETTINGS, type Clip, type Comment, type CounterEvent, type Data, type Extras, type LiveData, type LiveStatus, type Marker, type Mission, type Poll, type Segment, type Settings, type Store, type Story, type Viewer, type ModEntry } from './types';

export function createSupabaseStore(url: string, key: string): Store {
  // פעולות מוד נשלחות עם הטוקן מ-kick-mod; בלי טוקן – כמו צופה (anon)
  // טוקן שלא נראה כמו JWT (למשל מהדמו באותו דומיין) לא נשלח, אחרת כל הבקשות ייכשלו
  const jwt = () => {
    const t = getModSession()?.token;
    return t && t.split('.').length === 3 ? t : null;
  };
  if (getModSession() && !jwt()) setModSession(null);
  const sb = createClient(url, key, { accessToken: async () => jwt() });
  const fnUrl = (name: string) => `${url}/functions/v1/${name}`;
  let refreshing: Promise<ModSession> | null = null;
  async function modLogin(viewer: Viewer): Promise<ModSession> {
    const r = await fetch(fnUrl('kick-mod'), { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: key }, body: JSON.stringify({ token: viewer.token }) });
    const j = await r.json().catch(() => null);
    if (!r.ok) {
      if (r.status === 403 || r.status === 401) setModSession(null);
      throw Object.assign(new Error(j?.error ?? 'הבדיקה מול רשימת המודים נכשלה. נסו שוב.'), { status: r.status });
    }
    const s: ModSession = { token: j.token, exp: j.exp, name: j.name, owner: !!j.owner };
    setModSession(s);
    sb.realtime.setAuth(s.token);
    return s;
  }
  /** הטוקן תקף 12 שעות: מתחדש לבד עם כרטיס ה-Kick כשנשארה פחות משעה */
  function keepFresh() {
    const s = getModSession();
    if (!s || s.exp * 1000 - Date.now() > 3600_000 || refreshing) return;
    let v: Viewer | null = null;
    try {
      v = JSON.parse(localStorage.getItem('kick-viewer') ?? 'null');
    } catch {
      v = null;
    }
    if (!v?.token) return;
    refreshing = modLogin(v).finally(() => (refreshing = null));
    refreshing.catch(() => {});
  }
  setInterval(keepFresh, 5 * 60_000);

  // Realtime רק לעורכים ולשכבת ה-OBS. צופים בודקים מדי פעם, בזמנים מפוזרים:
  // אלפי צופים עם Realtime הפילו את השרת (כל שינוי = בקשה מכל צופה באותו רגע)
  const realtime = () => !!getModSession() || /overlay/.test(location.pathname);
  function every(ms: number, f: () => void) {
    let t: number | undefined;
    const tick = () => {
      t = window.setTimeout(() => {
        if (document.visibilityState !== 'hidden') f();
        tick();
      }, ms * (0.75 + Math.random() * 0.5));
    };
    tick();
    // חוזרים ללשונית אחרי זמן: רענון אחד (מפוזר)
    let hiddenAt = 0;
    const vis = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > ms) window.setTimeout(f, Math.random() * 5000);
    };
    document.addEventListener('visibilitychange', vis);
    return () => {
      clearTimeout(t);
      document.removeEventListener('visibilitychange', vis);
    };
  }
  keepFresh();

  const check = <T extends { error: { message: string } | null }>(r: T): T => {
    if (r.error) {
      // טוקן מוד שהשרת לא מקבל (סוד JWT שגוי / פג) – מתנתקים כדי שהאתר ימשיך לעבוד כצופה
      if (jwt() && /jwt|JWS|signature/i.test(r.error.message)) setModSession(null);
      throw new Error(r.error.message);
    }
    return r;
  };

  // ── מטמון משותף לצופים (טבלה site_cache, מתרעננת בשרת כל 10 שניות) ──
  // שורה אחת במקום ~15 שאילתות לכל צופה. עורכים ושכבת ה-OBS קוראים ישירות מהטבלאות.
  // אם הטבלה עוד לא קיימת (לא הורץ update-site-cache.sql) – חוזרים לשאילתות הרגילות.
  type LiveRow = {
    status: LiveStatus | null;
    segments: Segment[];
    counters: Array<{ counter: CounterEvent['counter']; mission_id: string | null; n: number; last_at: string }>;
    recent: CounterEvent[];
    polls: Array<Omit<Poll, 'votes'>>;
    results: Array<{ poll_id: string; option: number; n: number }>;
    likes: Array<{ target_type: string; target_id: string; n: number }>;
  };
  type DataRow = { settings: (Partial<Settings> & { id?: number }) | null; missions: Mission[]; markers: Marker[]; stories: Story[] };
  let noCache = false;
  const memo = new Map<string, { at: number; p: Promise<unknown> }>();
  function cached<T>(id: 'live' | 'data' | 'clips' | 'comments'): Promise<T | null> {
    if (noCache || realtime()) return Promise.resolve(null);
    const hit = memo.get(id);
    if (hit && Date.now() - hit.at < 5000) return hit.p as Promise<T | null>;
    const p = Promise.resolve(sb.from('site_cache').select('data').eq('id', id).maybeSingle()).then(({ data, error }) => {
      if (error) {
        if (error.code === 'PGRST205' || error.code === '42P01' || /site_cache/.test(error.message)) {
          noCache = true;
          return null;
        }
        memo.delete(id);
        throw new Error(error.message);
      }
      if (!data) return null; // המטמון עוד לא התמלא (הדקה הראשונה) – הפעם מהטבלאות
      return (data as { data: T }).data;
    });
    memo.set(id, { at: Date.now(), p });
    return p;
  }
  const pollsWithVotes = (polls: Array<Omit<Poll, 'votes'>>, results: LiveRow['results']) =>
    polls.map((x) => ({ ...x, votes: x.options.map((_, k) => results.find((v) => v.poll_id === x.id && v.option === k)?.n ?? 0) }));

  async function load(): Promise<Data> {
    const c = await cached<DataRow>('data');
    if (c) {
      const { id: _i, ...st } = c.settings ?? {};
      return { missions: c.missions ?? [], drafts: [], settings: { ...DEFAULT_SETTINGS, ...st } };
    }
    const [m, s] = await Promise.all([
      sb.from('missions').select('*').order('order_index'),
      sb.from('settings').select('*').eq('id', 1).maybeSingle(),
    ]);
    check(m);
    check(s);
    const { id: _id, ...settings } = (s.data ?? {}) as Partial<Settings> & { id?: number };
    const all = (m.data ?? []) as Mission[];
    return {
      // טיוטות לא נכנסות למפה (גם לעורכים); הן ברשימה נפרדת בדף הניהול
      missions: all.filter((x) => x.published !== false),
      drafts: all.filter((x) => x.published === false),
      settings: { ...DEFAULT_SETTINGS, ...settings },
    };
  }

  // לייב: כל טבלה נטענת לבד, כך שעדכון סטטוס כל 2 דקות לא מושך שוב את כל הקליפים
  const live: LiveData = { status: null, segments: [], counters: [], clips: [] };
  const loaders: Record<string, () => Promise<void>> = {
    live_status: async () => {
      const c = await cached<LiveRow>('live');
      if (c) return void (live.status = c.status);
      live.status = ((await sb.from('live_status').select('*').eq('id', 1).maybeSingle()).data as LiveStatus | null) ?? null;
    },
    play_segments: async () => {
      const c = await cached<LiveRow>('live');
      if (c) return void (live.segments = c.segments ?? []);
      live.segments = ((await sb.from('play_segments').select('started_at, ended_at').order('started_at').limit(1000)).data ?? []) as Segment[];
    },
    counter_events: async () => {
      const c = await cached<LiveRow>('live');
      if (c) {
        live.counters = (c.counters ?? []).map((r) => ({ counter: r.counter, mission_id: r.mission_id, delta: r.n, created_at: r.last_at }));
        live.recent = c.recent ?? [];
        return;
      }
      const rows = ((await sb.from('counter_totals').select('counter, mission_id, n, last_at').limit(1000)).data ?? []) as Array<{ counter: CounterEvent['counter']; mission_id: string | null; n: number; last_at: string }>;
      live.counters = rows.map((r) => ({ counter: r.counter, mission_id: r.mission_id, delta: r.n, created_at: r.last_at }));
      // האירועים האחרונים עצמם (עם זמן), לפיד הפעילות
      live.recent = ((await sb.from('counter_events').select('counter, delta, mission_id, created_at').order('id', { ascending: false }).limit(80)).data ?? []) as CounterEvent[];
    },
    clips: async () => {
      const c = await cached<Clip[]>('clips');
      if (c) return void (live.clips = c);
      live.clips = ((await sb.from('clips').select('*').order('created_at', { ascending: false }).limit(500)).data ?? []) as Clip[];
    },
  };
  async function loadLive(): Promise<LiveData> {
    await Promise.all(Object.values(loaders).map((f) => f()));
    return { ...live };
  }

  const fn = (name: string) => `${url}/functions/v1/${name}`;
  async function loadComments(includeHidden = false): Promise<Comment[]> {
    if (!includeHidden) {
      const c = await cached<Comment[]>('comments');
      if (c) return c;
    }
    let q = sb.from('comments').select('*').order('created_at', { ascending: true }).limit(2000);
    if (!includeHidden) q = q.eq('hidden', false);
    return ((await q).data ?? []) as Comment[];
  }

  // ── מרקרים / סטוריז / סקרים ──
  async function loadExtras(mod = false): Promise<Extras> {
    if (!mod) {
      const [d, l] = await Promise.all([cached<DataRow>('data'), cached<LiveRow>('live')]);
      if (d && l) return { markers: d.markers ?? [], stories: d.stories ?? [], polls: pollsWithVotes(l.polls ?? [], l.results ?? []).reverse() };
    }
    const now = new Date().toISOString();
    let stories = sb.from('stories').select('*').order('created_at', { ascending: false }).limit(300);
    // צופים: רק מאושרים ובתוקף (זה גם מה שה-RLS מאפשר להם); מודים רואים גם את התור
    if (!mod) stories = stories.eq('status', 'approved').gt('expires_at', now);
    const [m, st, p, r] = await Promise.all([
      sb.from('markers').select('*').order('created_at').limit(2000),
      stories,
      sb.from('polls').select('*').order('created_at', { ascending: false }).limit(30),
      sb.from('poll_results').select('poll_id, option, n').limit(500),
    ]);
    const results = (r.data ?? []) as Array<{ poll_id: string; option: number; n: number }>;
    const polls = ((p.data ?? []) as Array<Omit<Poll, 'votes'>>).map((x) => ({
      ...x,
      votes: x.options.map((_, k) => results.find((v) => v.poll_id === x.id && v.option === k)?.n ?? 0),
    }));
    return { markers: (m.data ?? []) as Marker[], stories: (st.data ?? []) as Story[], polls: polls.reverse() };
  }
  /** פעולות של צופה מחובר עם Kick: דרך הפונקציה kick-viewer, שבודקת את הכרטיס החתום */
  async function viewerCall(viewer: Viewer, action: string, payload: Record<string, unknown>) {
    const r = await fetch(fn('kick-viewer'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key },
      body: JSON.stringify({ token: viewer.token, action, ...payload }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? 'הפעולה לא הצליחה. נסו שוב.');
    return r.json().catch(() => ({}));
  }
  /** תמונה לסטורי: מוקטנת ל-JPEG של עד 1080px לפני השליחה */
  async function toJpeg(file: File, max = 1080) {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.82).split(',')[1];
  }

  return {
    mode: 'supabase',
    loadExtras,
    subscribeExtras(cb, mod = false) {
      let timer: number | undefined;
      const refresh = () => {
        clearTimeout(timer);
        // סקר חי: הרבה קולות בשנייה – מאחדים לרענון אחד בכל ~700ms
        timer = window.setTimeout(
          () =>
            loadExtras(mod)
              .then((e) => {
                hasOpen = e.polls.some((p) => p.status === 'open');
                cb(e);
              })
              .catch(console.error),
          250 + Math.random() * 500,
        );
      };
      // הקולות עצמם פרטיים (אין Realtime עליהם לצופים), אז בזמן סקר פתוח מרעננים את התוצאות כל ~3 שניות
      let hasOpen = false;
      const rt = mod || realtime();
      // סקר פתוח: עורכים כל 3 שניות, צופים כל ~30
      const fast = rt ? window.setInterval(() => hasOpen && document.visibilityState !== 'hidden' && refresh(), 3000) : undefined;
      const stopFast = rt ? () => {} : every(30_000, () => hasOpen && refresh());
      const ch = rt ? sb.channel(`extras-${mod ? 'mod' : 'pub'}`) : null;
      if (ch) {
        for (const table of ['markers', 'stories', 'polls', 'poll_votes']) ch.on('postgres_changes', { event: '*', schema: 'public', table }, refresh);
        ch.subscribe();
      }
      const poll = rt ? window.setInterval(refresh, 60_000) : undefined;
      const stopSlow = rt ? () => {} : every(120_000, refresh);
      loadExtras(mod).then((e) => (hasOpen = e.polls.some((p) => p.status === 'open'))).catch(() => {});
      return () => {
        clearTimeout(timer);
        clearInterval(poll);
        clearInterval(fast);
        stopFast();
        stopSlow();
        if (ch) sb.removeChannel(ch);
      };
    },
    async saveMarker(m) {
      check(await sb.from('markers').upsert(m));
    },
    async deleteMarker(id) {
      check(await sb.from('markers').delete().eq('id', id));
    },
    async submitStory(viewer, d) {
      await viewerCall(viewer, 'story', { image: await toJpeg(d.image), caption: d.caption, mission_id: d.mission_id, x: d.x, y: d.y });
    },
    async likeStory(viewer, id) {
      await viewerCall(viewer, 'like', { story_id: id });
    },
    async loadLikes() {
      const c = await cached<LiveRow>('live').catch(() => null);
      if (c) {
        const out: Record<string, number> = {};
        (c.likes ?? []).forEach((r) => (out[`${r.target_type}:${r.target_id}`] = r.n));
        return out;
      }
      const { data, error } = await sb.from('like_totals').select('target_type, target_id, n');
      if (error) return {}; // לפני שהורץ עדכון הלייקים
      const out: Record<string, number> = {};
      (data ?? []).forEach((r: { target_type: string; target_id: string; n: number }) => (out[`${r.target_type}:${r.target_id}`] = r.n));
      return out;
    },
    async myLikes(viewer) {
      if (viewer.token === 'demo') return [];
      const j = await viewerCall(viewer, 'my_likes', {}).catch(() => ({ likes: [] }));
      return (j as { likes?: string[] }).likes ?? [];
    },
    async toggleLike(viewer, type, id) {
      const j = (await viewerCall(viewer, 'toggle_like', { target_type: type, target_id: id })) as { liked?: boolean; n?: number };
      return { liked: !!j.liked, n: Number(j.n ?? 0) };
    },
    async moderateStory(id, action) {
      if (action === 'delete') check(await sb.from('stories').delete().eq('id', id));
      else check(await sb.from('stories').update({ status: action === 'approve' ? 'approved' : 'rejected' }).eq('id', id));
    },
    async createPoll(p) {
      const options = p.options.map((o) => o.trim()).filter(Boolean).slice(0, 4);
      if (!p.question.trim() || options.length < 2) throw new Error('צריך שאלה ולפחות 2 אפשרויות');
      check(await sb.rpc('open_poll', { p_question: p.question.trim(), p_options: options, p_minutes: Math.max(1, p.minutes), p_x: p.x, p_y: p.y }));
    },
    async closePoll(id) {
      check(await sb.rpc('close_poll', { p_id: id }));
    },
    async deletePoll(id) {
      check(await sb.from('polls').delete().eq('id', id));
    },
    async vote(viewer, pollId, option) {
      await viewerCall(viewer, 'vote', { poll_id: pollId, option });
    },
    loadComments,
    subscribeComments(cb, includeHidden = false) {
      let timer: number | undefined;
      const refresh = () => {
        clearTimeout(timer);
        timer = window.setTimeout(() => loadComments(includeHidden).then(cb).catch(console.error), 150 + Math.random() * 600);
      };
      if (!includeHidden && !realtime()) {
        const stop = every(180_000, refresh);
        return () => {
          clearTimeout(timer);
          stop();
        };
      }
      const ch = sb.channel(`comments-${includeHidden ? 'all' : 'pub'}`).on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, refresh).subscribe();
      return () => {
        clearTimeout(timer);
        sb.removeChannel(ch);
      };
    },
    async postComment(viewer, target, targetId, body, parentId) {
      const r = await fetch(fn('kick-comment'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: key },
        body: JSON.stringify({ token: viewer.token, target_type: target, target_id: targetId, body, ...(parentId ? { parent_id: parentId } : {}) }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? 'התגובה לא נשלחה. נסו שוב.');
    },
    async moderateComment(id, action) {
      if (action === 'delete') check(await sb.from('comments').delete().eq('id', id));
      else check(await sb.from('comments').update({ hidden: action === 'hide' }).eq('id', id));
    },
    async banUser(kickUserId, username) {
      check(await sb.from('comment_bans').upsert({ kick_user_id: kickUserId, username }));
      check(await sb.from('comments').update({ hidden: true }).eq('kick_user_id', kickUserId));
    },
    kickLoginUrl(returnTo) {
      return `${fn('kick-auth')}?return=${encodeURIComponent(returnTo)}`;
    },
    loadLive,
    subscribeLive(cb) {
      const timers = new Map<string, number>();
      // כל הצופים מקבלים את אותו אירוע באותו רגע: השהיה אקראית קטנה מפזרת את הבקשות
      const refresh = (table: string) => {
        if (timers.has(table)) return;
        timers.set(table, window.setTimeout(() => {
          timers.delete(table);
          loaders[table]().then(() => cb({ ...live })).catch(console.error);
        }, 150 + Math.random() * (table === 'counter_events' ? 900 : 4000)));
      };
      if (!realtime()) {
        // צופים: סטטוס ומונים כל ~45 שניות, זמני משחק כל ~3 דקות
        const a = every(45_000, () => {
          refresh('live_status');
          refresh('counter_events');
        });
        const b = every(180_000, () => {
          refresh('play_segments');
          refresh('clips');
        });
        return () => {
          timers.forEach((t) => clearTimeout(t));
          a();
          b();
        };
      }
      const ch = sb.channel('live');
      for (const table of Object.keys(loaders)) ch.on('postgres_changes', { event: '*', schema: 'public', table }, () => refresh(table));
      ch.subscribe();
      // גיבוי: גם אם Realtime נופל, הסטטוס והספירות מתרעננים כל 2 דקות
      const poll = window.setInterval(() => {
        refresh('live_status');
        refresh('counter_events');
      }, 120_000);
      return () => {
        timers.forEach((t) => clearTimeout(t));
        clearInterval(poll);
        sb.removeChannel(ch);
      };
    },
    async bump(counter, delta, missionId) {
      check(await sb.rpc('bump', { p_counter: counter, p_delta: delta, p_mission: missionId }));
    },
    load,
    subscribe(cb) {
      let timer: number | undefined;
      const refresh = () => {
        clearTimeout(timer);
        timer = window.setTimeout(() => load().then(cb).catch(console.error), 250);
      };
      if (!realtime()) {
        const stop = every(90_000, refresh);
        return () => {
          clearTimeout(timer);
          stop();
        };
      }
      const ch = sb
        .channel('river')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'missions' }, refresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, refresh)
        .subscribe();
      return () => {
        clearTimeout(timer);
        sb.removeChannel(ch);
      };
    },
    async saveMission(m) {
      const r = await sb.from('missions').upsert(m);
      // מסד שעוד לא עודכן (בלי העמודות של טיוטות/סיום/קליפ) – שומרים בלי השדות החדשים, כדי שהעריכה בלייב לא תיתקע
      if (r.error && /published|finished_at|clip_start|clip_end|column/i.test(r.error.message)) {
        const { published: _p, finished_at: _f, clip_start: _a, clip_end: _b, ...old } = m;
        check(await sb.from('missions').upsert(old));
      } else check(r);
    },
    async deleteMission(id) {
      check(await sb.from('missions').delete().eq('id', id));
    },
    async swap(a, b) {
      const [x, y] = await Promise.all([
        sb.from('missions').update({ order_index: b.order_index }).eq('id', a.id),
        sb.from('missions').update({ order_index: a.order_index }).eq('id', b.id),
      ]);
      check(x);
      check(y);
    },
    async saveSettings(s) {
      check(await sb.from('settings').upsert({ id: 1, ...s }));
    },
    async upload(file) {
      const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
      const path = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}${ext}`;
      check(await sb.storage.from(STORAGE_BUCKET).upload(path, file, { contentType: file.type }));
      return sb.storage.from(STORAGE_BUCKET).getPublicUrl(path).data.publicUrl;
    },
    async isAuthed() {
      return !!getModSession();
    },
    modLogin,
    async signOut() {
      setModSession(null);
      sb.realtime.setAuth(null);
    },
    async listMods() {
      const [st, m] = await Promise.all([sb.from('settings').select('kick_channel, owners').eq('id', 1).maybeSingle(), sb.from('mods').select('kick_username, added_at, last_login').order('added_at')]);
      check(m);
      const owners = [...new Set([...((st.data?.owners as string[] | null) ?? DEFAULT_OWNERS).map(kickName), kickName(st.data?.kick_channel) || 'odedsvr'].filter(Boolean))];
      return [
        ...owners.map((n): ModEntry => ({ kick_username: n, owner: true, added_at: null, last_login: null })),
        ...((m.data ?? []) as ModEntry[]).filter((x) => !owners.includes(x.kick_username)).map((x) => ({ ...x, owner: false })),
      ];
    },
    async addMod(name) {
      const n = kickName(name);
      if (!n) throw new Error('שם משתמש לא תקין');
      check(await sb.from('mods').upsert({ kick_username: n }, { onConflict: 'kick_username', ignoreDuplicates: true }));
    },
    async removeMod(name) {
      check(await sb.from('mods').delete().eq('kick_username', kickName(name)));
    },
  };
}

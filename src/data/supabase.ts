import { createClient } from '@supabase/supabase-js';
import { STORAGE_BUCKET } from '../config';
import { DEFAULT_SETTINGS, type Clip, type Comment, type CounterEvent, type Data, type LiveData, type LiveStatus, type Mission, type Segment, type Settings, type Store } from './types';

export function createSupabaseStore(url: string, key: string): Store {
  const sb = createClient(url, key);

  const check = <T extends { error: { message: string } | null }>(r: T): T => {
    if (r.error) throw new Error(r.error.message);
    return r;
  };

  async function load(): Promise<Data> {
    const [m, s] = await Promise.all([
      sb.from('missions').select('*').order('order_index'),
      sb.from('settings').select('*').eq('id', 1).maybeSingle(),
    ]);
    check(m);
    check(s);
    const { id: _id, ...settings } = (s.data ?? {}) as Partial<Settings> & { id?: number };
    return {
      missions: (m.data ?? []) as Mission[],
      settings: { ...DEFAULT_SETTINGS, ...settings },
    };
  }

  // לייב: כל טבלה נטענת לבד, כך שעדכון סטטוס כל 2 דקות לא מושך שוב את כל הקליפים
  const live: LiveData = { status: null, segments: [], counters: [], clips: [] };
  const loaders: Record<string, () => Promise<void>> = {
    live_status: async () => {
      live.status = ((await sb.from('live_status').select('*').eq('id', 1).maybeSingle()).data as LiveStatus | null) ?? null;
    },
    play_segments: async () => {
      live.segments = ((await sb.from('play_segments').select('started_at, ended_at').order('started_at').limit(1000)).data ?? []) as Segment[];
    },
    counter_events: async () => {
      const rows = ((await sb.from('counter_totals').select('counter, mission_id, n, last_at').limit(1000)).data ?? []) as Array<{ counter: CounterEvent['counter']; mission_id: string | null; n: number; last_at: string }>;
      live.counters = rows.map((r) => ({ counter: r.counter, mission_id: r.mission_id, delta: r.n, created_at: r.last_at }));
      // האירועים האחרונים עצמם (עם זמן), לפיד הפעילות
      live.recent = ((await sb.from('counter_events').select('counter, delta, mission_id, created_at').order('id', { ascending: false }).limit(80)).data ?? []) as CounterEvent[];
    },
    clips: async () => {
      live.clips = ((await sb.from('clips').select('*').order('created_at', { ascending: false }).limit(500)).data ?? []) as Clip[];
    },
  };
  async function loadLive(): Promise<LiveData> {
    await Promise.all(Object.values(loaders).map((f) => f()));
    return { ...live };
  }

  const fn = (name: string) => `${url}/functions/v1/${name}`;
  async function loadComments(includeHidden = false): Promise<Comment[]> {
    let q = sb.from('comments').select('*').order('created_at', { ascending: true }).limit(2000);
    if (!includeHidden) q = q.eq('hidden', false);
    return ((await q).data ?? []) as Comment[];
  }

  return {
    mode: 'supabase',
    loadComments,
    subscribeComments(cb, includeHidden = false) {
      let timer: number | undefined;
      const refresh = () => {
        clearTimeout(timer);
        timer = window.setTimeout(() => loadComments(includeHidden).then(cb).catch(console.error), 150 + Math.random() * 600);
      };
      const ch = sb.channel(`comments-${includeHidden ? 'all' : 'pub'}`).on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, refresh).subscribe();
      return () => {
        clearTimeout(timer);
        sb.removeChannel(ch);
      };
    },
    async postComment(viewer, target, targetId, body) {
      const r = await fetch(fn('kick-comment'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: key },
        body: JSON.stringify({ token: viewer.token, target_type: target, target_id: targetId, body }),
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
      check(await sb.from('missions').upsert(m));
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
      return !!(await sb.auth.getSession()).data.session;
    },
    async signIn(email, password) {
      check(await sb.auth.signInWithPassword({ email, password }));
    },
    async signOut() {
      await sb.auth.signOut();
    },
  };
}

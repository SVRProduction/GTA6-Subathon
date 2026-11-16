// מצב האתר: חנות אחת, נתונים, לייב ותגובות, עם מאזינים
import { createStore } from '../data/store';
import { DEFAULT_SETTINGS, type Comment, type Data, type LiveData } from '../data/types';

export const store = createStore();

export const state: {
  data: Data;
  loaded: boolean;
  live: LiveData | null;
  comments: Comment[];
} = {
  data: { missions: [], settings: { ...DEFAULT_SETTINGS } },
  loaded: false,
  live: null,
  comments: [],
};

type Ev = 'data' | 'live' | 'comments';
const subs: Record<Ev, Set<() => void>> = { data: new Set(), live: new Set(), comments: new Set() };
export const on = (e: Ev, f: () => void) => {
  subs[e].add(f);
  return () => subs[e].delete(f);
};
const emit = (e: Ev) => subs[e].forEach((f) => f());

const sortM = (d: Data) => ({ ...d, missions: [...d.missions].sort((a, b) => a.order_index - b.order_index) });

/** טעינה: הדרך מגיעה מ-load() לבד; לייב וקליפים מצטרפים כשהם מגיעים (fetch ל-Kick יכול להיתקע) */
export async function boot() {
  store.subscribe((d) => {
    state.data = sortM(d);
    state.loaded = true;
    emit('data');
  });
  store.subscribeLive((l) => {
    state.live = l;
    emit('live');
  });
  store.subscribeComments((c) => {
    state.comments = c;
    emit('comments');
  });

  try {
    state.data = sortM(await store.load());
  } catch (e) {
    console.warn('load failed', e);
  }
  state.loaded = true;
  emit('data');

  store.loadComments().then(
    (c) => {
      state.comments = c;
      emit('comments');
    },
    () => {},
  );

  store.loadLive().then(
    (l) => {
      state.live = l;
      emit('live');
    },
    (e) => console.warn('live failed', e),
  );
}

export const commentsFor = (type: Comment['target_type'], id: string) =>
  state.comments.filter((c) => c.target_type === type && c.target_id === id && !c.hidden);

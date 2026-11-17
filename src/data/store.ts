import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../config';
import { createDemoStore } from './demo';
import { createSupabaseStore } from './supabase';
import type { Store } from './types';

export function createStore(): Store {
  // ‎?demo: תצוגה עם נתוני דמו (רק בדפדפן הזה, לא נוגע במסד)
  const demo = typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo');
  return !demo && SUPABASE_URL && SUPABASE_ANON_KEY
    ? createSupabaseStore(SUPABASE_URL, SUPABASE_ANON_KEY)
    : createDemoStore();
}

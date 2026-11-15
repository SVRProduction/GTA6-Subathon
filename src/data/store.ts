import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../config';
import { createDemoStore } from './demo';
import { createSupabaseStore } from './supabase';
import type { Store } from './types';

export function createStore(): Store {
  return SUPABASE_URL && SUPABASE_ANON_KEY
    ? createSupabaseStore(SUPABASE_URL, SUPABASE_ANON_KEY)
    : createDemoStore();
}

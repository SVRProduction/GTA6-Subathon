-- להריץ פעם אחת ב-Supabase: SQL Editor → New query → Run

create table if not exists public.missions (
  id uuid primary key,
  order_index integer not null default 0,
  title text not null default '',
  summary text not null default '',
  body text not null default '',
  kind text not null default 'mission' check (kind in ('mission', 'moment')),
  is_milestone boolean not null default false,
  happened_at timestamptz,
  stream_day integer,
  recap_url text,
  download_url text,
  image_url text
);

create table if not exists public.settings (
  id integer primary key check (id = 1),
  title text not null default 'סאבתון GTA 6',
  kick_channel text not null default '',
  started_at timestamptz,
  current_mission_id uuid,
  is_live boolean not null default false
);

insert into public.settings (id) values (1) on conflict do nothing;

-- הרשאות: כולם קוראים, רק משתמש מחובר (אדמין/מוד) כותב
alter table public.missions enable row level security;
alter table public.settings enable row level security;

drop policy if exists "read missions" on public.missions;
create policy "read missions" on public.missions for select using (true);
drop policy if exists "write missions" on public.missions;
create policy "write missions" on public.missions for all to authenticated using (true) with check (true);
drop policy if exists "read settings" on public.settings;
create policy "read settings" on public.settings for select using (true);
drop policy if exists "write settings" on public.settings;
create policy "write settings" on public.settings for all to authenticated using (true) with check (true);

-- עדכון חי לצופים
do $$ begin
  alter publication supabase_realtime add table public.missions;
  alter publication supabase_realtime add table public.settings;
exception when duplicate_object then null; end $$;

-- אחסון קבצי ריקאפ (ציבורי לקריאה, העלאה רק למחוברים)
insert into storage.buckets (id, name, public) values ('recaps', 'recaps', true) on conflict do nothing;
drop policy if exists "read recaps" on storage.objects;
create policy "read recaps" on storage.objects for select using (bucket_id = 'recaps');
drop policy if exists "upload recaps" on storage.objects;
create policy "upload recaps" on storage.objects for insert to authenticated with check (bucket_id = 'recaps');

-- ── שדרוג: מפה, פרקים וציטוטים (אפשר להריץ שוב בבטחה) ──
alter table public.missions add column if not exists map_x double precision;
alter table public.missions add column if not exists map_y double precision;
alter table public.missions add column if not exists chapter text;
alter table public.missions add column if not exists quote text;
alter table public.missions add column if not exists quote_by text;
alter table public.settings add column if not exists map_image_url text;
alter table public.settings add column if not exists map_zoom double precision not null default 3;

-- ── לייב, זמן משחק, ספירות וקליפים (אפשר להריץ שוב בבטחה) ──
alter table public.settings add column if not exists kick_category text not null default 'grand-theft-auto-vi';
alter table public.settings alter column kick_channel set default 'odedsvr';
update public.settings set kick_channel = 'odedsvr' where kick_channel = '';

-- הסטטוס האחרון מ-Kick (שורה אחת). נכתב רק ע"י הפונקציה kick-sync
create table if not exists public.live_status (
  id integer primary key check (id = 1),
  is_live boolean not null default false,
  on_category boolean not null default false,
  category text,
  title text,
  viewers integer,
  stream_id text,
  checked_at timestamptz
);
insert into public.live_status (id) values (1) on conflict do nothing;

-- מקטעי משחק בקטגוריה: מתארכים בכל בדיקה; הפסקה של יותר מ-6 דקות פותחת מקטע חדש
create table if not exists public.play_segments (
  id bigint generated always as identity primary key,
  stream_id text,
  started_at timestamptz not null,
  ended_at timestamptz not null
);

-- ספירות (מוות / חתולים): כל לחיצה היא שורה, כך שיש ביטול, היסטוריה וספירה לפי משימה
create table if not exists public.counter_events (
  id bigint generated always as identity primary key,
  counter text not null check (counter in ('deaths', 'cats')),
  delta integer not null check (delta in (-1, 1)),
  mission_id uuid,
  source text not null default 'button',
  source_id text unique, -- מזהה הודעת הצ'אט, כדי לא לספור פעמיים
  created_at timestamptz not null default now()
);

-- קליפים מהקטגוריה
create table if not exists public.clips (
  id text primary key,
  title text not null default '',
  thumbnail_url text,
  video_url text,
  duration integer,
  views integer not null default 0,
  creator text,
  created_at timestamptz not null
);

alter table public.live_status enable row level security;
alter table public.play_segments enable row level security;
alter table public.counter_events enable row level security;
alter table public.clips enable row level security;
drop policy if exists "read live" on public.live_status;
drop policy if exists "read segments" on public.play_segments;
drop policy if exists "read counters" on public.counter_events;
drop policy if exists "read clips" on public.clips;
drop policy if exists "write segments" on public.play_segments;
drop policy if exists "write clips" on public.clips;
create policy "read live" on public.live_status for select using (true);
create policy "read segments" on public.play_segments for select using (true);
create policy "read counters" on public.counter_events for select using (true);
create policy "read clips" on public.clips for select using (true);
-- תיקון ידני מהאדמין (מחיקת מקטע שגוי / קליפ)
create policy "write segments" on public.play_segments for all to authenticated using (true) with check (true);
create policy "write clips" on public.clips for all to authenticated using (true) with check (true);

-- סיכום הספירות לפי מונה ומשימה (האתר קורא את זה, לא את כל השורות – אחרת זה נעצר במגבלת 1000 שורות)
create or replace view public.counter_totals with (security_invoker = true) as
  select counter, mission_id, sum(delta)::integer as n, max(created_at) as last_at
  from public.counter_events group by counter, mission_id;
grant select on public.counter_totals to anon, authenticated;

-- ספירה: רק אדמין/מוד מחובר, בפעולה אחת (בלי "לקרוא ולכתוב חזרה")
create or replace function public.bump(p_counter text, p_delta integer, p_mission uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.counter_events (counter, delta, mission_id, source) values (p_counter, p_delta, p_mission, 'button');
$$;
revoke all on function public.bump(text, integer, uuid) from public, anon;
grant execute on function public.bump(text, integer, uuid) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.live_status;
  alter publication supabase_realtime add table public.play_segments;
  alter publication supabase_realtime add table public.counter_events;
  alter publication supabase_realtime add table public.clips;
exception when duplicate_object then null; end $$;

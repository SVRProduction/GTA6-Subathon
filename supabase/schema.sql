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

-- ── מודים: מתחברים עם Kick, וההרשאה לפי רשימה (אפשר להריץ שוב בבטחה) ──
-- הבעלים: הערוץ עצמו (kick_channel) + הרשימה settings.owners. הם תמיד מודים, ורק הם מנהלים את רשימת המודים.
-- הטוקן של מוד מונפק ע"י הפונקציה kick-mod (role=authenticated, kick_name=שם המשתמש ב-Kick).
alter table public.settings add column if not exists owners text[] not null default '{odedsvr,zswolt}';

create table if not exists public.mods (
  kick_username text primary key check (kick_username = lower(kick_username) and kick_username <> ''),
  kick_user_id text,
  added_at timestamptz not null default now(),
  last_login timestamptz
);

-- שם המשתמש ב-Kick מתוך הטוקן (אותיות קטנות; ריק = לא מוד)
create or replace function public.jwt_kick_name() returns text language sql stable as $$
  select lower(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'kick_name', ''));
$$;
create or replace function public.jwt_role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
$$;
-- שם ערוץ נקי (גם אם נשמר קישור מלא)
create or replace function public.kick_slug(p text) returns text language sql immutable as $$
  select lower(regexp_replace(regexp_replace(coalesce(p, ''), '^.*kick\.com/', ''), '[^A-Za-z0-9_-]', '', 'g'));
$$;
create or replace function public.owner_names() returns text[] language plpgsql stable security definer set search_path = public as $$
declare s public.settings;
begin
  select * into s from public.settings where id = 1;
  return array(select distinct lower(x) from unnest(coalesce(s.owners, '{}'::text[]) || array[coalesce(nullif(public.kick_slug(s.kick_channel), ''), 'odedsvr')]) x where x <> '');
end $$;
create or replace function public.is_owner() returns boolean language plpgsql stable security definer set search_path = public as $$
declare n text := public.jwt_kick_name();
begin
  if public.jwt_role() = 'service_role' then return true; end if;
  return n <> '' and n = any (public.owner_names());
end $$;
create or replace function public.is_mod() returns boolean language plpgsql stable security definer set search_path = public as $$
declare n text := public.jwt_kick_name();
begin
  if public.jwt_role() = 'service_role' then return true; end if;
  if n = '' then return false; end if;
  return public.is_owner() or exists (select 1 from public.mods where kick_username = n);
end $$;
grant execute on function public.is_mod() to anon, authenticated;
grant execute on function public.is_owner() to anon, authenticated;

alter table public.mods enable row level security;
drop policy if exists "mods read" on public.mods;
drop policy if exists "owners write mods" on public.mods;
create policy "mods read" on public.mods for select to authenticated using (public.is_mod());
create policy "owners write mods" on public.mods for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- מוד לא יכול להפוך את עצמו לבעלים: רק בעלים משנים את הערוץ ואת רשימת הבעלים
create or replace function public.guard_settings() returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- בלי טוקן (SQL Editor של Supabase) מותר; דרך האתר – רק בעלים
  if (new.kick_channel is distinct from old.kick_channel or new.owners is distinct from old.owners) and public.jwt_role() <> '' and not public.is_owner() then
    raise exception 'רק הבעלים יכולים לשנות את הערוץ ואת רשימת הבעלים';
  end if;
  new.owners := array(select distinct lower(x) from unnest(new.owners) x where x <> '');
  return new;
end $$;
drop trigger if exists guard_settings on public.settings;
create trigger guard_settings before update on public.settings for each row execute function public.guard_settings();

-- הרשאות: כולם קוראים, רק משתמש מחובר (אדמין/מוד) כותב
alter table public.missions enable row level security;
alter table public.settings enable row level security;

drop policy if exists "read missions" on public.missions;
create policy "read missions" on public.missions for select using (true);
drop policy if exists "write missions" on public.missions;
create policy "write missions" on public.missions for all to authenticated using (public.is_mod()) with check (public.is_mod());
drop policy if exists "read settings" on public.settings;
create policy "read settings" on public.settings for select using (true);
drop policy if exists "write settings" on public.settings;
create policy "write settings" on public.settings for all to authenticated using (public.is_mod()) with check (public.is_mod());

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
create policy "upload recaps" on storage.objects for insert to authenticated with check (bucket_id = 'recaps' and public.is_mod());

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
create policy "write segments" on public.play_segments for all to authenticated using (public.is_mod()) with check (public.is_mod());
create policy "write clips" on public.clips for all to authenticated using (public.is_mod()) with check (public.is_mod());

-- סיכום הספירות לפי מונה ומשימה (האתר קורא את זה, לא את כל השורות – אחרת זה נעצר במגבלת 1000 שורות)
create or replace view public.counter_totals with (security_invoker = true) as
  select counter, mission_id, sum(delta)::integer as n, max(created_at) as last_at
  from public.counter_events group by counter, mission_id;
grant select on public.counter_totals to anon, authenticated;

-- ספירה: רק אדמין/מוד מחובר, בפעולה אחת (בלי "לקרוא ולכתוב חזרה")
create or replace function public.bump(p_counter text, p_delta integer, p_mission uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_mod() then raise exception 'רק מודים יכולים לספור'; end if;
  insert into public.counter_events (counter, delta, mission_id, source) values (p_counter, p_delta, p_mission, 'button');
end $$;
revoke all on function public.bump(text, integer, uuid) from public, anon;
grant execute on function public.bump(text, integer, uuid) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.live_status;
  alter publication supabase_realtime add table public.play_segments;
  alter publication supabase_realtime add table public.counter_events;
  alter publication supabase_realtime add table public.clips;
exception when duplicate_object then null; end $$;

-- ── תגובות של צופים (מחוברים עם Kick) על עצירות וקליפים (אפשר להריץ שוב בבטחה) ──
-- כתיבה רק דרך הפונקציה kick-comment (שבודקת את כרטיס ההתחברות, חסימות וקצב); קריאה – לכולם
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('stop', 'clip')),
  target_id text not null,
  kick_user_id text not null,
  username text not null,
  avatar text,
  body text not null check (char_length(body) between 1 and 500),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists comments_target on public.comments (target_type, target_id);
create index if not exists comments_user_time on public.comments (kick_user_id, created_at desc);

create table if not exists public.comment_bans (
  kick_user_id text primary key,
  username text,
  created_at timestamptz not null default now()
);

alter table public.comments enable row level security;
alter table public.comment_bans enable row level security;
drop policy if exists "read comments" on public.comments;
drop policy if exists "read all comments (mods)" on public.comments;
drop policy if exists "moderate comments" on public.comments;
drop policy if exists "delete comments" on public.comments;
drop policy if exists "mods bans" on public.comment_bans;
create policy "read comments" on public.comments for select using (hidden = false);
create policy "read all comments (mods)" on public.comments for select to authenticated using (public.is_mod());
create policy "moderate comments" on public.comments for update to authenticated using (public.is_mod()) with check (public.is_mod());
create policy "delete comments" on public.comments for delete to authenticated using (public.is_mod());
create policy "mods bans" on public.comment_bans for all to authenticated using (public.is_mod()) with check (public.is_mod());

do $$ begin
  alter publication supabase_realtime add table public.comments;
exception when duplicate_object then null; end $$;

-- ══ גרסה 6: מרקרים חופשיים, סטוריז של צופים, סקרים (אפשר להריץ שוב בבטחה) ══
-- תגובות גם על מרקרים וסטוריז
alter table public.comments drop constraint if exists comments_target_type_check;
alter table public.comments add constraint comments_target_type_check check (target_type in ('stop', 'clip', 'marker', 'story'));

-- מרקר חופשי: בכל מקום במפה (לא מחובר למסלול). כתיבה – רק מודים
create table if not exists public.markers (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('death', 'car', 'weapon', 'property', 'heist', 'chase', 'moment', 'decision', 'custom')),
  x double precision not null check (x between -0.5 and 1.5),
  y double precision not null check (y between -0.5 and 1.5),
  title text not null default '' check (char_length(title) <= 80),
  body text not null default '' check (char_length(body) <= 600),
  emoji text check (char_length(emoji) <= 16),
  image_url text,
  mission_id uuid,
  created_at timestamptz not null default now()
);

-- סטורי של צופה: נכנס כ-pending, מופיע רק אחרי אישור מוד, ונעלם אחרי 48 שעות.
-- כתיבה רק דרך הפונקציה kick-viewer (שבודקת את כרטיס ההתחברות של Kick, חסימות וקצב)
create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  kick_user_id text not null,
  username text not null,
  avatar text,
  image_url text not null,
  caption text not null default '' check (char_length(caption) <= 160),
  mission_id uuid,
  x double precision,
  y double precision,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  likes integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '48 hours'
);
create index if not exists stories_user_time on public.stories (kick_user_id, created_at desc);
create table if not exists public.story_likes (
  story_id uuid not null references public.stories (id) on delete cascade,
  kick_user_id text not null,
  created_at timestamptz not null default now(),
  primary key (story_id, kick_user_id)
);

-- סקר: מוד פותח, מצביעים ב-!1..!4 בצ'אט של Kick או באתר; קול אחד לכל משתמש Kick (אפשר לשנות)
create table if not exists public.polls (
  id uuid primary key default gen_random_uuid(),
  question text not null check (char_length(question) between 1 and 120),
  options text[] not null check (array_length(options, 1) between 2 and 4),
  x double precision,
  y double precision,
  status text not null default 'open' check (status in ('open', 'closed')),
  ends_at timestamptz not null,
  winner integer,
  created_at timestamptz not null default now()
);
create table if not exists public.poll_votes (
  poll_id uuid not null references public.polls (id) on delete cascade,
  kick_user_id text not null,
  option integer not null check (option between 0 and 3),
  source text not null default 'site',
  updated_at timestamptz not null default now(),
  primary key (poll_id, kick_user_id)
);
-- תוצאות בלי לחשוף מי הצביע (התצוגה רצה בהרשאות הבעלים)
create or replace view public.poll_results as
  select poll_id, option, count(*)::integer as n from public.poll_votes group by poll_id, option;
grant select on public.poll_results to anon, authenticated;

alter table public.markers enable row level security;
alter table public.stories enable row level security;
alter table public.story_likes enable row level security;
alter table public.polls enable row level security;
alter table public.poll_votes enable row level security;
drop policy if exists "read markers" on public.markers;
drop policy if exists "mods markers" on public.markers;
drop policy if exists "read approved stories" on public.stories;
drop policy if exists "mods stories" on public.stories;
drop policy if exists "read polls" on public.polls;
drop policy if exists "mods polls" on public.polls;
create policy "read markers" on public.markers for select using (true);
create policy "mods markers" on public.markers for all to authenticated using (public.is_mod()) with check (public.is_mod());
create policy "read approved stories" on public.stories for select using (status = 'approved' and expires_at > now());
create policy "mods stories" on public.stories for all to authenticated using (public.is_mod()) with check (public.is_mod());
create policy "read polls" on public.polls for select using (true);
create policy "mods polls" on public.polls for all to authenticated using (public.is_mod()) with check (public.is_mod());
-- poll_votes ו-story_likes: אין מדיניות קריאה/כתיבה לציבור – רק הפונקציות (service role) והתצוגה

-- פתיחת סקר (מוד): סקר פתוח קודם נסגר קודם
create or replace function public.open_poll(p_question text, p_options text[], p_minutes integer, p_x double precision, p_y double precision)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; r record;
begin
  if not public.is_mod() then raise exception 'רק מודים יכולים לפתוח סקר'; end if;
  for r in select id from public.polls where status = 'open' loop perform public.close_poll(r.id); end loop;
  insert into public.polls (question, options, x, y, ends_at)
    values (p_question, p_options, p_x, p_y, now() + make_interval(mins => greatest(1, least(p_minutes, 180))))
    returning id into v_id;
  return v_id;
end $$;

-- סגירת סקר: מנצח לפי הכי הרבה קולות; אם לסקר יש מיקום – נוצר מרקר "החלטת הצ'אט"
create or replace function public.close_poll(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p public.polls; v_win integer; v_best integer; v_total integer; v_mission uuid;
begin
  -- מוד, או השרת (kick-sync סוגר סקרים שנגמר להם הזמן)
  if not public.is_mod() then raise exception 'רק מודים יכולים לסגור סקר'; end if;
  select * into p from public.polls where id = p_id for update;
  if not found or p.status = 'closed' then return; end if;
  select option, n into v_win, v_best from public.poll_results where poll_id = p_id order by n desc, option asc limit 1;
  select coalesce(sum(n), 0) into v_total from public.poll_results where poll_id = p_id;
  update public.polls set status = 'closed', winner = v_win, ends_at = least(ends_at, now()) where id = p_id;
  if v_win is not null and p.x is not null and p.y is not null then
    select coalesce(current_mission_id, (select id from public.missions order by order_index desc limit 1)) into v_mission from public.settings where id = 1;
    insert into public.markers (type, x, y, title, body, mission_id)
      values ('decision', p.x, p.y, 'הצ׳אט החליט: ' || p.options[v_win + 1],
              'סקר: "' || p.question || '" – "' || p.options[v_win + 1] || '" ניצח עם ' || round(v_best * 100.0 / greatest(v_total, 1)) || '% מהקולות.', v_mission);
  end if;
end $$;
revoke all on function public.open_poll(text, text[], integer, double precision, double precision) from public, anon;
revoke all on function public.close_poll(uuid) from public, anon;
grant execute on function public.open_poll(text, text[], integer, double precision, double precision) to authenticated;
grant execute on function public.close_poll(uuid) to authenticated;

-- לייק לסטורי (נקרא מהפונקציה kick-viewer): פעם אחת לכל משתמש
create or replace function public.like_story(p_story uuid, p_user text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.story_likes (story_id, kick_user_id) values (p_story, p_user) on conflict do nothing;
  if found then update public.stories set likes = likes + 1 where id = p_story; end if;
end $$;
revoke all on function public.like_story(uuid, text) from public, anon, authenticated;

-- תמונות הסטוריז (ציבורי לקריאה; העלאה רק מהפונקציה)
insert into storage.buckets (id, name, public) values ('stories', 'stories', true) on conflict do nothing;
drop policy if exists "read stories images" on storage.objects;
create policy "read stories images" on storage.objects for select using (bucket_id = 'stories');

do $$ begin alter publication supabase_realtime add table public.markers; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.stories; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.polls; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.poll_votes; exception when duplicate_object then null; end $$;

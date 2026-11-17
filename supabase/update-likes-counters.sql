-- עדכון: ספירות חדשות (נעצר / נכשל) ולייקים לעצירות, מיילסטונים וקליפים.
-- להריץ פעם אחת ב-SQL Editor של Supabase. בטוח להריץ שוב.

-- 1) ספירות: מוות, נעצר, משימה שנכשלה (חתולים נשאר רק בשביל היסטוריה)
alter table public.counter_events drop constraint if exists counter_events_counter_check;
alter table public.counter_events add constraint counter_events_counter_check check (counter in ('deaths', 'cats', 'arrests', 'fails'));

-- 2) לייקים: אחד לכל משתמש Kick על כל עצירה / קליפ / סטורי
create table if not exists public.likes (
  target_type text not null check (target_type in ('stop', 'clip', 'story')),
  target_id text not null check (char_length(target_id) <= 80),
  kick_user_id text not null,
  created_at timestamptz not null default now(),
  primary key (target_type, target_id, kick_user_id)
);
alter table public.likes enable row level security;
-- אין קריאה/כתיבה ישירה לציבור: רק הספירה (התצוגה) והפונקציה kick-viewer

create or replace view public.like_totals as
  select target_type, target_id, count(*)::integer as n from public.likes group by target_type, target_id;
grant select on public.like_totals to anon, authenticated;

-- לייק / ביטול לייק. מחזיר אם עכשיו יש לייק ואת הספירה
create or replace function public.toggle_like(p_type text, p_id text, p_user text)
returns table (liked boolean, n integer) language plpgsql security definer set search_path = public as $$
begin
  delete from public.likes where target_type = p_type and target_id = p_id and kick_user_id = p_user;
  if found then
    liked := false;
  else
    insert into public.likes (target_type, target_id, kick_user_id) values (p_type, p_id, p_user);
    liked := true;
  end if;
  select count(*)::integer into n from public.likes where target_type = p_type and target_id = p_id;
  return next;
end $$;
revoke all on function public.toggle_like(text, text, text) from public, anon, authenticated;

-- מה המשתמש עשה לו לייק (כדי לצבוע את הלב) – רק דרך kick-viewer
create or replace function public.my_likes(p_user text)
returns table (target_type text, target_id text) language sql stable security definer set search_path = public as $$
  select target_type, target_id from public.likes where kick_user_id = p_user;
$$;
revoke all on function public.my_likes(text) from public, anon, authenticated;

-- תגובה לתגובה + התראות לטלפון. להריץ פעם אחת ב-SQL Editor של Supabase.
-- לפני ההרצה: להחליף את <CRON_SECRET> (שתי פעמים, למטה) באותו ערך של הסוד CRON_SECRET שכבר הוגדר ל-kick-sync.
-- בטוח להריץ שוב.

-- ── 1. תגובה לתגובה ──
alter table public.comments add column if not exists parent_id uuid references public.comments (id) on delete cascade;
create index if not exists comments_parent on public.comments (parent_id);

-- ── 2. הרשמות להתראות (רק השרת קורא וכותב: אין גישה לצופים) ──
create table if not exists public.push_subs (
  endpoint text primary key check (char_length(endpoint) <= 800),
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subs enable row level security;

-- מתי נשלחה התראה אחרונה מכל סוג (כדי לא להציף: לכל היותר אחת בדקה)
create table if not exists public.push_log (
  kind text primary key,
  sent_at timestamptz not null
);
alter table public.push_log enable row level security;

-- ── 3. טריגרים: משימה חדשה / סטורי שאושר → הפונקציה push-send ──
create extension if not exists pg_net;

create or replace function public.push_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  kind text;
begin
  if tg_table_name = 'missions' then
    kind := 'mission';
  elsif tg_table_name = 'stories' then
    -- רק כשהסטורי נהיה מאושר (בהוספה או בעדכון)
    if new.status <> 'approved' or (tg_op = 'UPDATE' and old.status = 'approved') then
      return new;
    end if;
    kind := 'story';
  else
    return new;
  end if;
  perform net.http_post(
    url := 'https://wpjrfrhfeljnbgsibewk.supabase.co/functions/v1/push-send',
    headers := '{"Content-Type": "application/json", "x-cron-secret": "<CRON_SECRET>"}'::jsonb,
    body := jsonb_build_object('kind', kind, 'id', new.id)
  );
  return new;
end;
$$;

drop trigger if exists push_mission on public.missions;
create trigger push_mission after insert on public.missions for each row execute function public.push_notify();

drop trigger if exists push_story on public.stories;
create trigger push_story after insert or update of status on public.stories for each row execute function public.push_notify();

-- בדיקה ידנית (אחרי שהכול פרוס): שולח התראת ניסיון לכל הרשומים
-- select net.http_post(
--   url := 'https://wpjrfrhfeljnbgsibewk.supabase.co/functions/v1/push-send',
--   headers := '{"Content-Type": "application/json", "x-cron-secret": "<CRON_SECRET>"}'::jsonb,
--   body := '{"kind": "test"}'::jsonb
-- );

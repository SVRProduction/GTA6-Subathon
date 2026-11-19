-- קליפים מהלייב (נשמרים אצלנו), טיוטות, סיום משימה. להריץ פעם אחת ב-SQL Editor של Supabase.
-- לפני ההרצה: להחליף את <CRON_SECRET> (מופיע 2 פעמים, למטה) באותו ערך של הסוד CRON_SECRET.
-- בטוח להריץ שוב.

-- ── 1. עמודות חדשות ──
alter table public.missions add column if not exists published boolean not null default true;
alter table public.missions add column if not exists finished_at timestamptz;
alter table public.missions add column if not exists clip_start text check (clip_start is null or char_length(clip_start) <= 12);
alter table public.missions add column if not exists clip_end text check (clip_end is null or char_length(clip_end) <= 12);
alter table public.clips add column if not exists mission_id uuid;
alter table public.clips add column if not exists source text not null default 'kick';
alter table public.clips add column if not exists archived_url text;

-- ── 2. טיוטות: צופים רואים רק עצירות שפורסמו; עורכים רואים הכול ──
drop policy if exists "read missions" on public.missions;
drop policy if exists "read published missions" on public.missions;
create policy "read published missions" on public.missions for select using (published or public.is_mod());

-- ── 3. אחסון הקליפים (ציבורי לקריאה; רק השרת כותב) ──
insert into storage.buckets (id, name, public) values ('clips', 'clips', true) on conflict do nothing;
drop policy if exists "read clips files" on storage.objects;
create policy "read clips files" on storage.objects for select using (bucket_id = 'clips');

-- ── 4. טריגרים → הפונקציות clip-make ו-push-send ──
create extension if not exists pg_net;

create or replace function public.call_fn(fn text, payload jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://wpjrfrhfeljnbgsibewk.supabase.co/functions/v1/' || fn,
    headers := '{"Content-Type": "application/json", "x-cron-secret": "<CRON_SECRET>"}'::jsonb,
    body := payload,
    timeout_milliseconds := 5000
  );
end;
$$;
revoke all on function public.call_fn(text, jsonb) from public, anon, authenticated;

-- משימות: התראה "משימה נגמרה" כשמסיימים (finished_at); עצירה חדשה מסיימת את הקודמת; פרסום מיילסטון; קליפ לפי הזמנים בכרטיס
create or replace function public.mission_events() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.published then
    -- עצירה חדשה שפורסמה: הקודמת שעוד לא נסגרה נגמרת עכשיו
    update public.missions set finished_at = now()
      where id <> new.id and published and finished_at is null and order_index < new.order_index;
  end if;
  if tg_op = 'UPDATE' and new.finished_at is not null and old.finished_at is null then
    perform public.call_fn('push-send', jsonb_build_object('kind', 'mission', 'id', new.id));
  end if;
  if tg_op = 'UPDATE' and new.published and not old.published then
    perform public.call_fn('push-send', jsonb_build_object('kind', 'publish', 'id', new.id));
  end if;
  if new.clip_start is not null and new.clip_end is not null
     and (tg_op = 'INSERT' or new.clip_start is distinct from old.clip_start or new.clip_end is distinct from old.clip_end) then
    perform public.call_fn('clip-make', jsonb_build_object('mode', 'range', 'mission_id', new.id));
  end if;
  return new;
end;
$$;
drop trigger if exists push_mission on public.missions;
drop trigger if exists mission_events on public.missions;
create trigger mission_events after insert or update on public.missions for each row execute function public.mission_events();

-- !מת → קליפ של 45 השניות האחרונות, לעצירה הנוכחית
create or replace function public.death_clip() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.counter = 'deaths' and new.delta > 0 then
    perform public.call_fn('clip-make', jsonb_build_object('mode', 'moment', 'at', new.created_at, 'mission_id', new.mission_id, 'label', 'עודד מת 💀'));
  end if;
  return new;
end;
$$;
drop trigger if exists death_clip on public.counter_events;
create trigger death_clip after insert on public.counter_events for each row execute function public.death_clip();

-- קליפ חדש מ-Kick → שומרים עותק אצלנו (כדי שלא ייעלם)
create or replace function public.archive_clip() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.source = 'kick' and new.archived_url is null then
    perform public.call_fn('clip-make', jsonb_build_object('mode', 'archive', 'clip_id', new.id));
  end if;
  return new;
end;
$$;
drop trigger if exists archive_clip on public.clips;
create trigger archive_clip after insert on public.clips for each row execute function public.archive_clip();

-- (אופציונלי) לשמור גם את הקליפים של Kick שכבר קיימים – להריץ פעם אחת:
-- select public.call_fn('clip-make', jsonb_build_object('mode', 'archive', 'clip_id', id)) from public.clips where source = 'kick' and archived_url is null;

-- קליפים, חלק 2: קליפים עצמאיים (מוות/מעצר/כישלון כשאין משימה פעילה), ביטול, ו"צפה בקטע" מההקלטה בקיק.
-- להריץ פעם אחת ב-SQL Editor של Supabase, אחרי update-clips-drafts.sql. אין כאן סודות להחליף. בטוח להריץ שוב.

alter table public.clips add column if not exists category text check (category is null or category in ('death', 'arrest', 'fail'));
alter table public.clips add column if not exists kind text;
alter table public.clips add column if not exists vod_url text;
alter table public.clips add column if not exists vod_from integer;
alter table public.clips add column if not exists vod_to integer;

-- קליפים שכבר נוצרו: סוג וקטגוריה
update public.clips set kind = 'moment', category = 'death' where source = 'own' and kind is null and title like 'עודד מת%';
update public.clips set kind = 'range' where source = 'own' and kind is null;
-- קליפים שנכנסו בטעות למשימה שכבר הסתיימה לפניהם – מנותקים ממנה
update public.clips c set mission_id = null
  from public.missions m
  where c.mission_id = m.id and m.finished_at is not null and c.created_at > m.finished_at and coalesce(c.kind, '') <> 'range';

-- מוות / מעצר / כישלון → קליפ של 45 השניות האחרונות; ביטול (‎-1) → הקליפ נמחק
create or replace function public.death_clip() returns trigger
language plpgsql security definer set search_path = public as $$
declare cat text;
begin
  cat := case new.counter when 'deaths' then 'death' when 'arrests' then 'arrest' when 'fails' then 'fail' else null end;
  if cat is null then return new; end if;
  if new.delta > 0 then
    perform public.call_fn('clip-make', jsonb_build_object('mode', 'moment', 'at', new.created_at, 'mission_id', new.mission_id, 'category', cat));
  else
    perform public.call_fn('clip-make', jsonb_build_object('mode', 'undo', 'category', cat));
  end if;
  return new;
end;
$$;
drop trigger if exists death_clip on public.counter_events;
create trigger death_clip after insert on public.counter_events for each row execute function public.death_clip();

-- לייצר מחדש את קליפי הטווח של העצירות הקיימות (עכשיו: 3 הדקות הראשונות + ניגון הטווח המלא מקיק)
select public.call_fn('clip-make', jsonb_build_object('mode', 'range', 'mission_id', id))
  from public.missions where clip_start is not null and clip_end is not null;

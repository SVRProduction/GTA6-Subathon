-- מטמון משותף לצופים: במקום שכל צופה ישלח ~15 שאילתות (ועוד אחת על כל שינוי),
-- השרת בונה פעם ב-10 שניות 4 שורות מוכנות, וכל צופה קורא שורה אחת.
-- להריץ פעם אחת ב-SQL Editor. אין סודות להחליף. בטוח להריץ שוב.

-- ── 1. הטבלה ──
create table if not exists public.site_cache (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.site_cache enable row level security;
drop policy if exists "read site cache" on public.site_cache;
create policy "read site cache" on public.site_cache for select using (true);
grant select on public.site_cache to anon, authenticated;

-- ── 2. בניית המטמון: בדיוק מה שצופה רואה היום (בלי טיוטות, בלי תגובות מוסתרות, רק סטוריז מאושרים) ──
create or replace function public.refresh_site_cache() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_live jsonb; v_data jsonb; v_clips jsonb; v_comments jsonb;
begin
  v_live := jsonb_build_object(
    'status',   (select to_jsonb(l) from public.live_status l where id = 1),
    'segments', coalesce((select jsonb_agg(jsonb_build_object('started_at', started_at, 'ended_at', ended_at) order by started_at) from (select * from public.play_segments order by started_at limit 1000) s), '[]'),
    'counters', coalesce((select jsonb_agg(to_jsonb(t)) from (select counter, mission_id, n, last_at from public.counter_totals limit 1000) t), '[]'),
    'recent',   coalesce((select jsonb_agg(to_jsonb(e) order by e.id desc) from (select id, counter, delta, mission_id, created_at from public.counter_events order by id desc limit 80) e), '[]'),
    'polls',    coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc) from (select * from public.polls order by created_at desc limit 30) p), '[]'),
    'results',  coalesce((select jsonb_agg(to_jsonb(r)) from (select poll_id, option, n from public.poll_results limit 500) r), '[]'),
    'likes',    coalesce((select jsonb_agg(to_jsonb(k)) from (select target_type, target_id, n from public.like_totals) k), '[]')
  );
  v_data := jsonb_build_object(
    'settings', (select to_jsonb(s) from public.settings s where id = 1),
    'missions', coalesce((select jsonb_agg(to_jsonb(m) order by m.order_index) from public.missions m where m.published), '[]'),
    'markers',  coalesce((select jsonb_agg(to_jsonb(k) order by k.created_at) from (select * from public.markers order by created_at limit 2000) k), '[]'),
    'stories',  coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at desc) from (select * from public.stories where status = 'approved' and expires_at > now() order by created_at desc limit 300) t), '[]')
  );
  v_clips := coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at desc) from (select * from public.clips order by created_at desc limit 500) c), '[]');
  v_comments := coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at) from (select * from public.comments where hidden = false order by created_at limit 2000) c), '[]');

  -- כותבים רק כשמשהו השתנה
  insert into public.site_cache as sc (id, data, updated_at) values
    ('live', v_live, now()), ('data', v_data, now()), ('clips', v_clips, now()), ('comments', v_comments, now())
  on conflict (id) do update set data = excluded.data, updated_at = now()
  where sc.data is distinct from excluded.data;
end;
$$;
revoke all on function public.refresh_site_cache() from public, anon, authenticated;
select public.refresh_site_cache();

-- ── 3. רענון כל 10 שניות ──
create extension if not exists pg_cron;
do $$ begin perform cron.unschedule('site-cache'); exception when others then null; end $$;
select cron.schedule('site-cache', '10 seconds', 'select public.refresh_site_cache()');

-- ── 4. פחות Realtime: הצבעות בסקר לא נשלחות לכל דפדפן פתוח (הן פרטיות ממילא) ──
do $$ begin alter publication supabase_realtime drop table public.poll_votes; exception when others then null; end $$;

-- ── 5. הרשאות: is_mod() פעם אחת לשאילתה במקום פעם לכל שורה ──
drop policy if exists "read published missions" on public.missions;
create policy "read published missions" on public.missions for select using (published or (select public.is_mod()));
drop policy if exists "write missions" on public.missions;
create policy "write missions" on public.missions for all to authenticated using ((select public.is_mod())) with check ((select public.is_mod()));
drop policy if exists "read all comments (mods)" on public.comments;
create policy "read all comments (mods)" on public.comments for select to authenticated using ((select public.is_mod()));
drop policy if exists "mods markers" on public.markers;
create policy "mods markers" on public.markers for all to authenticated using ((select public.is_mod())) with check ((select public.is_mod()));
drop policy if exists "mods stories" on public.stories;
create policy "mods stories" on public.stories for all to authenticated using ((select public.is_mod())) with check ((select public.is_mod()));
drop policy if exists "mods polls" on public.polls;
create policy "mods polls" on public.polls for all to authenticated using ((select public.is_mod())) with check ((select public.is_mod()));

-- בדיקה: אמורות לחזור 4 שורות עם זמן עדכון של השניות האחרונות
select id, updated_at, pg_size_pretty(octet_length(data::text)::bigint) as size from public.site_cache order by id;

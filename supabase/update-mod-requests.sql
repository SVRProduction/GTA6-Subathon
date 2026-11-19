-- ── בקשות גישה לרשימת המודים ("ויטליסט") – כל מוד מאשר או דוחה ──
-- להריץ פעם אחת ב-SQL Editor (אפשר להריץ שוב בבטחה: רק מוסיף טבלה, עמודה ופונקציה; לא מוחק ולא משנה נתונים קיימים).
-- מי שמתחבר עם Kick באדמין ולא ברשימה לוחץ "בקשת גישה" → שורה כאן (נכתבת רק ע"י הפונקציה kick-mod, עם מזהה ה-Kick המאומת).
-- כל מוד (לא רק בעלים) מאשר → נכנס ל-public.mods, כשמזהה ה-Kick כבר נעול על החשבון שביקש. או דוחה.
-- הוספה ידנית לפי שם והסרה מהרשימה נשארות לבעלים בלבד (המדיניות "owners write mods" לא משתנה).

create table if not exists public.mod_requests (
  kick_username text primary key check (kick_username = lower(kick_username) and kick_username <> ''),
  kick_user_id text not null,
  display_name text,
  avatar text,
  status text not null default 'pending' check (status in ('pending', 'rejected')),
  requested_at timestamptz not null default now(),
  decided_by text,
  decided_at timestamptz
);

-- מי אישר (לתצוגה באדמין); שורות קיימות נשארות עם null
alter table public.mods add column if not exists added_by text;

alter table public.mod_requests enable row level security;
drop policy if exists "mods read requests" on public.mod_requests;
create policy "mods read requests" on public.mod_requests for select to authenticated using (public.is_mod());
-- אין מדיניות כתיבה: כותבים רק kick-mod (service role) והפונקציה למטה

-- אישור / דחייה. נבדק בשרת: רק מוד או בעלים
create or replace function public.decide_mod_request(p_name text, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare r public.mod_requests; me text := nullif(public.jwt_kick_name(), '');
begin
  if not public.is_mod() then raise exception 'רק מודים יכולים לאשר בקשות גישה'; end if;
  select * into r from public.mod_requests where kick_username = lower(trim(p_name)) for update;
  if not found then raise exception 'הבקשה לא נמצאה (אולי מוד אחר כבר טיפל בה)'; end if;
  if p_approve then
    -- שם שכבר ברשימה לא משתנה (גם לא המזהה הנעול שלו)
    insert into public.mods (kick_username, kick_user_id, added_by) values (r.kick_username, r.kick_user_id, me)
      on conflict (kick_username) do nothing;
    delete from public.mod_requests where kick_username = r.kick_username;
  else
    update public.mod_requests set status = 'rejected', decided_by = me, decided_at = now() where kick_username = r.kick_username;
  end if;
end $$;
revoke all on function public.decide_mod_request(text, boolean) from public, anon;
grant execute on function public.decide_mod_request(text, boolean) to authenticated;

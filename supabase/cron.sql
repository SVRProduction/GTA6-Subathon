-- להריץ ב-SQL Editor אחרי פריסת הפונקציה kick-sync.
-- להחליף את <PROJECT_REF> ואת <CRON_SECRET> (אותו ערך כמו הסוד CRON_SECRET של הפונקציה).
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('kick-sync') where exists (select 1 from cron.job where jobname = 'kick-sync');
select cron.schedule('kick-sync', '*/2 * * * *', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/kick-sync',
    headers := '{"Content-Type": "application/json", "x-cron-secret": "<CRON_SECRET>"}'::jsonb,
    body := '{}'::jsonb
  );
$$);

-- קליפ לכל מרקר: עמודה חדשה video_url (קישור ל-Kick / YouTube / mp4, או סרטון שהועלה).
-- להריץ פעם אחת ב-SQL Editor. אין סודות להחליף. בטוח להריץ שוב.
alter table public.markers add column if not exists video_url text check (video_url is null or char_length(video_url) <= 600);

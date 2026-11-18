// Service Worker מינימלי: מעטפת האפליקציה עובדת גם בקליטה חלשה.
// דפים: רשת קודם, תמיד בבדיקה מול השרת (הגרסה העדכנית מיד), מטמון רק כשאין רשת.
// קבצי קוד/פונטים/אייקונים: מהמטמון, ומתעדכנים ברקע. אריחי המפה הכבדים (map-hd-*) – רק מהרשת.
// בקשות לשרתים אחרים (Supabase, Kick) לא נוגעים בהן.
// התראות: סטורי חדש / משימה נגמרה (נשלחות מהפונקציה push-send).
const CACHE = 'subathon-v10';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './phone.html', './install.html', './manifest.webmanifest', './phone.webmanifest', './icons/icon-192.png', './icons/oded-96.png'])).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (/map-hd-|\.m3u8|\.ts$/.test(url.pathname)) return;
  if (req.mode === 'navigate') {
    e.respondWith(
      // no-cache: תמיד שואלים את השרת אם יש גרסה חדשה (בלי לחכות 10 דקות של מטמון הדפדפן)
      fetch(req, { cache: 'no-cache' })
        .then((r) => {
          const copy = r.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return r;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match(url.pathname.endsWith('phone.html') ? './phone.html' : './'))),
    );
    return;
  }
  if (/\/assets\/|\/icons\/|\/fx\/|\.(webp|png|json|woff2?)$/.test(url.pathname)) {
    e.respondWith(
      caches.open(CACHE).then((c) =>
        c.match(req).then((hit) => {
          const net = fetch(req)
            .then((r) => {
              if (r.ok) c.put(req, r.clone());
              return r;
            })
            .catch(() => hit);
          return hit || net;
        }),
      ),
    );
  }
});

// ── התראות לטלפון ──
self.addEventListener('push', (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {
    d = { body: e.data ? e.data.text() : '' };
  }
  e.waitUntil(
    self.registration.showNotification(d.title || 'הסאבתון של עודד', {
      body: d.body || '',
      icon: './icons/oded-192.png',
      badge: './icons/icon-192.png',
      tag: d.tag || 'subathon',
      renotify: true,
      lang: 'he',
      dir: 'rtl',
      data: { url: d.url || './phone.html' },
    }),
  );
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './phone.html', self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      // אם האפליקציה כבר פתוחה – עוברים אליה ולקישור; אחרת פותחים חלון חדש
      for (const c of list) {
        if (c.url.startsWith(self.registration.scope) && 'focus' in c) {
          c.navigate(url).catch(() => {});
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

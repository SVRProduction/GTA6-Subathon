// Service Worker מינימלי: מעטפת האפליקציה עובדת גם בקליטה חלשה.
// דפים: רשת קודם (תמיד הגרסה העדכנית), מטמון רק כשאין רשת.
// קבצי קוד/פונטים/אייקונים: מהמטמון, ומתעדכנים ברקע. אריחי המפה הכבדים (map-hd-*) – רק מהרשת.
// בקשות לשרתים אחרים (Supabase, Kick) לא נוגעים בהן.
const CACHE = 'subathon-v7';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './phone.html', './manifest.webmanifest', './phone.webmanifest', './icons/icon-192.png'])).catch(() => {}));
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
      fetch(req)
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

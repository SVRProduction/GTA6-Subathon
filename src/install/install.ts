// עמוד ההתקנה: מזהה את המכשיר ומראה שלושה צעדים פשוטים. כשהדפדפן מאפשר – כפתור "להתקין עכשיו".
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const ua = navigator.userAgent;
const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /android/i.test(ua);
const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

function show(os: string) {
  document.querySelectorAll<HTMLElement>('[data-steps]').forEach((s) => (s.hidden = s.dataset.steps !== os));
  document.querySelectorAll<HTMLElement>('[data-os]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.os === os)));
}
document.querySelectorAll<HTMLButtonElement>('[data-os]').forEach((b) => (b.onclick = () => show(b.dataset.os!)));
show(isIOS ? 'ios' : isAndroid ? 'android' : 'desktop');
// באייפון רק Safari יודע להוסיף למסך הבית
if (isIOS && /crios|fxios|edgios|instagram|fban|fbav|tiktok/i.test(ua)) $('[data-ios-other]').hidden = false;
if (standalone) $('[data-done]').hidden = false;

let deferred: (Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }) | null = null;
const now = $<HTMLButtonElement>('[data-now]');
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e as typeof deferred;
  now.hidden = standalone;
});
now.onclick = async () => {
  if (!deferred) return;
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  now.hidden = true;
  if (outcome === 'accepted') $('[data-done]').hidden = false;
};
addEventListener('appinstalled', () => {
  now.hidden = true;
  $('[data-done]').hidden = false;
});

// אותו Service Worker של הטלפון – בלעדיו הדפדפן לא מציע התקנה
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => {});

// התראות לטלפון (סטורי חדש, משימה נגמרה): כפתור 🔔 בכותרת של אפליקציית הטלפון.
// המפתח הציבורי מגיע מהפונקציה push-subscribe; כל עוד ההתראות לא הוגדרו בשרת – הכפתור מוסתר.
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../config';

const fn = `${SUPABASE_URL}/functions/v1/push-subscribe`;
const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY };

const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

function b64ToBytes(b64: string) {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

export function initPush(btn: HTMLButtonElement, opts: { toast: (t: string) => void; installUrl: string }) {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  let key: string | null = null;

  async function current() {
    if (!supported) return null;
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }
  async function paint() {
    const sub = await current().catch(() => null);
    const on = !!sub && Notification.permission === 'granted';
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.title = on ? 'ההתראות פעילות (לחיצה לביטול)' : 'קבלו התראה על סטורי חדש ומשימה שנגמרה';
  }

  btn.onclick = async () => {
    // באייפון: התראות רק מאפליקציה מותקנת במסך הבית
    if (isIos && !standalone) {
      opts.toast('באייפון ההתראות עובדות אחרי שמתקינים את האפליקציה למסך הבית');
      location.href = opts.installUrl;
      return;
    }
    if (!supported || !key) {
      opts.toast('הדפדפן הזה לא תומך בהתראות');
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub && Notification.permission === 'granted') {
        // ביטול
        await fetch(fn, { method: 'POST', headers, body: JSON.stringify({ unsubscribe: sub.endpoint }) }).catch(() => {});
        await sub.unsubscribe();
        opts.toast('ההתראות בוטלו');
        return void paint();
      }
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        opts.toast('כדי לקבל התראות צריך לאשר אותן בהגדרות של הדפדפן');
        return void paint();
      }
      const fresh = sub ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) }));
      const r = await fetch(fn, { method: 'POST', headers, body: JSON.stringify({ subscription: fresh.toJSON() }) });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? 'ההרשמה נכשלה');
      opts.toast('מעולה! תקבלו התראה על סטורי חדש ומשימה שנגמרה 🔔');
    } catch (e) {
      opts.toast((e as Error).message || 'ההרשמה להתראות נכשלה');
    }
    paint();
  };

  // מציגים את הכפתור רק כשהשרת מוכן (יש מפתח), או באייפון לא מותקן (כדי להסביר איך)
  if (!SUPABASE_URL) return;
  fetch(fn, { headers: { apikey: SUPABASE_ANON_KEY } })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { key?: string | null } | null) => {
      key = j?.key ?? null;
      if (!key) return;
      btn.hidden = !(supported || isIos);
      paint();
    })
    .catch(() => {});
}

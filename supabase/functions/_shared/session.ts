// כרטיס כניסה חתום (HMAC-SHA256) – בלי מסד נתונים: "<payload base64url>.<חתימה base64url>"
const enc = new TextEncoder();
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

async function key(secret: string) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function sign(payload: Record<string, unknown>, secret: string) {
  // ה-payload ב-UTF-8 (שמות בעברית)
  const body = b64u(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), enc.encode(body)));
  return `${body}.${b64u(sig)}`;
}

/** מחזיר את ה-payload אם החתימה תקינה ולא פג תוקף (exp בשניות), אחרת null. ignoreExp: רק החתימה נבדקת */
export async function verify<T = Record<string, unknown>>(token: string, secret: string, ignoreExp = false): Promise<T | null> {
  const [body, sig] = String(token).split('.');
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await key(secret), fromB64u(sig), enc.encode(body));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(fromB64u(body)));
    if (!ignoreExp && typeof p.exp === 'number' && p.exp * 1000 < Date.now()) return null;
    return p as T;
  } catch {
    return null;
  }
}

export const randomString = (n = 48) => b64u(crypto.getRandomValues(new Uint8Array(n)));
export async function sha256b64u(s: string) {
  return b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s))));
}

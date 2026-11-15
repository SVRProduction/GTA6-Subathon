type Child = Node | string | null | undefined | false;

/** יוצר אלמנט. טקסט נכנס תמיד כ-textContent, כך שתוכן מהאדמין לא יכול להזריק HTML */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { class: cls, ...rest } = props;
  if (cls) el.className = cls;
  Object.assign(el, rest);
  for (const c of children) if (c) el.append(c);
  return el;
}

export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** מאשר רק קישורי http/https (או data: של קובץ שהועלה במצב דמו) */
export function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const u = url.trim();
  return /^(https?:\/\/|data:(image|video|audio)\/)/i.test(u) ? u : null;
}

const dateFmt = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
export const fmtDate = (iso: string | null) => (iso ? dateFmt.format(new Date(iso)) : '');

/** מחליף את תוכן האלמנט, מדלג על ערכים ריקים */
export function fill(el: Element, ...children: Child[]) {
  el.replaceChildren(...children.filter((c): c is Node | string => !!c));
}

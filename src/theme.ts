// בחירת גרסת עיצוב (A / B / C) – זמני, עד שנבחרת גרסה אחת.
// הסדר: ‎?v= בכתובת → הבחירה האחרונה בדפדפן → A
export type Theme = 'a' | 'b' | 'c';
const KEY = 'journey-theme';
export const THEMES: Record<Theme, string> = { a: 'Vice City HUD', b: 'GPS נקי', c: 'יומן מסע' };

export function currentTheme(): Theme {
  const q = new URLSearchParams(location.search).get('v')?.toLowerCase();
  if (q === 'a' || q === 'b' || q === 'c') return q;
  try {
    const s = localStorage.getItem(KEY);
    if (s === 'a' || s === 'b' || s === 'c') return s;
  } catch {
    /* חסום */
  }
  return 'a';
}

export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* חסום */
  }
}

/** המתג בתחתית המסך */
export function themeSwitcher(stage: HTMLElement, onChange?: (t: Theme) => void) {
  const box = document.createElement('div');
  box.className = 'themes';
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', 'גרסת עיצוב');
  const label = document.createElement('span');
  label.textContent = 'גרסה';
  box.append(label);
  const btns = (Object.keys(THEMES) as Theme[]).map((t) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = t.toUpperCase();
    b.title = THEMES[t];
    b.setAttribute('aria-label', `גרסה ${t.toUpperCase()}: ${THEMES[t]}`);
    b.onclick = () => {
      applyTheme(t);
      sync();
      // הכתובת מתעדכנת, כדי שאפשר יהיה לשלוח קישור לגרסה מסוימת
      const u = new URL(location.href);
      u.searchParams.set('v', t);
      history.replaceState(null, '', u);
      onChange?.(t);
    };
    return b;
  });
  const sync = () => btns.forEach((b) => b.setAttribute('aria-pressed', String(b.textContent!.toLowerCase() === document.documentElement.dataset.theme)));
  box.append(...btns);
  sync();
  stage.append(box);
}

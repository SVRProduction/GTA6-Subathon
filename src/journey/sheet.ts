// גיליון במובייל: גוררים למטה כדי לסגור. מעקב 1:1, התנגדות גומי למעלה,
// ובשחרור מחליטים לפי המקום שהמומנטום מנבא (apple-design), לא לפי המיקום ברגע השחרור.
const project = (v: number, d = 0.998) => ((v / 1000) * d) / (1 - d);
const rubberband = (over: number, dim: number, c = 0.55) => (over * dim * c) / (dim + c * Math.abs(over));

export function enableSheetDrag(panel: HTMLElement, handles: HTMLElement[], onDismiss: () => void) {
  const mobile = matchMedia('(max-width: 760px)');
  let startY = 0;
  let dy = 0;
  let dragging = false;
  let hist: Array<{ y: number; t: number }> = [];

  const down = (e: PointerEvent) => {
    if (!mobile.matches || e.button > 0) return;
    // מתוך התוכן: רק כשהוא גלול לראש ומושכים למטה
    const scroller = panel.querySelector<HTMLElement>('[data-panel-body]');
    if (e.currentTarget === scroller && scroller && scroller.scrollTop > 0) return;
    dragging = true;
    startY = e.clientY;
    dy = 0;
    hist = [{ y: e.clientY, t: performance.now() }];
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    panel.style.transition = 'none';
  };
  const move = (e: PointerEvent) => {
    if (!dragging) return;
    const raw = e.clientY - startY;
    if (raw < 6 && dy === 0) return; // סף קטן לפני שמתחייבים לכיוון
    dy = raw >= 0 ? raw : rubberband(raw, panel.offsetHeight);
    panel.style.transform = `translateY(${dy}px)`;
    hist.push({ y: e.clientY, t: performance.now() });
    if (hist.length > 6) hist.shift();
    e.preventDefault();
  };
  const up = () => {
    if (!dragging) return;
    dragging = false;
    const now = performance.now();
    const recent = hist.filter((p) => now - p.t < 100);
    const v = recent.length > 1 ? ((recent[recent.length - 1].y - recent[0].y) / Math.max(1, recent[recent.length - 1].t - recent[0].t)) * 1000 : 0;
    // האנימציה ממשיכה מהמיקום הנוכחי על המסך (המעבר ב-CSS מתחיל מהערך הנוכחי)
    panel.style.transition = '';
    panel.style.transform = '';
    if (dy + project(v) > panel.offsetHeight * 0.35) onDismiss();
    dy = 0;
  };
  for (const h of handles) {
    h.addEventListener('pointerdown', down);
    h.addEventListener('pointermove', move);
    h.addEventListener('pointerup', up);
    h.addEventListener('pointercancel', up);
  }
}

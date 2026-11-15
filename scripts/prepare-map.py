"""מכין את המפה לאתר מתוך התמונה המקורית (images/5.webp, ‏1131×1391).

שלבים:
  1. ניקוי: הלוגו בפינה והאייקון למטה (לא חלק מהמפה) מושלמים בים.
       python3 scripts/prepare-map.py clean images/5.webp clean.png
  2. הגדלה פי 4 עם Real-ESRGAN x4plus (ראו scripts/realesrgan.py).
  3. גימור + ים מסביב:
       python3 scripts/prepare-map.py finish clean.png x4.png public

פלט (שלב 3):
  public/map.webp           המפה, מוגדלת (עד 3400 לרוחב), עם חידוד עדין וגריין קל
  public/map-original.webp  המפה הנקייה בגודל המקור (לבוחר המיקום באדמין)
  public/map-pad.webp       ים ברזולוציה נמוכה סביב המפה, כדי שבמבט המוטה לא רואים קצה
  public/map.json           כמה ים יש מכל צד + שם קובץ השביל
"""
import json, os, sys
import cv2
import numpy as np

mode = sys.argv[1]

if mode == 'clean':
    im = cv2.imread(sys.argv[2])
    H, W = im.shape[:2]
    m = np.zeros((H, W), np.uint8)
    m[int(H * 0.004):int(H * 0.125), int(W * 0.01):int(W * 0.21)] = 255              # הלוגו
    cv2.circle(m, (int(W * 0.939), int(H * 0.9525)), int(W * 0.04), 255, -1)          # אייקון הרמקול
    c = cv2.inpaint(im, m, max(7, W // 60), cv2.INPAINT_TELEA)
    soft = cv2.GaussianBlur(c, (0, 0), W / 130)
    a = cv2.GaussianBlur(m, (0, 0), W / 200)[..., None] / 255.0
    cv2.imwrite(sys.argv[3], (c * (1 - a) + soft * a).astype(np.uint8))
    sys.exit()

if mode == 'fx':
    # python3 scripts/prepare-map.py fx clean.png public
    # מסכת ים (R = ים, G = מים רדודים/טורקיז) + תמונות עננים שקופות
    im, out_dir = cv2.imread(sys.argv[2]), sys.argv[3]
    os.makedirs(os.path.join(out_dir, 'fx'), exist_ok=True)
    f = im.astype(np.float32) / 255
    b, g, r = f[..., 0], f[..., 1], f[..., 2]
    mx, mn = f.max(-1), f.min(-1)
    sat = (mx - mn) / np.maximum(mx, 1e-3)
    sea = ((b > r + 0.07) & (g > r + 0.02) & (sat > 0.56)).astype(np.uint8)
    sea = cv2.morphologyEx(sea, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    # בלי כתמים קטנים ביבשה (גגות כחלחלים, בריכות): רק שטחי מים גדולים
    n, lab, stats, _ = cv2.connectedComponentsWithStats(sea, 8)
    keep = np.zeros_like(sea)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] > im.shape[0] * im.shape[1] * 0.0006:
            keep[lab == i] = 1
    keep = cv2.morphologyEx(keep, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    keep = cv2.erode(keep, np.ones((3, 3), np.uint8))  # לא לגלוש על קו החוף
    soft = cv2.GaussianBlur(keep.astype(np.float32), (0, 0), 1.6)
    shallow = cv2.GaussianBlur(np.clip((g - r - 0.18) * 4, 0, 1) * (mx > 0.45), (0, 0), 2) * soft
    mask = np.stack([np.zeros_like(soft), shallow, soft], -1)  # BGR
    cv2.imwrite(os.path.join(out_dir, 'map-sea.png'), (np.clip(mask, 0, 1) * 255).astype(np.uint8))

    # מסכת קצוות: המפה נמוגה אל הים שמסביב לקראת השוליים – אבל רק במים. יבשה (וקצת ים סביבה) נשארת מלאה
    Hm, Wm = keep.shape
    land = (keep == 0).astype(np.uint8)
    land = cv2.morphologyEx(land, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))  # בלי סירות בודדות
    dist = cv2.distanceTransform(1 - land, cv2.DIST_L2, 5) / Wm               # מרחק מהיבשה, ביחס לרוחב
    prox = 1 - np.clip((dist - 0.02) / 0.05, 0, 1)
    yy, xx = np.mgrid[0:Hm, 0:Wm].astype(np.float32)
    ed = np.minimum(np.minimum(xx, Wm - 1 - xx) / Wm, np.minimum(yy, Hm - 1 - yy) / Wm)
    edge = np.clip(ed / 0.13, 0, 1)
    edge = edge * edge * (3 - 2 * edge)
    al = np.maximum(prox * np.clip(ed / 0.012, 0, 1), edge)
    al = cv2.GaussianBlur(al, (0, 0), 4)
    al = cv2.resize(al, (Wm // 2, Hm // 2), interpolation=cv2.INTER_AREA)
    cv2.imwrite(os.path.join(out_dir, 'map-edge.png'), np.dstack([np.full_like(al, 255)] * 3 + [al * 255]).astype(np.uint8))

    rng = np.random.default_rng(11)
    def fbm(h, w, base):
        out = np.zeros((h, w), np.float32); amp = 1.0; tot = 0.0; n = base
        for _ in range(5):
            g0 = rng.random((max(2, n * h // w), n)).astype(np.float32)
            out += cv2.resize(g0, (w, h), interpolation=cv2.INTER_CUBIC) * amp
            tot += amp; amp *= 0.5; n *= 2
        return out / tot
    Wc, Hc = 640, 420
    yy, xx = np.mgrid[0:Hc, 0:Wc].astype(np.float32)
    for k in range(4):
        cx, cy = Wc / 2, Hc / 2
        ex, ey = Wc * (0.44 + 0.05 * rng.random()), Hc * (0.4 + 0.07 * rng.random())
        fall = np.clip(1 - np.hypot((xx - cx) / ex, (yy - cy) / ey), 0, 1) ** 0.8
        nz = fbm(Hc, Wc, 5)
        a = np.clip((nz * 1.25 + fall * 0.5 - 0.86) * 2.4, 0, 1) * np.clip(fall * 5, 0, 1)
        a = cv2.GaussianBlur(a, (0, 0), 2.5)
        shade = 0.82 + 0.18 * np.clip(cv2.GaussianBlur(a, (0, 0), 14) * 1.3 + (fbm(Hc, Wc, 9) - 0.5) * 0.25, 0, 1)
        rgba = np.dstack([shade * 255, shade * 255, shade * 250, a * 225]).astype(np.uint8)
        cv2.imwrite(os.path.join(out_dir, 'fx', f'cloud-{k}.webp'), rgba, [cv2.IMWRITE_WEBP_QUALITY, 80])
    print('fx: sea', round(float(keep.mean()), 3))
    sys.exit()

if mode == 'tiles':
    # python3 scripts/prepare-map.py tiles big.png public <grid> <prefix>
    big, out_dir, grid, prefix = cv2.imread(sys.argv[2]), sys.argv[3], int(sys.argv[4]), sys.argv[5]
    H, W = big.shape[:2]
    blur = cv2.GaussianBlur(big, (0, 0), 1.6)
    big = cv2.addWeighted(big, 1.3, blur, -0.3, 0)
    names = []
    for j in range(grid):
        for i in range(grid):
            y0, y1, x0, x1 = j * H // grid, (j + 1) * H // grid, i * W // grid, (i + 1) * W // grid
            name = f'{prefix}-{j * grid + i}.webp'
            cv2.imwrite(os.path.join(out_dir, name), big[y0:y1, x0:x1], [cv2.IMWRITE_WEBP_QUALITY, 82])
            names.append(name)
    meta_path = os.path.join(out_dir, 'map.json')
    meta = json.load(open(meta_path))
    meta.setdefault('hd', {})[prefix.split('-')[-1]] = {'tiles': names, 'grid': grid, 'w': W}
    json.dump(meta, open(meta_path, 'w'))
    print('tiles', len(names), W, H)
    sys.exit()

small, big, out_dir = cv2.imread(sys.argv[2]), cv2.imread(sys.argv[3]), sys.argv[4]
# המפה באתר: עד 3400 פיקסלים לרוחב (מעבר לזה כבד לטלפון ולא מוסיף חדות)
if big.shape[1] > 3400:
    k = 3400 / big.shape[1]
    big = cv2.resize(big, (3400, round(big.shape[0] * k)), interpolation=cv2.INTER_AREA)

# גימור: חידוד עדין + גריין קל, כדי שההגדלה לא תיראה חלקה מדי
blur = cv2.GaussianBlur(big, (0, 0), 1.6)
fin = cv2.addWeighted(big, 1.35, blur, -0.35, 0).astype(np.float32)
rng = np.random.default_rng(7)
fin += rng.normal(0, 2.2, fin.shape[:2]).astype(np.float32)[..., None]
cv2.imwrite(os.path.join(out_dir, 'map.webp'), np.clip(fin, 0, 255).astype(np.uint8), [cv2.IMWRITE_WEBP_QUALITY, 86])
cv2.imwrite(os.path.join(out_dir, 'map-original.webp'), cv2.resize(small, (800, round(small.shape[0] * 800 / small.shape[1])), interpolation=cv2.INTER_AREA), [cv2.IMWRITE_WEBP_QUALITY, 92])

# ים מסביב, ברזולוציה של המקור: המשך רך של השוליים שהולך ומתקרב לצבע ים ממוצע
img = cv2.resize(small, (420, round(small.shape[0] * 420 / small.shape[1])), interpolation=cv2.INTER_AREA)  # הים שמסביב ברזולוציה נמוכה
h, w = img.shape[:2]
m = int(round(max(w, h) * 1.1))
f = img.astype(np.float32)
# צבע הים: החציון של שולי התמונה (הים העמוק). הים שמסביב אחיד, עם גרעיניות עדינה;
# המפה עצמה נמוגה לתוכו בקצוות (map-edge.png), כך שאין קצה חתוך ואין מריחה
ring = np.concatenate([f[:12].reshape(-1, 3), f[-12:].reshape(-1, 3), f[:, :12].reshape(-1, 3), f[:, -12:].reshape(-1, 3)])
sea_mean = np.median(ring, 0)
H, W = h + 2 * m, w + 2 * m
pad = np.broadcast_to(sea_mean, (H, W, 3)).copy()
pad += cv2.GaussianBlur(rng.normal(0, 1, (H, W)).astype(np.float32), (0, 0), 6)[..., None] * 14
cv2.imwrite(os.path.join(out_dir, 'map-pad.webp'), np.clip(pad, 0, 255).astype(np.uint8), [cv2.IMWRITE_WEBP_QUALITY, 82])

meta_path = os.path.join(out_dir, 'map.json')
meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {}
meta.update({'pad': 'map-pad.webp', 'mx': m / w, 'my': m / h, 'trail': 'trail.json', 'sea': 'map-sea.png', 'edge': 'map-edge.png', 'clouds': [f'fx/cloud-{k}.webp' for k in range(4)]})
json.dump(meta, open(meta_path, 'w'))
print('map', big.shape, 'pad', pad.shape)

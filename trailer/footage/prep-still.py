#!/usr/bin/env python3
"""הכנת תמונת מקור לשוט: חיתוך האזור שהשוט באמת רואה, ניקוי קל של בלוקים של JPEG, הגדלה ב-Lanczos לגודל המדויק
שהדפדפן צריך (כך שהדפדפן רק מקטין מעט ולעולם לא מגדיל), וחידוד עדין. הפלט נשאר תחת work/.

prep-still.py <src.jpg> <out.png> <x0> <y0> <x1> <y1> <out_w> <out_h> [denoise=3] [sharpen=0.7]
"""
import sys

import cv2
import numpy as np
from PIL import Image, ImageFilter

src, out = sys.argv[1], sys.argv[2]
x0, y0, x1, y1, ow, oh = (int(v) for v in sys.argv[3:9])
denoise = float(sys.argv[9]) if len(sys.argv) > 9 else 3.0
sharpen = float(sys.argv[10]) if len(sys.argv) > 10 else 0.7

im = Image.open(src).convert('RGB')
assert 0 <= x0 < x1 <= im.size[0] and 0 <= y0 < y1 <= im.size[1], 'crop outside the image'

if denoise > 0:
    # הניקוי רץ על התמונה כולה (הקשר מלא לחיפוש הטלאים), ורק אחר כך חותכים
    bgr = cv2.cvtColor(np.asarray(im), cv2.COLOR_RGB2BGR)
    bgr = cv2.fastNlMeansDenoisingColored(bgr, None, denoise, denoise, 5, 15)
    im = Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))

# חיתוך לפני ההגדלה: הפסים השחורים (letterbox) לא משתתפים בדגימה ולא דולפים פנימה
crop = im.crop((x0, y0, x1, y1))
k = ow / float(x1 - x0)
big = crop.resize((ow, oh), Image.LANCZOS)
if sharpen > 0:
    # רדיוס יחסי להגדלה: מחזיר ניגודיות לקצוות שההגדלה ריככה, בלי הילות
    big = big.filter(ImageFilter.UnsharpMask(radius=max(0.6, 0.62 * k), percent=int(round(100 * sharpen)), threshold=2))
big.save(out, compress_level=1)
print('prep %s [%d,%d,%d,%d] x%.3f -> %dx%d' % (src.split('/')[-2] + '/' + src.split('/')[-1], x0, y0, x1, y1, k, ow, oh))

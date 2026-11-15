"""הגדלת המפה פי 4 עם Real-ESRGAN, על מעבד רגיל, בחלקים.

התקנה:
  pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
  pip install spandrel
  curl -LO https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth

שימוש:
  python3 scripts/realesrgan.py clean.png RealESRGAN_x4plus.pth x4.png 4
"""
import sys
import time

import cv2
import numpy as np
import torch
from spandrel import ModelLoader

src, weights, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
K = int(sys.argv[4]) if len(sys.argv) > 4 else 4  # פי כמה המודל מגדיל (x4plus = 4, x2plus = 2)
torch.set_num_threads(4)
img = cv2.imread(src)
model = ModelLoader().load_from_file(weights).model.eval()
x = torch.from_numpy(cv2.cvtColor(img, cv2.COLOR_BGR2RGB)).permute(2, 0, 1).float().div(255)[None]
H, W = img.shape[:2]
T, P = 160, 16  # גודל חלק וחפיפה
out = torch.zeros(1, 3, H * K, W * K)
t0 = time.time()
with torch.inference_mode():
    for y in range(0, H, T):
        for x0 in range(0, W, T):
            ys, xs = max(0, y - P), max(0, x0 - P)
            ye, xe = min(H, y + T + P), min(W, x0 + T + P)
            o = model(x[:, :, ys:ye, xs:xe])
            oy, ox = (y - ys) * K, (x0 - xs) * K
            th, tw = (min(y + T, H) - y) * K, (min(x0 + T, W) - x0) * K
            out[:, :, y * K:y * K + th, x0 * K:x0 * K + tw] = o[:, :, oy:oy + th, ox:ox + tw]
        print(f'row {y}/{H} {time.time() - t0:.0f}s', flush=True)
res = (out[0].clamp(0, 1).permute(1, 2, 0).numpy() * 255).round().astype(np.uint8)
cv2.imwrite(out_path, cv2.cvtColor(res, cv2.COLOR_RGB2BGR))
print('done', res.shape)

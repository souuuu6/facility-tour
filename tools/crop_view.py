"""360度写真の一部を、ふつうの写真のように切り出す（解説ピンの写真づくり用）。

使い方:
    python tools/crop_view.py 360度写真.jpg 出力.jpg 向き(yaw) 上下(pitch) [画角=60]

yaw / pitch は編集モードでピンを置いたときの値と同じ（度）。
"""
import sys
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None


def crop(src, dst, yaw, pitch, fov=60.0, size=(960, 720)):
    im = np.asarray(Image.open(src).convert("RGB"))
    H, W = im.shape[:2]
    w, h = size
    t = np.tan(np.radians(fov) / 2)
    xs = (np.arange(w) + 0.5) / w * 2 - 1
    ys = 1 - (np.arange(h) + 0.5) / h * 2
    x, y = np.meshgrid(xs * t, ys * t * h / w)
    yr, pr = np.radians(yaw), np.radians(pitch)
    f = np.array([np.sin(yr) * np.cos(pr), np.sin(pr), -np.cos(yr) * np.cos(pr)])
    r = np.array([np.cos(yr), 0, np.sin(yr)])
    u = np.array([-np.sin(yr) * np.sin(pr), np.cos(pr), np.cos(yr) * np.sin(pr)])
    d = f[None, None] + x[..., None] * r + y[..., None] * u
    d /= np.linalg.norm(d, axis=-1, keepdims=True)
    lon = np.arctan2(d[..., 0], -d[..., 2])
    lat = np.arcsin(np.clip(d[..., 1], -1, 1))
    px = ((lon / (2 * np.pi) + 0.5) * W) % W
    py = np.clip((0.5 - lat / np.pi) * H, 0, H - 1)
    # 双一次補間
    x0 = np.floor(px).astype(int); y0 = np.floor(py).astype(int)
    x1 = (x0 + 1) % W; y1 = np.minimum(y0 + 1, H - 1)
    fx = (px - x0)[..., None]; fy = (py - y0)[..., None]
    out = (im[y0, x0] * (1 - fx) * (1 - fy) + im[y0, x1] * fx * (1 - fy)
           + im[y1, x0] * (1 - fx) * fy + im[y1, x1] * fx * fy)
    Image.fromarray(out.astype(np.uint8)).save(dst, quality=80, optimize=True, progressive=True)


if __name__ == "__main__":
    if len(sys.argv) < 5:
        print(__doc__)
        sys.exit(1)
    crop(sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5]) if len(sys.argv) > 5 else 60.0)

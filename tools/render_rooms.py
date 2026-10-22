# -*- coding: utf-8 -*-
"""施設バーチャルツアー用のサンプル 360° パノラマ（正距円筒 JPEG）を描く小さなレイトレーサ。

使い方:
    python -P tools/render_rooms.py              # 全部を本番解像度で描く
    python -P tools/render_rooms.py hidamari     # 1 施設だけ
    python -P tools/render_rooms.py --quick --out <dir>   # 確認用の小さい絵だけ
    python -P tools/render_rooms.py --report     # 扉の yaw/pitch 表だけ出す

決まりごと（ビューアと見取り図がこれに依存する）:
    座標は m。x = 東, y = 上, z = 南。床は y = 0、カメラ高さ 1.4。
    画像 W×H の画素 (u, v):  yaw = ((u+.5)/W)*360 - 180,  pitch = 90 - ((v+.5)/H)*180
    向き = (sin yaw cos pitch, sin pitch, -cos yaw cos pitch)。画像中央 = 北、右へ行くと東へ回る。
"""
import argparse
import math
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
PPM = 400            # テクスチャ解像度 [px/m]
SS = 2               # 部品は 2 倍で描いて縮める（輪郭のギザギザ防止）
EYE = 1.4            # カメラの高さ
FONT_PATH = "C:/Windows/Fonts/BIZ-UDGothicB.ttc"

AMBIENT = 0.62
LIGHT_R = 2.2        # 照明の距離減衰の目安 [m]
EXPOSURE = 1.08

INK = (92, 70, 56)           # 保育園の文字色（こげ茶）
MINT = (118, 196, 168)       # クリニックの色
MINT_D = (78, 156, 130)
MINT_L = (226, 243, 235)
CL_INK = (58, 92, 82)

_fonts = {}


def font(px):
    px = max(6, int(round(px)))
    if px not in _fonts:
        _fonts[px] = ImageFont.truetype(FONT_PATH, px)
    return _fonts[px]


def mix(a, b, t):
    return tuple(int(round(a[i] * (1 - t) + b[i] * t)) for i in range(3))


def shade_c(c, f):
    return tuple(max(0, min(255, int(round(v * f)))) for v in c)


# ---------------------------------------------------------------- 描画部品
class Canvas:
    """メートル単位で描く小さな画用紙（左上原点、y は下向き）。発光マスクも一緒に持つ。"""

    def __init__(self, w, h, bg=(0, 0, 0, 0)):
        self.w, self.h, self.k = w, h, PPM * SS
        self.scale = 1.0     # 貼るときの拡大率
        size = (max(1, round(w * self.k)), max(1, round(h * self.k)))
        self.img = Image.new("RGBA", size, bg)
        self.emi = Image.new("L", size, 0)
        self.d = ImageDraw.Draw(self.img)
        self.e = ImageDraw.Draw(self.emi)

    def _b(self, x0, y0, x1, y1):
        k = self.k
        return [x0 * k, y0 * k, x1 * k - 1, y1 * k - 1]

    def rect(self, x0, y0, x1, y1, fill, r=0.0, outline=None, lw=0.0, emi=0):
        b = self._b(x0, y0, x1, y1)
        if b[2] < b[0] or b[3] < b[1]:
            return
        if r > 0:
            self.d.rounded_rectangle(b, radius=r * self.k, fill=fill, outline=outline, width=round(lw * self.k))
            self.e.rounded_rectangle(b, radius=r * self.k, fill=emi)
        else:
            self.d.rectangle(b, fill=fill, outline=outline, width=round(lw * self.k))
            self.e.rectangle(b, fill=emi)

    def ellipse(self, cx, cy, rx, ry, fill, outline=None, lw=0.0, emi=0):
        b = self._b(cx - rx, cy - ry, cx + rx, cy + ry)
        self.d.ellipse(b, fill=fill, outline=outline, width=round(lw * self.k))
        self.e.ellipse(b, fill=emi)

    def poly(self, pts, fill, emi=0):
        p = [(x * self.k, y * self.k) for x, y in pts]
        self.d.polygon(p, fill=fill)
        self.e.polygon(p, fill=emi)

    def line(self, pts, fill, lw, emi=0):
        p = [(x * self.k, y * self.k) for x, y in pts]
        self.d.line(p, fill=fill, width=max(1, round(lw * self.k)), joint="curve")
        self.e.line(p, fill=emi, width=max(1, round(lw * self.k)))
        r = lw / 2   # 線の端を丸く
        for x, y in (pts[0], pts[-1]):
            self.ellipse(x, y, r, r, fill, emi=emi)

    def arc(self, cx, cy, r, a0, a1, fill, lw):
        b = self._b(cx - r, cy - r, cx + r, cy + r)
        self.d.arc(b, a0, a1, fill=fill, width=round(lw * self.k))

    def text(self, cx, cy, s, size, fill):
        self.d.text((cx * self.k, cy * self.k), s, font=font(size * self.k), fill=fill, anchor="mm")
        self.e.text((cx * self.k, cy * self.k), s, font=font(size * self.k), fill=0, anchor="mm")

    def text_w(self, s, size):
        return font(size * self.k).getlength(s) / self.k

    def vgrad(self, x0, y0, x1, y1, c0, c1, emi=0):
        k = self.k
        a, b = round(y0 * k), round(y1 * k)
        for yy in range(a, b):
            t = (yy - a) / max(1, b - a - 1)
            self.d.line([(x0 * k, yy), (x1 * k - 1, yy)], fill=mix(c0, c1, t))
        self.e.rectangle(self._b(x0, y0, x1, y1), fill=emi)

    def paste(self, other, x, y):
        pos = (round(x * self.k), round(y * self.k))
        a = other.img.getchannel("A")
        self.img.alpha_composite(other.img, pos)
        self.emi.paste(other.emi, pos, a)

    def done(self, rot=0.0):
        size = (max(1, round(self.w * PPM * self.scale)), max(1, round(self.h * PPM * self.scale)))
        img = self.img.resize(size, Image.LANCZOS)
        emi = self.emi.resize(size, Image.LANCZOS)
        if rot:
            img = img.rotate(rot, Image.BICUBIC, expand=True)
            emi = emi.rotate(rot, Image.BICUBIC, expand=True)
        return img, emi


class Persp:
    """開口の奥の部屋を一点透視の「絵」として描く。
    x: 開口の左端（見る人から見て）からの横位置, y: 高さ, d: 開口からの奥行き [m]"""

    def __init__(self, w, h, D=2.5):
        self.cv = Canvas(w, h, (255, 255, 255, 255))
        self.w, self.h, self.D = w, h, D

    def P(self, x, y, d):
        f = self.D / (self.D + d)
        cx = self.w / 2
        return (cx + (x - cx) * f, self.h - (EYE + (y - EYE) * f))

    def poly(self, pts, col, emi=0):
        self.cv.poly([self.P(*p) for p in pts], col, emi)

    def qx(self, x, y0, y1, d0, d1, col, emi=0):      # 側壁の上の四角
        self.poly([(x, y0, d0), (x, y1, d0), (x, y1, d1), (x, y0, d1)], col, emi)

    def qy(self, y, x0, x1, d0, d1, col, emi=0):      # 床・天井の上の四角
        self.poly([(x0, y, d0), (x1, y, d0), (x1, y, d1), (x0, y, d1)], col, emi)

    def qd(self, d, x0, x1, y0, y1, col, emi=0):      # 正面を向いた四角
        self.poly([(x0, y0, d), (x1, y0, d), (x1, y1, d), (x0, y1, d)], col, emi)

    def box(self, x0, x1, y0, y1, d0, d1, front, top, side):
        if y1 < EYE:
            self.qy(y1, x0, x1, d0, d1, top)
        cx = self.w / 2
        if x1 < cx:
            self.qx(x1, y0, y1, d0, d1, side)
        if x0 > cx:
            self.qx(x0, y0, y1, d0, d1, side)
        self.qd(d0, x0, x1, y0, y1, front)

    def disc(self, x, d, r, col, y=0.002, n=40):
        self.poly([(x + r * math.cos(t), y, d + r * 0.7 * math.sin(t))
                   for t in np.linspace(0, 2 * math.pi, n, endpoint=False)], col)

    def room(self, xl, xr, H, depth, wall, floor, ceil, band=None):
        self.qy(H, xl, xr, 0, depth, ceil)
        self.qy(0, xl, xr, 0, depth, floor)
        self.qx(xl, 0, H, 0, depth, shade_c(wall, 0.93))
        self.qx(xr, 0, H, 0, depth, shade_c(wall, 0.96))
        self.qd(depth, xl, xr, 0, H, wall)
        if band:   # 腰の帯 (y0, y1, 色)
            y0, y1, c = band
            self.qx(xl, y0, y1, 0, depth, shade_c(c, 0.93))
            self.qx(xr, y0, y1, 0, depth, shade_c(c, 0.96))
            self.qd(depth, xl, xr, y0, y1, c)


# ---------------------------------------------------------------- 面テクスチャ
class Face:
    def __init__(self, w_m, h_m, base=(255, 255, 255)):
        self.w_m, self.h_m = w_m, h_m
        self.img = Image.new("RGB", (round(w_m * PPM), round(h_m * PPM)), base)
        self.emi = Image.new("L", self.img.size, 0)
        self.d = ImageDraw.Draw(self.img)
        self.levels = None

    def set_array(self, arr):
        self.img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")
        self.d = ImageDraw.Draw(self.img)

    def _paste(self, cv, left, top, rot=0.0):
        img, emi = cv.done(rot)
        pos = (round(left - img.width / 2), round(top - img.height))
        self.img.paste(img, pos, img)
        self.emi.paste(emi, pos, img.getchannel("A"))

    def build(self):
        """sRGB → 線形にして、ミップマップ（縮小の段）を作る"""
        a = np.asarray(self.img, np.float32) / 255.0
        a = np.power(a, 2.2)
        e = np.asarray(self.emi, np.float32)[..., None] / 255.0
        lv = [np.concatenate([a, e], axis=2)]
        while min(lv[-1].shape[:2]) > 4 and len(lv) < 10:
            t = lv[-1]
            if t.shape[0] % 2:
                t = np.concatenate([t, t[-1:]], 0)
            if t.shape[1] % 2:
                t = np.concatenate([t, t[:, -1:]], 1)
            lv.append(0.25 * (t[0::2, 0::2] + t[1::2, 0::2] + t[0::2, 1::2] + t[1::2, 1::2]))
        self.levels = lv
        self.img = self.emi = self.d = None


class Wall(Face):
    """壁。u は「壁に向かって立った人」の右方向に増える（文字が鏡像にならない）。"""

    def __init__(self, length, H, u_of, base):
        super().__init__(length, H, base)
        self.u_of = u_of

    def band(self, y0, y1, col):
        H = self.h_m
        self.d.rectangle([0, round((H - y1) * PPM), self.img.width, round((H - y0) * PPM) - 1], fill=col)

    def place(self, cv, wc, yb, rot=0.0):
        """部品 cv を、壁沿い位置 wc（世界座標の x か z）・下端の高さ yb に貼る"""
        self._paste(cv, self.u_of(wc) * PPM, (self.h_m - yb) * PPM, rot)


class Flat(Face):
    """床・天井。u = x - x0（東へ）, v = z - z0（南へ）。上から見て北が上。"""

    def __init__(self, W, D, x0, z0, base):
        super().__init__(W, D, base)
        self.x0, self.z0 = x0, z0

    def place(self, cv, xc, zc):
        self._paste(cv, (xc - self.x0) * PPM, (zc - self.z0) * PPM + cv.h * PPM / 2)


# ---------------------------------------------------------------- シーン
class Box:
    def __init__(self, lo, hi, side, top=None, stripes=(), k=0.5, s=0.15):
        self.lo = np.array(lo, np.float32)
        self.hi = np.array(hi, np.float32)
        self.side, self.top = side, top or side
        self.stripes = stripes      # (y0, y1, 色) 側面の帯
        self.k, self.s = k, s       # 周りに落とす影の濃さ・広がり


class Sphere:
    def __init__(self, c, r, col, k=0.35):
        self.c = np.array(c, np.float32)
        self.r, self.col, self.k = r, col, k


FACE_NAMES = ("west", "east", "floor", "ceil", "north", "south")
INWARD = {"west": (1, 0, 0), "east": (-1, 0, 0), "north": (0, 0, 1), "south": (0, 0, -1)}


class Scene:
    def __init__(self, facility, lo, hi, wall_base=(250, 250, 250), floor_base=(230, 230, 230),
                 ceil_base=(250, 250, 248)):
        self.facility = facility
        self.lo = np.array(lo, np.float32)
        self.hi = np.array(hi, np.float32)
        x0, y0, z0 = lo
        x1, y1, z1 = hi
        W, H, D = x1 - x0, y1 - y0, z1 - z0
        self.H = H
        self.f = {
            "west": Wall(D, H, lambda z: z1 - z, wall_base),
            "east": Wall(D, H, lambda z: z - z0, wall_base),
            "north": Wall(W, H, lambda x: x - x0, wall_base),
            "south": Wall(W, H, lambda x: x1 - x, wall_base),
            "floor": Flat(W, D, x0, z0, floor_base),
            "ceil": Flat(W, D, x0, z0, ceil_base),
        }
        self.boxes, self.spheres, self.lights = [], [], []
        self.nodes = {}
        self.marks = []    # (名前, 中心3D, 内向き法線)

    def walls(self):
        return [self.f[n] for n in ("west", "east", "north", "south")]

    def mark(self, name, wall, wc, yc):
        x0, _, z0 = self.lo
        x1, _, z1 = self.hi
        c = {"west": (x0, yc, wc), "east": (x1, yc, wc), "north": (wc, yc, z0), "south": (wc, yc, z1)}[wall]
        self.marks.append((name, np.array(c, float), np.array(INWARD[wall], float)))

    def build(self):
        for f in self.f.values():
            f.build()


# ---------------------------------------------------------------- 素材（床・壁の地）
def wood_floor(face, base=(230, 203, 162), plank=0.125, seed=1):
    h, w = face.img.height, face.img.width
    rng = np.random.default_rng(seed)
    xs = (np.arange(w) + 0.5) / PPM
    zs = (np.arange(h) + 0.5) / PPM
    pi = np.floor(xs / plank).astype(int)
    n = pi.max() + 1
    L = 1.8
    tint = rng.normal(0, 0.03, n)
    off = rng.uniform(0, L, n)
    segt = rng.normal(0, 0.025, (n, 64))
    X, Z = np.meshgrid(xs, zs)
    P = np.broadcast_to(pi[None, :], X.shape)
    zz = Z + off[P]
    seg = np.floor(zz / L).astype(int) % 64
    grain = 0.018 * np.sin(2 * np.pi * (X * 31 + 0.35 * np.sin(Z * 2.3 + P * 1.7))) \
        + 0.012 * np.sin(2 * np.pi * (X * 83 + 0.2 * np.sin(Z * 5.1 + P)))
    val = 1 + tint[P] + segt[P, seg] + grain
    fx = X - P * plank
    val = np.where((fx < 0.004) | (np.mod(zz, L) < 0.004), val * 0.86, val)
    face.set_array(np.array(base, np.float32)[None, None, :] * val[..., None])


def vinyl_floor(face, base=(230, 225, 214), tile=0.6, seed=2):
    h, w = face.img.height, face.img.width
    rng = np.random.default_rng(seed)
    noise = rng.normal(0, 1, (h // 8 + 1, w // 8 + 1)).astype(np.float32)
    noise = np.asarray(Image.fromarray(noise, "F").resize((w, h), Image.BICUBIC))
    val = 1 + 0.012 * noise
    xs = (np.arange(w) + 0.5) / PPM
    zs = (np.arange(h) + 0.5) / PPM
    gx = (np.mod(xs, tile) < 0.004)[None, :]
    gz = (np.mod(zs, tile) < 0.004)[:, None]
    val = np.where(gx | gz, val * 0.955, val)
    face.set_array(np.array(base, np.float32)[None, None, :] * val[..., None])


def nursery_wall(wall):
    wall.band(0.0, 0.9, (240, 223, 192))          # 腰板
    for i in range(int(wall.w_m / 0.1) + 1):        # 板の継ぎ目
        x = round(i * 0.1 * PPM)
        wall.d.line([(x, round((wall.h_m - 0.88) * PPM)), (x, wall.img.height)], fill=(225, 204, 168), width=2)
    wall.band(0.86, 0.92, (212, 178, 132))        # 笠木
    wall.band(0.98, 1.02, (250, 196, 160))        # 細い色の帯（ピーチ）
    wall.band(1.02, 1.04, (250, 246, 232))
    wall.band(1.04, 1.07, (178, 214, 236))        # 水色の帯
    wall.band(0.0, 0.08, (198, 162, 120))         # 幅木
    wall.band(wall.h_m - 0.05, wall.h_m, (226, 200, 160))


def clinic_wall(wall):
    wall.band(0.0, 0.9, MINT_L)
    wall.band(0.9, 0.94, MINT)
    wall.band(0.0, 0.1, MINT_D)


# ---------------------------------------------------------------- 小物
def icon(cv, kind, cx, cy, s, col):
    """札の左に付ける小さな絵（s は大きさ m）"""
    if kind == "flower":
        for i in range(5):
            a = i * 2 * math.pi / 5 - math.pi / 2
            cv.ellipse(cx + 0.45 * s * math.cos(a), cy + 0.45 * s * math.sin(a), 0.3 * s, 0.3 * s, col)
        cv.ellipse(cx, cy, 0.26 * s, 0.26 * s, (255, 214, 92))
    elif kind == "star":
        pts = []
        for i in range(10):
            a = i * math.pi / 5 - math.pi / 2
            r = s * (0.55 if i % 2 == 0 else 0.24)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
        cv.poly(pts, col)
    elif kind == "leaf":
        leaf(cv, cx, cy, s * 0.6, -0.6, col)
    elif kind == "toilet":
        for dx, c in ((-0.28, (110, 160, 220)), (0.28, (236, 120, 140))):
            x = cx + dx * s
            cv.ellipse(x, cy - 0.3 * s, 0.13 * s, 0.13 * s, c)
            if dx < 0:
                cv.rect(x - 0.14 * s, cy - 0.12 * s, x + 0.14 * s, cy + 0.42 * s, c, r=0.04 * s)
            else:
                cv.poly([(x, cy - 0.14 * s), (x + 0.2 * s, cy + 0.42 * s), (x - 0.2 * s, cy + 0.42 * s)], c)
    elif kind == "heart":
        cv.ellipse(cx - 0.17 * s, cy - 0.1 * s, 0.2 * s, 0.2 * s, col)
        cv.ellipse(cx + 0.17 * s, cy - 0.1 * s, 0.2 * s, 0.2 * s, col)
        cv.poly([(cx - 0.36 * s, cy - 0.04 * s), (cx + 0.36 * s, cy - 0.04 * s), (cx, cy + 0.4 * s)], col)


def leaf(cv, cx, cy, s, ang, col, vein=None):
    pts = []
    for t in np.linspace(0, math.pi, 24):
        pts.append((math.cos(t) * s, math.sin(t) * s * 0.42))
    for t in np.linspace(math.pi, 2 * math.pi, 24):
        pts.append((math.cos(t) * s, math.sin(t) * s * 0.42))
    ca, sa = math.cos(ang), math.sin(ang)
    cv.poly([(cx + x * ca - y * sa, cy + x * sa + y * ca) for x, y in pts], col)
    if vein:
        cv.line([(cx - s * 0.8 * ca, cy - s * 0.8 * sa), (cx + s * 0.8 * ca, cy + s * 0.8 * sa)], vein, s * 0.06)


def plate(text, size=0.1, bg=(255, 255, 255), border=None, fg=INK, ic=None, ic_col=None, h=None,
          arrow=None):
    """丸い名札。幅は文字の長さから決める"""
    tmp = Canvas(0.1, 0.1)
    tw = tmp.text_w(text, size)
    h = h or size * 2.1
    icw = size * 1.25 if ic else 0
    aw = size * 1.1 if arrow else 0
    w = tw + icw + aw + h * 0.9
    cv = Canvas(w, h)
    cv.rect(0, 0, w, h, border or bg, r=h / 2)
    lw = size * 0.13 if border else 0
    cv.rect(lw, lw, w - lw, h - lw, bg, r=h / 2 - lw)
    x = h * 0.45
    if ic:
        icon(cv, ic, x + icw * 0.45, h / 2, size * 1.05, ic_col or border or fg)
        x += icw
    cv.text(x + tw / 2, h / 2, text, size, fg)
    if arrow:
        ax, ay, s = x + tw + aw * 0.6, h / 2, size * 0.8
        cv.poly([(ax, ay - s * 0.55), (ax + s * 0.5, ay), (ax + s * 0.18, ay), (ax + s * 0.18, ay + s * 0.55),
                 (ax - s * 0.18, ay + s * 0.55), (ax - s * 0.18, ay), (ax - s * 0.5, ay)], fg)
    return cv


def kid_drawing(kind, seed):
    rng = np.random.default_rng(seed)
    w, h = 0.32, 0.25
    cv = Canvas(w, h + 0.03)
    cv.scale = 1.35
    cv.rect(0, 0.03, w, h + 0.03, (226, 220, 206))
    cv.rect(0.003, 0.033, w - 0.003, h + 0.027, (253, 252, 246))
    y0 = 0.03
    if kind == "sun":
        cv.rect(0.0, y0 + 0.19, w, h + 0.03, (190, 226, 150))
        cx, cy = 0.16, y0 + 0.1
        for i in range(10):
            a = i * math.pi / 5
            cv.line([(cx + 0.06 * math.cos(a), cy + 0.06 * math.sin(a)),
                     (cx + 0.09 * math.cos(a), cy + 0.09 * math.sin(a))], (250, 160, 70), 0.012)
        cv.ellipse(cx, cy, 0.05, 0.05, (255, 210, 70))
        cv.ellipse(cx - 0.017, cy - 0.005, 0.006, 0.008, (90, 70, 60))
        cv.ellipse(cx + 0.017, cy - 0.005, 0.006, 0.008, (90, 70, 60))
        cv.line([(cx - 0.018, cy + 0.02), (cx, cy + 0.028), (cx + 0.018, cy + 0.02)], (220, 90, 80), 0.005)
    elif kind == "flower":
        cv.rect(0.0, y0 + 0.2, w, h + 0.03, (186, 222, 140))
        for fx, col in ((0.09, (246, 150, 170)), (0.23, (170, 150, 230))):
            cv.line([(fx, y0 + 0.1), (fx, y0 + 0.21)], (90, 170, 90), 0.01)
            leaf(cv, fx + 0.025, y0 + 0.17, 0.025, -0.5, (110, 185, 100))
            for i in range(6):
                a = i * math.pi / 3
                cv.ellipse(fx + 0.028 * math.cos(a), y0 + 0.09 + 0.028 * math.sin(a), 0.02, 0.02, col)
            cv.ellipse(fx, y0 + 0.09, 0.016, 0.016, (255, 214, 90))
    elif kind == "house":
        cv.rect(0.0, y0 + 0.2, w, h + 0.03, (196, 228, 150))
        cv.ellipse(0.27, y0 + 0.045, 0.025, 0.025, (255, 200, 80))
        cv.rect(0.08, y0 + 0.11, 0.22, y0 + 0.21, (250, 178, 140))
        cv.poly([(0.06, y0 + 0.115), (0.15, y0 + 0.04), (0.24, y0 + 0.115)], (210, 110, 100))
        cv.rect(0.135, y0 + 0.15, 0.17, y0 + 0.21, (150, 110, 80))
        cv.rect(0.095, y0 + 0.13, 0.12, y0 + 0.155, (150, 200, 240))
        cv.rect(0.185, y0 + 0.13, 0.21, y0 + 0.155, (150, 200, 240))
    elif kind == "rainbow":
        cols = [(240, 120, 120), (250, 180, 100), (250, 225, 110), (140, 210, 130), (120, 180, 230), (170, 140, 220)]
        for i, c in enumerate(cols):
            cv.arc(0.16, y0 + 0.2, 0.13 - i * 0.014, 180, 360, c, 0.014)
        cv.ellipse(0.05, y0 + 0.2, 0.035, 0.02, (255, 255, 255), outline=(200, 215, 230), lw=0.004)
        cv.ellipse(0.27, y0 + 0.2, 0.035, 0.02, (255, 255, 255), outline=(200, 215, 230), lw=0.004)
    elif kind == "face":
        cx, cy = 0.16, y0 + 0.12
        cv.ellipse(cx, cy, 0.075, 0.07, (255, 222, 196))
        cv.ellipse(cx, cy - 0.06, 0.07, 0.03, (120, 85, 60))
        cv.ellipse(cx - 0.027, cy, 0.008, 0.011, (70, 55, 50))
        cv.ellipse(cx + 0.027, cy, 0.008, 0.011, (70, 55, 50))
        cv.ellipse(cx - 0.045, cy + 0.022, 0.013, 0.008, (250, 170, 170))
        cv.ellipse(cx + 0.045, cy + 0.022, 0.013, 0.008, (250, 170, 170))
        cv.line([(cx - 0.02, cy + 0.03), (cx, cy + 0.042), (cx + 0.02, cy + 0.03)], (210, 90, 90), 0.006)
    elif kind == "fish":
        cv.rect(0.0, y0, w, h + 0.03, (214, 236, 250))
        cv.ellipse(0.14, y0 + 0.13, 0.07, 0.045, (250, 170, 90))
        cv.poly([(0.2, y0 + 0.13), (0.26, y0 + 0.09), (0.26, y0 + 0.17)], (250, 140, 80))
        cv.ellipse(0.1, y0 + 0.12, 0.009, 0.009, (60, 50, 50))
        for bx, by, r in ((0.05, y0 + 0.06, 0.012), (0.07, y0 + 0.03 + 0.01, 0.008)):
            cv.ellipse(bx, by, r, r, (240, 250, 255), outline=(150, 190, 230), lw=0.003)
    # マスキングテープ
    cv.rect(w / 2 - 0.04, 0.0, w / 2 + 0.04, 0.05, (250, 226, 150))
    return cv, float(rng.uniform(-4, 4))


def garden_view(w, h, seed=3):
    """ガラス越しの園庭（発光扱い）。下端が床。"""
    rng = np.random.default_rng(seed)
    cv = Canvas(w, h, (255, 255, 255, 255))
    hz = h - EYE + 0.15
    cv.vgrad(0, 0, w, hz, (150, 200, 242), (222, 240, 252), emi=255)
    cv.vgrad(0, hz, w, h, (168, 214, 126), (128, 190, 98), emi=255)
    for cx, cy, s in ((w * 0.25, 0.25, 0.12), (w * 0.8, 0.4, 0.09)):
        for dx, dy, r in ((-1, 0.2, 0.8), (0, 0, 1.1), (1, 0.2, 0.85), (0.5, 0.35, 0.7), (-0.5, 0.35, 0.7)):
            cv.ellipse(cx + dx * s, cy + dy * s, r * s, r * s * 0.8, (255, 255, 255), emi=255)
    for i in range(14):   # 遠くの木
        x = i * w / 12 + rng.uniform(-0.05, 0.05)
        r = rng.uniform(0.12, 0.2)
        cv.ellipse(x, hz - r * 0.6, r, r, mix((110, 175, 100), (150, 200, 120), rng.uniform()), emi=255)
    # 柵
    for i in range(int(w / 0.09) + 1):
        x = i * 0.09
        cv.rect(x, hz + 0.02, x + 0.05, hz + 0.16, (250, 250, 244), r=0.02, emi=255)
    cv.rect(0, hz + 0.08, w, hz + 0.1, (240, 236, 226), emi=255)
    # すべり台
    sx, sy = w * 0.64, hz + 0.3
    cv.rect(sx, sy - 0.32, sx + 0.025, sy, (240, 120, 110), emi=255)
    cv.rect(sx + 0.12, sy - 0.32, sx + 0.145, sy, (240, 120, 110), emi=255)
    cv.rect(sx - 0.01, sy - 0.33, sx + 0.155, sy - 0.29, (250, 200, 90), emi=255)
    cv.poly([(sx + 0.145, sy - 0.31), (sx + 0.42, sy - 0.02), (sx + 0.42, sy + 0.01), (sx + 0.145, sy - 0.26)],
            (255, 214, 80), emi=255)
    # 砂場
    cv.ellipse(w * 0.22, hz + 0.42, 0.3, 0.07, (238, 214, 160), emi=255)
    cv.ellipse(w * 0.22, hz + 0.41, 0.26, 0.055, (245, 226, 178), emi=255)
    # 花
    for i in range(40):
        x = rng.uniform(0, w)
        y = rng.uniform(hz + 0.5, h - 0.03)
        r = 0.012 + (y - hz) * 0.012
        col = [(255, 160, 180), (255, 220, 100), (255, 255, 255), (200, 170, 240)][i % 4]
        cv.ellipse(x, y, r, r, col, emi=255)
    return cv


def street_view(w, h, seed=4):
    rng = np.random.default_rng(seed)
    cv = Canvas(w, h, (255, 255, 255, 255))
    hz = h - EYE + 0.1
    cv.vgrad(0, 0, w, hz, (156, 204, 240), (226, 242, 252), emi=255)
    cv.vgrad(0, hz, w, h, (214, 210, 200), (232, 228, 220), emi=255)
    for i in range(8):
        x = i * w / 6 + rng.uniform(-0.05, 0.05)
        cv.rect(x - 0.015, hz - 0.3, x + 0.015, hz + 0.05, (150, 120, 95), emi=255)
        r = rng.uniform(0.16, 0.24)
        cv.ellipse(x, hz - 0.38, r, r * 0.9, mix((120, 180, 110), (160, 205, 130), rng.uniform()), emi=255)
    cv.rect(0, hz, w, hz + 0.13, (128, 182, 110), r=0.04, emi=255)          # 生け垣
    for i in range(int(w / 0.25) + 1):                                        # 歩道の目地
        y = hz + 0.25 + i * 0.12
        if y < h:
            cv.rect(0, y, w, y + 0.006, (205, 200, 190), emi=255)
    return cv


def framed(kind, w=0.42, h=0.34):
    cv = Canvas(w, h)
    cv.rect(0, 0, w, h, (222, 198, 160), r=0.01)
    cv.rect(0.025, 0.025, w - 0.025, h - 0.025, (255, 255, 252))
    bx0, by0, bx1, by1 = 0.05, 0.05, w - 0.05, h - 0.05
    cx, cy = (bx0 + bx1) / 2, (by0 + by1) / 2
    if kind == "bear":
        cv.rect(bx0, by0, bx1, by1, (255, 238, 214))
        for dx in (-0.06, 0.06):
            cv.ellipse(cx + dx, cy - 0.055, 0.028, 0.028, (196, 150, 110))
            cv.ellipse(cx + dx, cy - 0.055, 0.015, 0.015, (236, 196, 160))
        cv.ellipse(cx, cy, 0.075, 0.068, (196, 150, 110))
        cv.ellipse(cx, cy + 0.02, 0.032, 0.024, (240, 214, 184))
        cv.ellipse(cx, cy + 0.01, 0.01, 0.007, (80, 60, 50))
        cv.ellipse(cx - 0.03, cy - 0.012, 0.007, 0.009, (60, 45, 40))
        cv.ellipse(cx + 0.03, cy - 0.012, 0.007, 0.009, (60, 45, 40))
        cv.ellipse(cx - 0.05, cy + 0.02, 0.012, 0.007, (240, 160, 150))
        cv.ellipse(cx + 0.05, cy + 0.02, 0.012, 0.007, (240, 160, 150))
    elif kind == "leaves":
        cv.rect(bx0, by0, bx1, by1, (238, 247, 240))
        cv.line([(cx - 0.02, by1 - 0.01), (cx + 0.01, by0 + 0.03)], (110, 150, 110), 0.006)
        for i, (dy, side) in enumerate(((0.07, -1), (0.035, 1), (0.0, -1), (-0.035, 1), (-0.07, -1))):
            col = [MINT, (150, 205, 150), (110, 180, 140)][i % 3]
            leaf(cv, cx + side * 0.04, cy + dy, 0.04, -0.5 * side - 0.3, col, vein=(250, 255, 250))
    elif kind == "whale":
        cv.rect(bx0, by0, bx1, by1, (224, 240, 252))
        cv.rect(bx0, cy + 0.04, bx1, by1, (180, 218, 245))
        cv.ellipse(cx - 0.01, cy + 0.01, 0.09, 0.05, (110, 160, 220))
        cv.poly([(cx + 0.07, cy + 0.01), (cx + 0.13, cy - 0.04), (cx + 0.12, cy + 0.02), (cx + 0.14, cy + 0.05)],
                (110, 160, 220))
        cv.ellipse(cx - 0.01, cy + 0.035, 0.07, 0.022, (200, 225, 245))
        cv.ellipse(cx - 0.06, cy - 0.005, 0.007, 0.007, (40, 50, 70))
        for a in (-0.4, 0, 0.4):
            cv.line([(cx - 0.03, cy - 0.04), (cx - 0.03 + 0.04 * math.sin(a), cy - 0.08)], (110, 170, 230), 0.006)
    return cv


def round_light(d=0.46):
    cv = Canvas(d + 0.04, d + 0.04)
    c = (d + 0.04) / 2
    cv.ellipse(c, c, c, c, (226, 222, 214))
    cv.ellipse(c, c, d / 2, d / 2, (255, 252, 240), emi=255)
    return cv


def panel_light(w=0.6, h=0.6):
    cv = Canvas(w, h)
    cv.rect(0, 0, w, h, (222, 224, 222))
    cv.rect(0.03, 0.03, w - 0.03, h - 0.03, (255, 255, 250), emi=255)
    return cv


# ---------------------------------------------------------------- 扉
def nursery_door(S, wall, wc, label, leaf_col, ic, w=0.95, h=2.0, small=False):
    f = 0.06
    frame = (212, 178, 132)
    cv = Canvas(w + 2 * f, h + f)
    cv.rect(0, 0, w + 2 * f, h + f, frame, r=0.015)
    cv.rect(f, f, f + w, h + f, shade_c(leaf_col, 0.7))
    lx0, ly0, lx1, ly1 = f + 0.012, f + 0.012, f + w - 0.012, h + f
    cv.rect(lx0, ly0, lx1, ly1, leaf_col, r=0.025)
    lite = mix(leaf_col, (255, 255, 255), 0.35)
    cv.rect(lx0 + 0.07, ly1 - 0.55, lx1 - 0.07, ly1 - 0.12, lite, r=0.05)                     # 下の板
    cv.rect(lx0 + 0.14, ly0 + 0.28, lx1 - 0.14, ly0 + 0.88, (255, 255, 255), r=0.1)           # 窓の縁
    cv.rect(lx0 + 0.165, ly0 + 0.305, lx1 - 0.165, ly0 + 0.855, (206, 226, 236), r=0.085)     # 窓
    cv.poly([(lx0 + 0.25, ly0 + 0.36), (lx0 + 0.33, ly0 + 0.36), (lx0 + 0.22, ly0 + 0.62), (lx0 + 0.19, ly0 + 0.55)],
            (232, 243, 248))
    hy = (h + f) - 1.0
    cv.rect(lx1 - 0.1, hy - 0.16, lx1 - 0.06, hy + 0.16, shade_c(leaf_col, 0.72), r=0.02)       # 取っ手
    # 下の板にかわいい印
    icon(cv, ic if ic not in ("toilet",) else "heart", (lx0 + lx1) / 2, ly1 - 0.33, 0.16, (255, 255, 255))
    S.f[wall].place(cv, wc, 0.0)
    pl = plate(label, size=0.085 if small else 0.1, border=shade_c(leaf_col, 0.9), ic=ic,
               ic_col=shade_c(leaf_col, 0.85) if ic != "toilet" else None)
    S.f[wall].place(pl, wc, h + 0.1)
    S.mark(label, wall, wc, h / 2)


def clinic_door(S, wall, wc, label, w=1.0, h=2.05, ic=None, small=False):
    """引き戸（明るい木目＋細いすりガラス＋縦の取っ手）"""
    f = 0.05
    frame = (214, 220, 218)
    cv = Canvas(w + 2 * f + 0.4, h + f)
    ox = 0.2
    cv.rect(ox, 0, ox + w + 2 * f, h + f, frame)
    cv.rect(ox + f, f, ox + f + w, h + f, (196, 200, 196))
    cv.rect(ox - 0.18, 0.0, ox + w + 2 * f + 0.18, 0.035, (200, 206, 204), r=0.01)     # 上のレール
    lx0, lx1 = ox + f + 0.01, ox + f + w - 0.01
    wood = (234, 216, 186)
    cv.rect(lx0, f + 0.01, lx1, h + f, wood, r=0.01)
    for i in range(1, 9):
        x = lx0 + i * (lx1 - lx0) / 9
        cv.rect(x, f + 0.02, x + 0.002, h + f - 0.01, (226, 206, 174))
    cv.rect(lx0 + 0.12, f + 0.25, lx0 + 0.22, f + 1.35, (238, 244, 242), r=0.01)          # すりガラス
    hy = (h + f) - 1.0
    cv.rect(lx1 - 0.11, hy - 0.3, lx1 - 0.075, hy + 0.3, (190, 196, 196), r=0.017)         # 取っ手
    cv.rect(lx0, h + f - 0.1, lx1, h + f, MINT_D)                                          # 足元
    S.f[wall].place(cv, wc, 0.0)
    pl = plate(label, size=0.085 if small else 0.1, bg=MINT, fg=(255, 255, 255), ic=ic,
               ic_col=(255, 255, 255) if ic != "toilet" else None, h=0.2 if small else 0.22)
    if ic == "toilet":
        pl = plate(label, size=0.085, bg=(255, 255, 255), border=MINT, fg=CL_INK, ic="toilet", h=0.2)
    S.f[wall].place(pl, wc, h + 0.1)
    S.mark(label, wall, wc, h / 2)


def opening(S, wall, wc, w, h, view, frame, label_cv, name, f=0.07):
    """絵を描いた開口（view は Persp か Canvas）"""
    vc = view.cv if isinstance(view, Persp) else view
    cv = Canvas(w + 2 * f, h + f)
    cv.rect(0, 0, w + 2 * f, h + f, frame, r=0.012)
    cv.paste(vc, f, f)
    S.f[wall].place(cv, wc, 0.0)
    if label_cv:
        S.f[wall].place(label_cv, wc, h + f + 0.06)
    S.mark(name, wall, wc, h / 2)


# ---------------------------------------------------------------- A. ひだまり保育園 ろうか
def scene_hidamari():
    S = Scene("hidamari", (0, 0, 0), (2.4, 2.6, 8.0), wall_base=(251, 246, 232), ceil_base=(251, 249, 243))
    S.nodes = {"hall1": (1.2, EYE, 6.0), "hall2": (1.2, EYE, 3.0)}
    wood_floor(S.f["floor"])
    for wl in S.walls():
        nursery_wall(wl)
    for z in (1.0, 3.0, 5.0, 7.0):
        S.f["ceil"].place(round_light(), 1.2, z)
        S.lights.append(((1.2, 2.5, z), 0.55))

    nursery_door(S, "west", 6.6, "きゅうしょくしつ", (252, 210, 160), "star")
    nursery_door(S, "west", 2.6, "1・2さいじ", (176, 214, 240), "flower")
    nursery_door(S, "east", 5.4, "0さいじ", (248, 198, 208), "heart")
    nursery_door(S, "east", 1.6, "トイレ", (182, 226, 200), "toilet", w=0.85, small=True)

    # 北: 園庭へのガラスの両開き戸
    w, h, f = 1.6, 2.15, 0.07
    cv = Canvas(w + 2 * f, h + f)
    cv.paste(garden_view(w, h), f, f)
    fr = (214, 180, 134)
    cv.rect(0, 0, w + 2 * f, f, fr)
    cv.rect(0, 0, f, h + f, fr)
    cv.rect(w + f, 0, w + 2 * f, h + f, fr)
    for x0 in (f, f + w / 2):           # 2 枚の戸のかまち
        cv.rect(x0, f, x0 + 0.05, h + f, (246, 242, 234))
        cv.rect(x0 + w / 2 - 0.05, f, x0 + w / 2, h + f, (246, 242, 234))
        cv.rect(x0, f, x0 + w / 2, f + 0.05, (246, 242, 234))
        cv.rect(x0, h + f - 0.14, x0 + w / 2, h + f, (246, 242, 234))
        cv.rect(x0, h + f - 1.0, x0 + w / 2, h + f - 0.95, (246, 242, 234))   # 子どもの手の高さの桟
    cv.rect(f + w / 2 - 0.09, h + f - 1.15, f + w / 2 - 0.065, h + f - 0.85, (200, 190, 170), r=0.01)
    cv.rect(f + w / 2 + 0.065, h + f - 1.15, f + w / 2 + 0.09, h + f - 0.85, (200, 190, 170), r=0.01)
    S.f["north"].place(cv, 1.2, 0.0)
    S.f["north"].place(plate("えんてい", size=0.1, border=(150, 200, 110), ic="flower", ic_col=(240, 150, 170)),
                       1.2, h + f + 0.06)
    S.mark("えんてい", "north", 1.2, h / 2)

    # 南: 玄関への開口（くつばこの見える絵）
    w, h = 1.9, 2.2
    pv = Persp(w, h, D=2.5)
    pv.room(-0.7, w + 0.7, 2.6, 3.2, (250, 244, 228), (230, 203, 162), (250, 248, 242),
            band=(0, 0.9, (240, 223, 192)))
    pv.qy(-0.15, -0.7, w + 0.7, 1.0, 3.2, (208, 202, 192))          # 土間
    for i in range(1, 8):
        pv.qy(-0.149, -0.7, w + 0.7, 1.0 + i * 0.3, 1.0 + i * 0.3 + 0.012, (190, 184, 174))
    pv.qd(1.0, -0.7, w + 0.7, -0.15, 0.0, (196, 162, 120))          # 上がり框
    pv.qy(0.0, -0.7, w + 0.7, 0.0, 1.0, (230, 203, 162))
    cx = w / 2
    pv.qd(3.199, cx - 0.62, cx + 0.62, -0.15, 2.12, (214, 180, 134))   # ガラス戸の枠
    for x0 in (cx - 0.56, cx + 0.03):    # ガラス戸（発光）
        for k, c in enumerate(((228, 242, 250), (216, 236, 250), (196, 226, 248), (176, 214, 244))):
            pv.qd(3.198, x0, x0 + 0.53, 0.75 + k * 0.33, 2.06, c, emi=255)
        pv.qd(3.197, x0, x0 + 0.53, 0.35, 0.75, (150, 200, 120), emi=255)
        pv.qd(3.197, x0, x0 + 0.53, -0.1, 0.35, (226, 222, 212), emi=255)
    rng = np.random.default_rng(7)
    shoe_cols = [(240, 120, 120), (120, 170, 230), (250, 200, 90), (140, 200, 140), (240, 160, 200)]
    for xa, xb in ((-0.6, cx - 0.75), (cx + 0.75, w + 0.6)):     # 奥の壁にくつばこ
        pv.box(xa, xb, -0.15, 1.25, 2.8, 3.19, (214, 182, 138), (226, 196, 154), (200, 168, 126))
        nx = max(1, int((xb - xa - 0.04) / 0.26))
        cw = (xb - xa - 0.04) / nx
        for i in range(nx):
            for j in range(4):
                x0, y0 = xa + 0.02 + i * cw, 0.0 + j * 0.3
                pv.qd(2.799, x0 + 0.015, x0 + cw - 0.015, y0, y0 + 0.27, (246, 232, 206))
                if rng.uniform() < 0.7:
                    c = shoe_cols[int(rng.integers(len(shoe_cols)))]
                    pv.qd(2.798, x0 + 0.04, x0 + cw / 2 - 0.005, y0 + 0.02, y0 + 0.1, c)
                    pv.qd(2.798, x0 + cw / 2 + 0.005, x0 + cw - 0.04, y0 + 0.02, y0 + 0.1, c)
    for side_x, d0 in ((-0.7, 1.2), (w + 0.7, 1.2)):    # 両側の壁にもくつばこ
        for i in range(5):
            for j in range(4):
                da, db = d0 + i * 0.3, d0 + (i + 1) * 0.3 - 0.02
                ya, yb = 0.0 + j * 0.3, 0.0 + (j + 1) * 0.3 - 0.03
                pv.qx(side_x, ya - 0.02, yb + 0.02, da - 0.01, db + 0.01, (214, 182, 138))
                pv.qx(side_x, ya, yb, da, db, (246, 232, 206))
                if rng.uniform() < 0.6:
                    c = shoe_cols[int(rng.integers(len(shoe_cols)))]
                    pv.qx(side_x, ya + 0.02, ya + 0.1, da + 0.05, db - 0.05, c)
    opening(S, "south", 1.2, w, h, pv, (212, 178, 132),
            plate("げんかん", size=0.1, border=(240, 180, 120), ic="star", ic_col=(250, 190, 90)), "げんかん")

    # 子どもの絵
    kinds = ["sun", "flower", "house", "rainbow", "face", "fish"]
    spots = [("west", 4.0), ("west", 4.5), ("west", 5.0), ("west", 5.6), ("east", 3.0), ("east", 3.55),
             ("east", 4.1), ("east", 7.0), ("west", 1.0), ("east", 0.55)]
    for i, (wl, wc) in enumerate(spots):
        cv, rot = kid_drawing(kinds[i % len(kinds)], i)
        S.f[wl].place(cv, wc, 1.3 + 0.08 * ((i * 37) % 3), rot)

    # 西の壁ぎわに低いおもちゃ棚
    wood, wtop = (232, 206, 164), (240, 218, 180)
    S.boxes.append(Box((0.0, 0.0, 3.7), (0.34, 0.62, 5.5), wood, wtop))
    cols = [(250, 190, 170), (176, 214, 240), (250, 226, 150), (190, 228, 196), (240, 196, 220), (200, 200, 240)]
    for i in range(3):
        for j in range(2):
            z0 = 3.76 + i * 0.58
            y0 = 0.07 + j * 0.27
            S.boxes.append(Box((0.06, y0, z0), (0.355, y0 + 0.23, z0 + 0.52), cols[i * 2 + j], k=0.15, s=0.05))
    S.spheres.append(Sphere((0.17, 0.62 + 0.09, 4.0), 0.09, (240, 110, 100)))
    S.boxes.append(Box((0.08, 0.62, 4.9), (0.2, 0.74, 5.02), (250, 210, 90), k=0.2, s=0.05))
    S.boxes.append(Box((0.1, 0.74, 4.92), (0.2, 0.84, 5.02), (130, 190, 230), k=0.2, s=0.05))
    S.boxes.append(Box((0.1, 0.62, 5.1), (0.22, 0.72, 5.22), (150, 205, 140), k=0.2, s=0.05))
    return S


# ---------------------------------------------------------------- B. みどりこどもクリニック 受付
def scene_reception():
    S = Scene("midori", (-2, 0, 6), (6, 2.7, 11), wall_base=(251, 252, 250), ceil_base=(250, 250, 248))
    S.nodes = {"reception": (2.0, EYE, 9.0)}
    vinyl_floor(S.f["floor"])
    for wl in S.walls():
        clinic_wall(wl)
    for x in (-0.5, 2.0, 4.6):
        for z in (7.6, 9.9):
            S.f["ceil"].place(panel_light(), x, z)
            S.lights.append(((x, 2.62, z), 0.42))

    # 受付カウンター
    S.boxes.append(Box((0.5, 0.0, 6.3), (3.5, 1.0, 7.1), (250, 250, 247), stripes=((0.0, 0.08, MINT_D),
                                                                                    (0.78, 0.84, MINT))))
    S.boxes.append(Box((0.44, 1.0, 6.26), (3.56, 1.06, 7.2), (228, 204, 166), (234, 214, 180), k=0.3, s=0.08))
    # カウンター上の小さな鉢
    S.boxes.append(Box((3.12, 1.06, 6.55), (3.3, 1.2, 6.73), (250, 250, 246), k=0.2, s=0.05))
    for dx, dy, dz, r in ((0, 0.28, 0, 0.1), (-0.06, 0.24, 0.03, 0.07), (0.06, 0.25, -0.02, 0.07)):
        S.spheres.append(Sphere((3.21 + dx, 1.06 + dy, 6.64 + dz), r, (120, 186, 120)))
    # 観葉植物
    for (px, pz) in ((-1.55, 6.45), (5.5, 10.5)):
        S.boxes.append(Box((px - 0.18, 0, pz - 0.18), (px + 0.18, 0.42, pz + 0.18), (246, 246, 240),
                           stripes=((0.36, 0.42, MINT),)))
        for dx, dy, dz, r in ((0, 0.95, 0, 0.26), (-0.14, 0.7, 0.08, 0.2), (0.15, 0.75, -0.06, 0.2),
                              (0.03, 0.62, 0.15, 0.17), (0.05, 1.18, -0.03, 0.17)):
            S.spheres.append(Sphere((px + dx, dy, pz + dz), r, mix((96, 168, 100), (140, 200, 120), (dy - 0.6))))

    N = S.f["north"]
    sign = Canvas(1.2, 0.42)
    sign.rect(0, 0, 1.2, 0.42, MINT, r=0.08)
    icon(sign, "leaf", 0.3, 0.21, 0.24, (255, 255, 255))
    sign.text(0.66, 0.215, "受付", 0.24, (255, 255, 255))
    N.place(sign, 2.0, 1.72)
    N.place(plate("ご予約・お会計", size=0.085, border=MINT, fg=CL_INK, h=0.18), 2.0, 1.42)
    # 時計とおしらせ
    clk = Canvas(0.36, 0.36)
    clk.ellipse(0.18, 0.18, 0.18, 0.18, MINT)
    clk.ellipse(0.18, 0.18, 0.155, 0.155, (255, 255, 255))
    for i in range(12):
        a = i * math.pi / 6
        clk.ellipse(0.18 + 0.13 * math.cos(a), 0.18 + 0.13 * math.sin(a), 0.008, 0.008, CL_INK)
    clk.line([(0.18, 0.18), (0.18 - 0.07 * math.cos(math.radians(30)), 0.18 - 0.07 * math.sin(math.radians(30)))],
             CL_INK, 0.012)
    clk.line([(0.18, 0.18), (0.18 + 0.1 * math.cos(math.radians(30)), 0.18 - 0.1 * math.sin(math.radians(30)))],
             CL_INK, 0.008)
    N.place(clk, -0.8, 1.95)
    nb = Canvas(1.1, 0.72)
    nb.rect(0, 0, 1.1, 0.72, MINT, r=0.03)
    nb.rect(0.03, 0.03, 1.07, 0.69, (255, 255, 255), r=0.02)
    nb.text(0.55, 0.1, "おしらせ", 0.07, CL_INK)
    for i, (x, y, c) in enumerate(((0.08, 0.18, (255, 236, 200)), (0.4, 0.2, (220, 240, 250)),
                                   (0.74, 0.17, (240, 230, 250)))):
        nb.rect(x, y, x + 0.28, y + 0.42, c)
        for j in range(5):
            nb.rect(x + 0.04, y + 0.07 + j * 0.065, x + 0.24 - (j % 2) * 0.06, y + 0.085 + j * 0.065,
                    (190, 196, 196))
    N.place(nb, -0.8, 1.0)

    # 北: 診察室への廊下の開口（x≈4.8）
    w, h = 2.2, 2.3
    pv = Persp(w, h, D=3.0)
    L = 9.0
    pv.room(-0.1, 2.3, 2.6, L, (251, 252, 250), (238, 235, 228), (250, 250, 248), band=(0, 0.9, MINT_L))
    for xs in (-0.1, 2.3):
        pv.qx(xs, 0.9, 0.94, 0, L, MINT)
        pv.qx(xs, 0.78, 0.82, 0, L, (222, 204, 170))
    for d in (1.0, 3.25, 5.5, 7.75):
        pv.qy(2.599, 0.9, 1.4, d - 0.25, d + 0.25, (255, 255, 250), emi=255)
    for xs, d in ((-0.1, 2.5), (-0.1, 6.5), (2.3, 4.0)):
        pv.qx(xs, 0, 2.05, d - 0.5, d + 0.5, (234, 216, 186))
        pv.qx(xs, 2.1, 2.3, d - 0.3, d + 0.3, MINT)
    pv.qd(L, 0.65, 1.65, 0, 2.05, (234, 216, 186))
    pv.qd(L, 0.75, 1.55, 2.12, 2.32, MINT)
    opening(S, "north", 4.8, w, h, pv, (214, 220, 218),
            plate("診察室", size=0.1, bg=MINT, fg=(255, 255, 255), arrow=True, h=0.22), "診察室")

    # 西: 待合室への広い開口
    w, h = 3.0, 2.3
    pv = Persp(w, h, D=3.0)
    pv.room(-1.5, 4.0, 2.7, 5.0, (251, 252, 250), (238, 235, 228), (250, 250, 248), band=(0, 0.9, MINT_L))
    for x0 in (-0.8, 1.0, 2.8):     # 奥の窓（発光）
        pv.qd(4.999, x0, x0 + 1.3, 1.0, 2.2, (232, 244, 252), emi=255)
        pv.qd(4.998, x0, x0 + 1.3, 1.0, 1.35, (190, 225, 175), emi=255)
    for x in (-1.0, 0.5, 2.0, 3.5):
        pv.qy(2.699, x - 0.3, x + 0.3, 1.5 - 0.3, 1.5 + 0.3, (255, 255, 250), emi=255)
        pv.qy(2.699, x - 0.3, x + 0.3, 3.6 - 0.3, 3.6 + 0.3, (255, 255, 250), emi=255)
    pv.disc(2.6, 2.6, 0.8, (250, 226, 170))                   # キッズスペースのラグ
    pv.disc(2.6, 2.6, 0.6, (252, 236, 196))
    for x0, c in ((-1.2, MINT), (0.5, (250, 210, 120)), (2.2, MINT)):   # 長いす
        pv.box(x0, x0 + 1.4, 0.0, 0.42, 4.3, 4.8, shade_c(c, 0.9), c, shade_c(c, 0.8))
        pv.qd(4.85, x0, x0 + 1.4, 0.42, 0.8, shade_c(c, 0.95))
    pv.box(2.35, 2.85, 0.0, 0.32, 2.4, 2.8, (250, 196, 170), (252, 214, 196), (240, 180, 156))  # 小さなつくえ
    pv.box(-1.1, -0.5, 0.0, 0.45, 1.0, 2.0, (236, 222, 196), (244, 232, 210), (226, 210, 182))  # 絵本棚
    opening(S, "west", 8.5, w, h, pv, (214, 220, 218),
            plate("待合室", size=0.11, bg=MINT, fg=(255, 255, 255), ic="heart", ic_col=(255, 255, 255), h=0.24),
            "待合室")

    # 南: 自動ドアの出入口
    w, h = 1.8, 2.2
    cv = Canvas(w + 0.16, h + 0.12)
    cv.paste(street_view(w, h), 0.08, 0.12)
    met = (206, 212, 212)
    cv.rect(0, 0, w + 0.16, 0.12, met)
    cv.rect(0, 0, 0.08, h + 0.12, met)
    cv.rect(w + 0.08, 0, w + 0.16, h + 0.12, met)
    for x0 in (0.08, 0.08 + w / 2):
        cv.rect(x0, 0.12, x0 + 0.035, h + 0.12, met)
        cv.rect(x0 + w / 2 - 0.035, 0.12, x0 + w / 2, h + 0.12, met)
        cv.rect(x0, 0.12, x0 + w / 2, 0.16, met)
        cv.rect(x0, h + 0.12 - 0.06, x0 + w / 2, h + 0.12, met)
        cx = x0 + w / 4
        cv.ellipse(cx, h + 0.12 - 1.05, 0.085, 0.085, MINT)
        cv.text(cx, h + 0.12 - 1.05, "自動", 0.045, (255, 255, 255))
    cv.rect(w / 2 - 0.12, 0.03, w / 2 + 0.28, 0.09, (180, 186, 186), r=0.01)   # センサー
    S.f["south"].place(cv, 2.0, 0.0)
    S.f["south"].place(plate("出入口", size=0.1, bg=MINT, fg=(255, 255, 255), h=0.22), 2.0, h + 0.2)
    S.mark("出入口", "south", 2.0, h / 2)
    mat = Canvas(1.8, 0.9)
    mat.rect(0, 0, 1.8, 0.9, (120, 140, 132), r=0.04)
    mat.rect(0.05, 0.05, 1.75, 0.85, (138, 160, 150), r=0.03)
    S.f["floor"].place(mat, 2.0, 10.5)

    # 東: クリニック名と診療時間
    E = S.f["east"]
    nm = Canvas(2.3, 0.36)
    nm.rect(0, 0, 2.3, 0.36, (255, 255, 255), r=0.06)
    icon(nm, "leaf", 0.25, 0.18, 0.26, MINT)
    nm.text(1.2, 0.185, "みどりこどもクリニック", 0.15, CL_INK)
    E.place(nm, 8.5, 1.95)
    hb = Canvas(1.3, 0.72)
    hb.rect(0, 0, 1.3, 0.72, MINT, r=0.04)
    hb.rect(0.03, 0.12, 1.27, 0.69, (255, 255, 255), r=0.03)
    hb.text(0.65, 0.065, "診療時間", 0.065, (255, 255, 255))
    rows = (("月〜金", "9:00〜12:00"), ("", "15:00〜18:00"), ("土", "9:00〜12:00"), ("休診", "日・祝"))
    for i, (a, b) in enumerate(rows):
        y = 0.21 + i * 0.125
        hb.text(0.28, y, a, 0.06, CL_INK)
        hb.text(0.82, y, b, 0.06, CL_INK)
    E.place(hb, 8.5, 1.05)
    E.place(framed("leaves"), 10.1, 1.35)
    return S


# ---------------------------------------------------------------- C. みどりこどもクリニック 廊下
def scene_corridor():
    S = Scene("midori", (3.6, 0, -3), (6.0, 2.6, 6), wall_base=(251, 252, 250), ceil_base=(250, 250, 248))
    S.nodes = {"hall1": (4.8, EYE, 4.5), "hall2": (4.8, EYE, 2.0), "hall3": (4.8, EYE, -0.5)}
    vinyl_floor(S.f["floor"])
    for wl in S.walls():
        clinic_wall(wl)
    for z in (5.0, 2.75, 0.5, -1.75):
        S.f["ceil"].place(panel_light(0.5, 0.5), 4.8, z)
        S.lights.append(((4.8, 2.55, z), 0.5))

    clinic_door(S, "north", 4.8, "診察室1", w=1.1, ic="star")
    clinic_door(S, "east", 2.0, "処置室・休養室", ic="heart")
    clinic_door(S, "west", -0.5, "診察室2", ic="star")
    clinic_door(S, "west", 3.5, "トイレ", w=0.9, ic="toilet", small=True)

    # 南: 受付へ戻る開口（受付の絵）
    w, h = 2.2, 2.3
    pv = Persp(w, h, D=3.0)
    # 開口の左端 = 東 (x=5.9)。受付の部屋は x -2..6 → 開口座標 xo = 5.9 - x
    pv.room(-0.1, 7.9, 2.7, 5.0, (251, 252, 250), (238, 235, 228), (250, 250, 248), band=(0, 0.9, MINT_L))
    for xo in (1.3, 3.9, 6.4):
        for d in (1.6, 3.9):
            pv.qy(2.699, xo - 0.3, xo + 0.3, d - 0.3, d + 0.3, (255, 255, 250), emi=255)
    pv.qd(4.999, 3.0, 4.8, 0.0, 2.2, (232, 244, 252), emi=255)        # 出入口（x=2.0）
    pv.qd(4.998, 3.0, 4.8, 0.0, 0.45, (200, 220, 190), emi=255)
    pv.qd(4.997, 3.88, 3.92, 0.0, 2.2, (206, 212, 212))
    pv.qy(0.003, 3.0, 4.8, 4.1, 5.0, (138, 160, 150))
    pv.qx(-0.1, 1.05, 1.75, 2.1, 3.2, MINT)                            # 東の壁の診療時間
    pv.qx(-0.1, 1.95, 2.3, 1.3, 3.6, (255, 255, 255))
    # カウンター（x 0.5..3.5 → xo 2.4..5.4, d 0.3..1.1）
    pv.box(2.4, 5.4, 0.0, 1.06, 0.3, 1.1, (250, 250, 247), (234, 214, 180), (240, 240, 236))
    pv.qd(0.3, 2.4, 5.4, 0.0, 0.08, MINT_D)
    pv.qd(0.3, 2.4, 5.4, 0.78, 0.84, MINT)
    opening(S, "south", 4.8, w, h, pv, (214, 220, 218),
            plate("受付", size=0.11, bg=MINT, fg=(255, 255, 255), ic="leaf", ic_col=(255, 255, 255), h=0.24),
            "受付")

    # 手すり（扉の前で切る）
    rail, br = (226, 206, 172), 0.04
    for x0, x1, segs in ((3.6, 3.6 + 0.085, ((4.05, 6.0), (0.05, 2.95), (-3.0, -1.05))),
                         (6.0 - 0.085, 6.0, ((2.6, 6.0), (-3.0, 1.4)))):
        xa, xb = (x1 - br, x1) if x0 == 3.6 else (x0, x0 + br)
        for z0, z1 in segs:
            S.boxes.append(Box((xa, 0.78, z0 + 0.06), (xb, 0.82, z1 - 0.06), rail, k=0.35, s=0.06))
            for zb in (z0 + 0.15, z1 - 0.15):   # 受け金具
                S.boxes.append(Box((min(x0, x1), 0.76, zb - 0.015), (max(x0, x1), 0.78, zb + 0.015),
                                   (200, 204, 204), k=0.2, s=0.03))
    # 絵
    S.f["east"].place(framed("bear"), 4.2, 1.35)
    S.f["east"].place(framed("whale"), -1.3, 1.35)
    S.f["west"].place(framed("leaves"), 1.5, 1.35)
    return S


SCENES = {
    "hidamari": [scene_hidamari],
    "midori": [scene_reception, scene_corridor],
}


# ---------------------------------------------------------------- レイトレース
def bilerp(T, x, y):
    h, w = T.shape[:2]
    x = np.clip(x - 0.5, 0, w - 1)
    y = np.clip(y - 0.5, 0, h - 1)
    x0 = np.floor(x).astype(np.int32)
    y0 = np.floor(y).astype(np.int32)
    x1 = np.minimum(x0 + 1, w - 1)
    y1 = np.minimum(y0 + 1, h - 1)
    fx = (x - x0)[:, None]
    fy = (y - y0)[:, None]
    return (T[y0, x0] * (1 - fx) + T[y0, x1] * fx) * (1 - fy) + (T[y1, x0] * (1 - fx) + T[y1, x1] * fx) * fy


def sample(levels, px, py, lod):
    """ミップマップを使って 2 段のあいだを混ぜる（遠くの床がちらつかない）"""
    lod = np.clip(lod, 0, len(levels) - 1.001)
    l0 = np.floor(lod).astype(np.int32)
    fr = (lod - l0)[:, None]
    out = np.empty((len(px), 4), np.float32)
    for L in np.unique(l0):
        m = l0 == L
        s = 0.5 ** L
        a = bilerp(levels[L], px[m] * s, py[m] * s)
        b = bilerp(levels[L + 1], px[m] * s * 0.5, py[m] * s * 0.5)
        out[m] = a * (1 - fr[m]) + b * fr[m]
    return out


def aabb_dist(p, lo, hi):
    q = np.maximum(np.maximum(lo - p, 0), p - hi)
    return np.sqrt((q * q).sum(1))


def shell_ao(S, p, skip_axis=None, face_sign=None, k=0.24, s=0.2):
    """殻の面（壁・床・天井）に近いほど暗くする"""
    ao = np.ones(len(p), np.float32)
    for ax in range(3):
        for bound, sgn in ((S.lo[ax], -1), (S.hi[ax], 1)):
            if ax == skip_axis and face_sign is not None and sgn != face_sign:
                continue
            if ax == skip_axis and face_sign is None:
                continue
            d = np.abs(p[:, ax] - bound)
            kk = k * (1.25 if (ax == 1 and sgn < 0) else (0.7 if ax == 1 else 1.0))
            ao *= 1 - kk * np.exp(-d / s)
    return ao


def trace_shade(S, o, d, dang):
    N = len(d)
    d = np.where(np.abs(d) < 1e-9, 1e-9, d).astype(np.float32)
    inv = 1.0 / d
    o = np.asarray(o, np.float32)
    tb = np.where(d > 0, (S.hi - o) * inv, (S.lo - o) * inv)
    axis = np.argmin(tb, axis=1)
    idx = np.arange(N)
    t = tb[idx, axis]
    face = axis * 2 + (d[idx, axis] > 0)     # 0 西 1 東 2 床 3 天井 4 北 5 南
    obj = np.full(N, -1, np.int32)
    bax = np.zeros(N, np.int32)
    for i, b in enumerate(S.boxes):
        t1 = (b.lo - o) * inv
        t2 = (b.hi - o) * inv
        tmin3 = np.minimum(t1, t2)
        tn = tmin3.max(1)
        tf = np.maximum(t1, t2).min(1)
        hit = (tn <= tf) & (tn > 1e-4) & (tn < t)
        if hit.any():
            t[hit] = tn[hit]
            obj[hit] = i
            bax[hit] = tmin3[hit].argmax(1)
    for j, sp in enumerate(S.spheres):
        oc = o - sp.c
        bq = d @ oc
        cq = oc @ oc - sp.r * sp.r
        disc = bq * bq - cq
        ok = disc > 0
        ts = np.where(ok, -bq - np.sqrt(np.maximum(disc, 0)), np.inf)
        hit = ok & (ts > 1e-4) & (ts < t)
        t[hit] = ts[hit]
        obj[hit] = 10000 + j

    p = o + t[:, None] * d
    alb = np.zeros((N, 3), np.float32)
    emi = np.zeros(N, np.float32)
    nrm = np.zeros((N, 3), np.float32)
    ao = np.ones(N, np.float32)
    x0, y0, z0 = S.lo
    x1, y1, z1 = S.hi
    H = S.H

    # 殻の面
    for fi, name in enumerate(FACE_NAMES):
        m = (obj == -1) & (face == fi)
        if not m.any():
            continue
        q = p[m]
        ax = fi // 2
        if name == "west":
            u, v = z1 - q[:, 2], H - q[:, 1]
        elif name == "east":
            u, v = q[:, 2] - z0, H - q[:, 1]
        elif name == "north":
            u, v = q[:, 0] - x0, H - q[:, 1]
        elif name == "south":
            u, v = x1 - q[:, 0], H - q[:, 1]
        else:
            u, v = q[:, 0] - x0, q[:, 2] - z0
        cosi = np.maximum(np.abs(d[m, ax]), 0.05)
        foot = t[m] * dang / cosi ** 0.75
        lod = np.log2(np.maximum(foot * PPM, 1e-6)) - 0.4
        smp = sample(S.f[name].levels, u * PPM, v * PPM, lod)
        alb[m] = smp[:, :3]
        emi[m] = smp[:, 3]
        n = np.zeros(3, np.float32)
        n[ax] = 1.0 if fi % 2 == 0 else -1.0
        nrm[m] = n
        a = shell_ao(S, q, skip_axis=ax)
        for b in S.boxes:
            a *= 1 - b.k * np.exp(-aabb_dist(q, b.lo, b.hi) / b.s)
        for sp in S.spheres:
            dd = np.maximum(np.sqrt(((q - sp.c) ** 2).sum(1)) - sp.r, 0)
            a *= 1 - sp.k * np.exp(-dd / (0.25 * sp.r + 0.05))
        ao[m] = a

    # 箱
    for i, b in enumerate(S.boxes):
        m = obj == i
        if not m.any():
            continue
        q = p[m]
        ax = bax[m]
        sgn = -np.sign(d[m][np.arange(m.sum()), ax])
        n = np.zeros((len(q), 3), np.float32)
        n[np.arange(len(q)), ax] = sgn
        nrm[m] = n
        col = np.tile(np.power(np.array(b.side, np.float32) / 255, 2.2), (len(q), 1))
        top = (ax == 1) & (sgn > 0)
        col[top] = np.power(np.array(b.top, np.float32) / 255, 2.2)
        for ya, yb, c in b.stripes:
            mm = (~top) & (ax != 1) & (q[:, 1] >= ya) & (q[:, 1] < yb)
            col[mm] = np.power(np.array(c, np.float32) / 255, 2.2)
        alb[m] = col
        a = np.ones(len(q), np.float32)
        for axs in range(3):
            for bound, bs in ((S.lo[axs], -1), (S.hi[axs], 1)):
                dist = np.abs(q[:, axs] - bound)
                facing = (ax == axs) & (sgn == bs)
                use = (ax != axs) | facing
                kk = 0.42 if (axs == 1 and bs < 0) else (0.12 if axs == 1 else 0.25)
                a *= np.where(use, 1 - kk * np.exp(-dist / 0.14), 1)
        ao[m] = a

    # 球
    for j, sp in enumerate(S.spheres):
        m = obj == 10000 + j
        if not m.any():
            continue
        n = (p[m] - sp.c) / sp.r
        nrm[m] = n
        alb[m] = np.power(np.array(sp.col, np.float32) / 255, 2.2)
        ao[m] = 1 - 0.3 * np.clip(-n[:, 1], 0, 1)

    # 光
    amb = AMBIENT + 0.08 * (nrm[:, 1] < -0.5)
    diff = np.zeros(N, np.float32)
    for lp, I in S.lights:
        L = np.array(lp, np.float32) - p
        dist = np.sqrt((L * L).sum(1))
        ndl = np.maximum((L * nrm).sum(1) / dist, 0)
        diff += I * ndl / (1 + (dist / LIGHT_R) ** 2)
    shade = (amb + diff) * ao
    col = alb * (shade * (1 - emi))[:, None] + alb * emi[:, None] * 1.05
    return col


def tone(c):
    c = c * EXPOSURE
    knee = 0.8
    over = np.maximum(c - knee, 0)
    c = np.where(c > knee, knee + (1 - knee) * (1 - np.exp(-over / (1 - knee))), c)
    return np.power(np.clip(c, 0, 1), 1 / 2.2)


def render(S, cam, Wr, pad, rows=96):
    Hr = Wr // 2
    out = np.empty((Hr, Wr + 2 * pad, 3), np.float32)
    cols = np.arange(-pad, Wr + pad)
    yaw = ((cols + 0.5) / Wr) * 2 * np.pi - np.pi
    sy, cy = np.sin(yaw), np.cos(yaw)
    dang = 2 * np.pi / Wr
    for r0 in range(0, Hr, rows):
        r1 = min(Hr, r0 + rows)
        pitch = np.pi / 2 - ((np.arange(r0, r1) + 0.5) / Hr) * np.pi
        sp, cp = np.sin(pitch)[:, None], np.cos(pitch)[:, None]
        d = np.stack([sy[None, :] * cp, np.broadcast_to(sp, (r1 - r0, len(cols))), -cy[None, :] * cp], -1)
        col = trace_shade(S, cam, d.reshape(-1, 3).astype(np.float32), dang)
        out[r0:r1] = tone(col).reshape(r1 - r0, len(cols), 3)
    return out


def downsample(img, Wr, pad, Wo, seed=0):
    """横に少しはみ出して描いた分（継ぎ目 ±180° をきれいにする）を残したまま縮め、最後に切る"""
    po = pad * Wo // Wr
    assert po * Wr == pad * Wo
    chans = []
    for c in range(3):
        f = Image.fromarray(np.ascontiguousarray(img[..., c]), "F")
        chans.append(np.asarray(f.resize((Wo + 2 * po, Wo // 2), Image.LANCZOS))[:, po:po + Wo])
    a = np.stack(chans, -1) * 255
    a += np.random.default_rng(seed).uniform(-0.5, 0.5, a.shape)   # 段差（バンディング）防止
    return Image.fromarray(np.clip(np.round(a), 0, 255).astype(np.uint8), "RGB")


def yaw_pitch(v):
    yaw = math.degrees(math.atan2(v[0], -v[2]))
    pitch = math.degrees(math.atan2(v[1], math.hypot(v[0], v[2])))
    return yaw, pitch


def report(S):
    for node, cam in S.nodes.items():
        cam = np.array(cam, float)
        print(f"[{S.facility}/{node}] cam={tuple(cam)}")
        for name, c, n in S.marks:
            fp = c + 1.5 * n
            fp[1] = 0.0
            y1, p1 = yaw_pitch(c - cam)
            y2, p2 = yaw_pitch(fp - cam)
            print(f"  {name:<12s} door yaw={y1:7.1f} pitch={p1:6.1f} | floor@1.5m ({fp[0]:.2f},{fp[2]:.2f}) "
                  f"yaw={y2:7.1f} pitch={p2:6.1f}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("facilities", nargs="*", default=list(SCENES))
    ap.add_argument("--quick", action="store_true", help="確認用: 1024×512 の _s だけ")
    ap.add_argument("--out", default=str(ROOT / "facilities"))
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--nodes", nargs="*", default=None)
    a = ap.parse_args()
    for fac in a.facilities:
        for make in SCENES[fac]:
            S = make()
            report(S)
            if a.report:
                continue
            S.build()
            outdir = Path(a.out) / fac / "panos"
            outdir.mkdir(parents=True, exist_ok=True)
            for node, cam in S.nodes.items():
                if a.nodes and node not in a.nodes:
                    continue
                t0 = time.time()
                if a.quick:
                    Wr, pad = 1536, 12
                    img = render(S, cam, Wr, pad)
                    downsample(img, Wr, pad, 1024).save(outdir / f"{node}_s.jpg", quality=85)
                else:
                    Wr, pad = 6144, 12
                    img = render(S, cam, Wr, pad)
                    downsample(img, Wr, pad, 4096).save(outdir / f"{node}.jpg", quality=82, optimize=True,
                                                        progressive=True)
                    downsample(img, Wr, pad, 1024).save(outdir / f"{node}_s.jpg", quality=70, optimize=True,
                                                        progressive=True)
                print(f"  rendered {fac}/{node} in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()

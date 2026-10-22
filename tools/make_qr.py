"""チラシ・掲示物用の QR コードと、そのまま貼れる案内画像を作る。

使い方:
    python tools/make_qr.py https://（公開先の URL）/ [出どころ=poster]

facilities/index.json に載っている施設ごとに、次の 3 つを作る。
  - facilities/<施設>/qr.svg      … QR だけ（印刷物に貼る。拡大してもにじまない）
  - facilities/<施設>/qr.png      … QR だけ（Word・Canva などに貼る）
  - facilities/<施設>/poster.png  … A5 縦の案内（写真・施設名・QR）。そのまま印刷できる
QR の行き先は https://公開先/<施設>/?src=poster。src を付けておくと、閲覧の計測で
「チラシから来た人」を分けて数えられる（出どころは 2 つ目の引数で変えられる。例：flyer、door）。
必要なもの：pip install segno pillow
"""
import json
import sys
from pathlib import Path

import segno
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONTS = ["C:/Windows/Fonts/BIZ-UDGothicB.ttc", "C:/Windows/Fonts/YuGothB.ttc", "C:/Windows/Fonts/meiryob.ttc",
         "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc", "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"]


def font(size):
    for f in FONTS:
        if Path(f).exists():
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def poster(fdir: Path, tour: dict, qr_png: Path, url: str) -> None:
    W, H = 1748, 2480  # A5 縦・300dpi
    accent = tour.get("accent", "#2f9e83")
    im = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(im)
    # 上：共有画像（なければ色の帯）
    share = fdir / "share.jpg"
    top = 980
    if share.exists():
        ph = Image.open(share).convert("RGB")
        r = max(W / ph.width, top / ph.height)
        ph = ph.resize((round(ph.width * r), round(ph.height * r)), Image.LANCZOS)
        x, y = (ph.width - W) // 2, (ph.height - top) // 2
        im.paste(ph.crop((x, y, x + W, y + top)), (0, 0))
    else:
        d.rectangle((0, 0, W, top), fill=accent)
    d.rectangle((0, top, W, top + 24), fill=accent)

    def center(text, y, size, fill="#2c3533"):
        f = font(size)
        w = d.textlength(text, font=f)
        d.text(((W - w) / 2, y), text, font=f, fill=fill)

    center("360°バーチャル見学", top + 90, 64, accent)
    center(tour.get("name", ""), top + 190, 104)
    center("スマホで読み取ると、中を歩いて見られます", top + 350, 54, "#56605d")
    q = Image.open(qr_png).convert("RGB").resize((640, 640), Image.NEAREST)
    im.paste(q, ((W - 640) // 2, top + 470))
    center(url.split("?")[0], top + 1150, 40, "#56605d")
    if tour.get("sample"):
        center("※ サンプル（架空の施設）です", top + 1230, 40, "#b85a22")
    im.save(fdir / "poster.png", dpi=(300, 300))


def make(fid: str, base_url: str, src: str) -> None:
    fdir = ROOT / "facilities" / fid
    tour = json.loads((fdir / "tour.json").read_text(encoding="utf-8"))
    url = f"{base_url}{fid}/?src={src}"
    qr = segno.make(url, error="m")
    qr.save(fdir / "qr.svg", scale=10, border=2, dark="#1d2523")
    qr.save(fdir / "qr.png", scale=16, border=2, dark="#1d2523")
    poster(fdir, tour, fdir / "qr.png", url)
    print("できました:", fid, url)


def main() -> None:
    if len(sys.argv) < 2 or not sys.argv[1].startswith("http"):
        print(__doc__)
        sys.exit(1)
    base_url = sys.argv[1].rstrip("/") + "/"
    src = sys.argv[2] if len(sys.argv) > 2 else "poster"
    for f in json.loads((ROOT / "facilities" / "index.json").read_text(encoding="utf-8")):
        make(f["id"], base_url, src)


if __name__ == "__main__":
    main()

"""360度写真をツアー用に整える。

使い方:
    python tools/prepare_photos.py 元の写真のフォルダ facilities/施設名/panos

元の写真（正距円筒図法・横:縦=2:1）を、
  - 名前.jpg   … 横 4096px（スマホで扱いやすい大きさ）
  - 名前_s.jpg … 横 1024px（最初にすぐ出す下見用）
の 2 つにして書き出す。Pillow が必要（pip install pillow）。
"""
import sys
from pathlib import Path
from PIL import Image

Image.MAX_IMAGE_PIXELS = None


def main(src: Path, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    files = [p for p in sorted(src.iterdir()) if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")]
    if not files:
        print("写真が見つかりません:", src)
        return
    for p in files:
        im = Image.open(p).convert("RGB")
        w, h = im.size
        if abs(w / h - 2) > 0.05:
            print(f"注意: {p.name} は横:縦が 2:1 ではありません（{w}x{h}）。360度写真か確かめてください。")
        big = im if w <= 4096 else im.resize((4096, round(h * 4096 / w)), Image.LANCZOS)
        big.save(out / f"{p.stem}.jpg", quality=82, optimize=True, progressive=True)
        im.resize((1024, round(h * 1024 / w)), Image.LANCZOS).save(out / f"{p.stem}_s.jpg", quality=70, optimize=True, progressive=True)
        print("できました:", p.stem)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    main(Path(sys.argv[1]), Path(sys.argv[2]))

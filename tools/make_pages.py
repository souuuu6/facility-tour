"""施設ごとの入口ページを作る（LINE などでリンクを送ったときに、施設名と画像が出るように）。

使い方:
    python tools/make_pages.py https://（公開先の URL）/

facilities/index.json に載っている施設ごとに、次の 2 つを作る。
  - <施設フォルダ名>/index.html       … 入口ページ。https://公開先/<施設フォルダ名>/ で開ける
  - facilities/<施設フォルダ名>/share.jpg … 共有用の画像（1200×630。最初の地点の正面を切り出す）
公開先の URL は、共有画像の場所を「https:// から始まる形」で書くために使う（LINE などはその形でないと画像を出さない）。
tour.json の中身（施設名・キャッチコピー・最初の地点）を変えたら、もう一度実行する。
"""
import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from crop_view import crop  # noqa: E402


def make(fid: str, base_url: str) -> None:
    if not re.fullmatch(r"[\w-]+", fid):
        raise SystemExit(f"施設のフォルダ名に使えない文字があります: {fid}")
    fdir = ROOT / "facilities" / fid
    tour = json.loads((fdir / "tour.json").read_text(encoding="utf-8"))
    nodes = tour.get("nodes", [])
    # 共有用の画像：tour.json の share（地点と向き）があればそこ、なければ最初の地点の正面
    sh = tour.get("share") or {}
    want = sh.get("node") or tour.get("start")
    spot = next((n for n in nodes if n.get("id") == want), nodes[0] if nodes else None)
    has_image = False
    if spot and (fdir / spot["image"]).exists():
        yaw = float(sh.get("yaw", spot.get("startYaw", 0)))
        crop(fdir / spot["image"], fdir / "share.jpg", yaw, float(sh.get("pitch", 0)), 80.0, (1200, 630))
        has_image = True

    name = tour.get("name") or fid
    title = f"{name}｜360°バーチャル見学"
    desc = tour.get("tagline") or f"{name}の中を、360度の写真で歩いて見られます。"
    if tour.get("sample"):
        title += "（サンプル）"
    page_url = f"{base_url}{fid}/"
    e = lambda s: html.escape(s, quote=True)  # noqa: E731

    meta = [
        '<base href="../">',
        f'<meta name="description" content="{e(desc)}">',
        '<meta property="og:type" content="website">',
        f'<meta property="og:title" content="{e(title)}">',
        f'<meta property="og:description" content="{e(desc)}">',
        f'<meta property="og:url" content="{e(page_url)}">',
        f'<meta property="og:site_name" content="{e(name)}">',
        '<meta property="og:locale" content="ja_JP">',
        '<meta name="twitter:card" content="summary_large_image">',
    ]
    if has_image:
        img = f"{base_url}facilities/{fid}/share.jpg"
        meta += [f'<meta property="og:image" content="{e(img)}">',
                 '<meta property="og:image:width" content="1200">',
                 '<meta property="og:image:height" content="630">',
                 f'<meta name="twitter:image" content="{e(img)}">']
    if tour.get("noindex"):
        meta.append('<meta name="robots" content="noindex">')

    src = (ROOT / "index.html").read_text(encoding="utf-8")
    # index.html の robots の指定は外し、tour.json の noindex に合わせて付け直す
    src = "".join(line for line in src.splitlines(keepends=True) if 'name="robots"' not in line)
    out = src.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n  ' + "\n  ".join(meta), 1)
    out = out.replace("<title>施設ツアー</title>", f"<title>{e(title)}</title>", 1)
    if tour.get("logo"):
        out = out.replace('<link rel="icon" href="data:', f'<link rel="icon" href="facilities/{e(fid)}/{e(tour["logo"])}">\n  <link rel="alternate icon" href="data:', 1)
    out = out.replace('<meta charset="utf-8">', f'<meta charset="utf-8">\n  <meta name="tour-facility" content="{e(fid)}">', 1)
    (ROOT / fid).mkdir(exist_ok=True)
    (ROOT / fid / "index.html").write_text(out, encoding="utf-8")
    print("できました:", f"{fid}/index.html", "（共有画像あり）" if has_image else "（共有画像なし）")


def main() -> None:
    if len(sys.argv) != 2 or not sys.argv[1].startswith("http"):
        print(__doc__)
        sys.exit(1)
    base_url = sys.argv[1].rstrip("/") + "/"
    for f in json.loads((ROOT / "facilities" / "index.json").read_text(encoding="utf-8")):
        make(f["id"], base_url)


if __name__ == "__main__":
    main()

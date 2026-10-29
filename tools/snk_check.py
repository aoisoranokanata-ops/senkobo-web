"""exe 版（../senkobo）と .snk を往復できるかの確認。

  python tools/snk_check.py prepare   exe の見本（data/サンプル/*.snk）＋画像入りの見本を tools/fixtures/exe_*.snk に置き、
                                      exe で描いた絵を exe_*.png に
  （ブラウザで tools/roundtrip.js を実行 → web_*.snk と web_*.png が PUT で届く）
  python tools/snk_check.py check     web_*.snk を exe で開き、元の exe_*.snk と中身（to_dict）が同じか、
                                      exe で描いた絵が元と同じか、Web の絵と大きく違わないかを調べる

文字は Web が端末のフォントで描くので、Web の絵との差は「大きく違わないか」だけを見る（字の形は合わない）。
"""

import io
import json
import math
import os
import shutil
import sys
from pathlib import Path

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
ROOT = Path(__file__).resolve().parents[1]
EXE = ROOT.parent / "senkobo"
FIX = ROOT / "tools" / "fixtures"
sys.path.insert(0, str(EXE / "src"))

from PIL import Image, ImageChops, ImageStat  # noqa: E402
from PySide6.QtCore import QBuffer, QIODevice  # noqa: E402
from PySide6.QtGui import QColor, QGuiApplication  # noqa: E402

from senkobo import paths  # noqa: E402
from senkobo.core import fileio, text  # noqa: E402
from senkobo.core.color import Color  # noqa: E402
from senkobo.core.geom import Matrix  # noqa: E402
from senkobo.core.model import Document, ImageItem, PathItem, Style  # noqa: E402
from senkobo.ui.render import render_image  # noqa: E402

NAMES = {"見本ロゴ": "logo", "見本_効果": "fx", "見本_文字": "text", "見本_対称と線幅": "sym"}


def to_png(doc: Document) -> Image.Image:
    a = doc.artboards[0]
    img = render_image(doc, (a.x, a.y, a.x + a.w, a.y + a.h), 400 / max(a.w, a.h), QColor(255, 255, 255))
    buf = QBuffer()
    buf.open(QIODevice.OpenModeFlag.WriteOnly)
    img.save(buf, "PNG")
    return Image.open(io.BytesIO(bytes(buf.data()))).convert("RGB")


def image_sample() -> Document:
    doc = Document(600, 400, "cmyk", "mm")
    im = Image.new("RGB", (120, 80))
    for y in range(80):
        for x in range(120):
            im.putpixel((x, y), (x * 2, y * 3, 160))
    b = io.BytesIO()
    im.save(b, "PNG")
    with doc.edit("見本"):
        key = doc.add_image_bytes(b.getvalue())
        it = ImageItem(key, 120, 80)
        it.matrix = Matrix(2, 0, 0, 2, 40, 30)
        doc.add_item(it)
        p = PathItem.from_shape({"kind": "polygon", "cx": 420, "cy": 200, "r": 120, "sides": 6, "corner": 10},
                                Style(Color("cmyk", (0, 0.6, 1, 0)), Color("cmyk", (0, 0, 0, 1)), 4))
        p.opacity = 0.8
        p.blend = "multiply"
        doc.add_item(p)
    return doc


def same(a, b, path="") -> list[str]:
    if isinstance(a, float) or isinstance(b, float):
        if isinstance(a, (int, float)) and isinstance(b, (int, float)) and math.isclose(a, b, abs_tol=2e-3):
            return []
    if type(a) is not type(b) and not (isinstance(a, (int, float)) and isinstance(b, (int, float))):
        return [f"{path}: {a!r} != {b!r}"]
    if isinstance(a, dict):
        out = []
        for k in sorted(set(a) | set(b)):
            if k not in a or k not in b:
                out.append(f"{path}.{k}: 片方にしか無い")
            else:
                out += same(a[k], b[k], f"{path}.{k}")
        return out
    if isinstance(a, list):
        if len(a) != len(b):
            return [f"{path}: 長さ {len(a)} != {len(b)}"]
        out = []
        for i, (x, y) in enumerate(zip(a, b)):
            out += same(x, y, f"{path}[{i}]")
        return out
    return [] if a == b else [f"{path}: {a!r} != {b!r}"]


def diff(a: Image.Image, b: Image.Image) -> float:
    if a.size != b.size:
        b = b.resize(a.size)
    return sum(ImageStat.Stat(ImageChops.difference(a, b)).mean) / 3


def main() -> int:
    text.CACHE_FILE = paths.fonts_cache()
    QGuiApplication.instance() or QGuiApplication(sys.argv)
    FIX.mkdir(exist_ok=True)
    cmd = sys.argv[1] if len(sys.argv) > 1 else "check"
    if cmd == "prepare":
        for src, short in NAMES.items():
            shutil.copyfile(EXE / "data" / "サンプル" / f"{src}.snk", FIX / f"exe_{short}.snk")
        fileio.save(image_sample(), FIX / "exe_image.snk")
        names = []
        for f in sorted(FIX.glob("exe_*.snk")):
            to_png(fileio.load(f)).save(f.with_suffix(".png"))
            names.append(f.stem[4:])
        (FIX / "list.json").write_text(json.dumps(names), encoding="utf-8")
        print("用意:", ", ".join(names))
        return 0
    bad = 0
    for f in sorted(FIX.glob("exe_*.snk")):
        short = f.stem[4:]
        w = FIX / f"web_{short}.snk"
        if not w.exists():
            print(f"[{short}] web_{short}.snk がありません（ブラウザで tools/roundtrip.js を）")
            bad += 1
            continue
        a, b = fileio.load(f), fileio.load(w)
        da, db = a.to_dict(), b.to_dict()
        da.pop("meta", None), db.pop("meta", None)
        d = same(da, db)
        img_a, img_b = to_png(a), to_png(b)
        r = diff(img_a, img_b)
        web_png = FIX / f"web_{short}.png"
        rw = diff(img_a, Image.open(web_png).convert("RGB")) if web_png.exists() else None
        ok = not d and r < 0.05 and sorted(a.images) == sorted(b.images)
        bad += not ok
        print(f"[{short}] {'OK' if ok else 'NG'}  中身の差 {len(d)} 件・exe で描いた差 {r:.3f}・画像 {len(b.images)} 枚"
              + (f"・Web の絵との差 {rw:.2f}（文字はフォント差あり）" if rw is not None else ""))
        for line in d[:12]:
            print("   ", line)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())

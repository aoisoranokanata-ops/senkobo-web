"""Web で作った .snk（tools/fixtures/webdoc_*.snk）を exe で開けるか・保存し直しても同じか・絵が近いかを見る。

  （ブラウザで作品を開き、画面のコンソールで）
    const d=app.doc, a=d.artboards[0];
    await fetch('tools/fixtures/webdoc_名前.snk', {method:'PUT', body: await docToSnk(d)});
    await fetch('tools/fixtures/webdoc_名前.png', {method:'PUT', body: await canvasToBlob(renderToCanvas(d,[a.x,a.y,a.x+a.w,a.y+a.h],400/Math.max(a.w,a.h),'#ffffff'))});
  python tools/webdoc_check.py   → webdoc_名前_exe.png（exe で描いた絵）と cmpw_名前.png（左 exe・右 Web）
"""

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import snk_check as S  # noqa: E402
from PIL import Image  # noqa: E402


def main() -> int:
    S.text.CACHE_FILE = S.paths.fonts_cache()
    S.QGuiApplication.instance() or S.QGuiApplication(sys.argv)
    bad = 0
    for f in sorted(S.FIX.glob("webdoc_*.snk")):
        name = f.stem[7:]
        doc = S.fileio.load(f)
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "again.snk"
            S.fileio.save(doc, p)
            again = S.fileio.load(p)
        da, db = doc.to_dict(), again.to_dict()
        d = S.same(da, db)
        img = S.to_png(doc)
        img.save(S.FIX / f"webdoc_{name}_exe.png")
        web = S.FIX / f"webdoc_{name}.png"
        msg = ""
        if web.exists():
            w = Image.open(web).convert("RGB").resize(img.size)
            c = Image.new("RGB", (img.width * 2 + 10, img.height), "gray")
            c.paste(img, (0, 0))
            c.paste(w, (img.width + 10, 0))
            c.save(S.FIX / f"cmpw_{name}.png")
            msg = f"・Web の絵との差 {S.diff(img, w):.2f}"
        print(f"[{name}] {'OK' if not d else 'NG'}  exe で開けた・保存し直しの差 {len(d)} 件{msg}")
        for line in d[:10]:
            print("   ", line)
        bad += bool(d)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())

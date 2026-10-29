"""Web の PDF（tools/fixtures/web_*.pdf）を確かめる: 壊れていないか・箱（Trim/Bleed）・色空間・exe の PDF と描き比べ。

  （画面で）for (const n of ['fx','text','logo','image','sym']) { const d = await snkToDoc(await (await fetch(`tools/fixtures/exe_${n}.snk`)).blob());
            await fetch(`tools/fixtures/web_${n}.pdf`, {method:'PUT', body: await exportPdf(d, {marks:true, pageInfo:true, opBlack:true, imagesCmyk:true, bleed:3*72/25.4})}); }
  python tools/pdf_check.py   → pdfcmp_*.png（左 exe・右 Web）
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import snk_check as S  # noqa: E402
import fitz  # noqa: E402
from PIL import Image, ImageChops, ImageStat  # noqa: E402
from senkobo.core import fileio, pdf  # noqa: E402
from senkobo.ui.render import effect_layer_png  # noqa: E402

MM = 72 / 25.4


def page_png(data: bytes, w: int = 500) -> Image.Image:
    d = fitz.open(stream=data, filetype="pdf")
    p = d[0]
    pix = p.get_pixmap(matrix=fitz.Matrix(w / p.rect.width, w / p.rect.width), alpha=False)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


def main() -> int:
    S.text.CACHE_FILE = S.paths.fonts_cache()
    S.QGuiApplication.instance() or S.QGuiApplication(sys.argv)
    bad = 0
    for f in sorted(S.FIX.glob("web_*.pdf")):
        name = f.stem[4:]
        data = f.read_bytes()
        fitz.TOOLS.mupdf_warnings()           # 前のを捨てる
        d = fitz.open(stream=data, filetype="pdf")
        warn = fitz.TOOLS.mupdf_warnings()
        p = d[0]
        raw = data.decode("latin-1")
        cmyk = "/DeviceCMYK" in raw
        sep = "/Separation /All" in raw
        doc = fileio.load(S.FIX / f"exe_{name}.snk")
        exe_pdf = pdf.export_pdf(doc, None, marks=True, page_info=True, bleed=3 * MM, overprint_black=True,
                                 rasterizer=effect_layer_png)
        a, b = page_png(exe_pdf), page_png(data)
        b = b.resize(a.size)
        diff = sum(ImageStat.Stat(ImageChops.difference(a, b)).mean) / 3
        c = Image.new("RGB", (a.width * 2 + 10, a.height), "gray")
        c.paste(a, (0, 0))
        c.paste(b, (a.width + 10, 0))
        c.save(S.FIX / f"pdfcmp_{name}.png")
        e = fitz.open(stream=exe_pdf, filetype="pdf")[0]
        same_box = all(abs(getattr(p, k).width - getattr(e, k).width) < 0.5 and abs(getattr(p, k).height - getattr(e, k).height) < 0.5
                       for k in ("mediabox", "trimbox", "bleedbox"))
        ok = not warn and same_box and sep and diff < 6
        bad += not ok
        print(f"[{name}] {'OK' if ok else 'NG'}  {len(d)} ページ・{len(data) // 1024}KB・箱 {'exe と同じ' if same_box else '違う'}・"
              f"{'CMYK' if cmyk else 'RGB'}・レジストレーション {'あり' if sep else 'なし'}・絵の差 {diff:.2f}" + (f"・警告 {warn}" if warn else ""))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())

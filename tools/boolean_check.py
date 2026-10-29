"""形の計算の突き合わせ（exe 側）。tools/boolcases.js が置いた bool_web.json の入力を exe の ops で計算して比べる。

  python tools/boolean_check.py

面積が 0.6% か 0.5pt² まで同じなら OK。輪・領域の数は参考（1 点で接する所を、pathops は 8 の字の 1 つの輪に、Web は 2 つに分ける）。
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import snk_check as S  # noqa: E402
import pathops  # noqa: E402
from senkobo.core import ops  # noqa: E402
from senkobo.core.model import Document, PathItem, item_from_dict  # noqa: E402
from senkobo.core.geom import Subpath  # noqa: E402


def area_of(sps, evenodd=True) -> float:
    """塗りの規則どおりに塗った面積（細かい画素に塗って数える。重なった輪も正しく数える）"""
    import numpy as np
    from PySide6.QtCore import Qt
    from PySide6.QtGui import QColor, QImage, QPainter
    from senkobo.core.geom import subpaths_bbox, to_commands
    from senkobo.ui.render import cmds_qpath, qimage_array
    b = subpaths_bbox(sps)
    if not b:
        return 0.0
    w, h = b[2] - b[0], b[3] - b[1]
    sc = 2400 / max(w, h, 1e-6)
    img = QImage(int(w * sc) + 4, int(h * sc) + 4, QImage.Format.Format_ARGB32_Premultiplied)
    img.fill(0)
    p = QPainter(img)
    p.setRenderHint(QPainter.RenderHint.Antialiasing, True)
    p.translate(2, 2)
    p.scale(sc, sc)
    p.translate(-b[0], -b[1])
    p.fillPath(cmds_qpath(to_commands(sps), evenodd), QColor(0, 0, 0))
    p.end()
    return float(qimage_array(img)[..., 3].sum()) / (sc * sc)


def main() -> int:
    S.QGuiApplication.instance() or S.QGuiApplication(sys.argv)
    data = json.loads((S.FIX / "bool_web.json").read_text(encoding="utf-8"))
    bad = 0

    def cmp(label, a_exe, a_web, n_exe=None, n_web=None):
        nonlocal bad
        ok = abs(a_exe - a_web) <= max(0.5, a_exe * 0.006)
        bad += not ok
        extra = (f"  数 exe {n_exe} / web {n_web}" + ("" if n_exe == n_web else " （数が違う）")) if n_exe is not None else ""
        print(f"  {'OK' if ok else 'NG'} {label:16s} 面積 exe {a_exe:10.1f} / web {a_web:10.1f}{extra}")

    for name, dicts in data["cases"].items():
        print(f"[{name}]")
        web = data["ops"][name]
        for how in ("unite", "minus_front", "intersect", "exclude", "minus_back", "divide"):
            doc = Document(1000, 1000, "rgb", "px")
            with doc.edit("t"):
                items = [item_from_dict(d) for d in dicts]
                for it in items:
                    doc.add_item(it)
                try:
                    res = ops.pathfinder(doc, items, how)
                except Exception as e:      # 何も残らないとき
                    res = []
                    print("    exe:", e)
            if how == "divide":
                a = sum(area_of(p.subpaths) for p in res)
                cmp(how, a, web[how]["area"], len(res), web[how]["regions"])
            else:
                sps = [s for p in res for s in p.subpaths]
                # 中マド: pathops の XOR の輪は偶奇で見る形（exe の fill_rule の印は nonzero のことがある）
                a = sum(area_of(p.subpaths, p.fill_rule == "evenodd" or how == "exclude") for p in res)
                cmp(how, a, web[how]["area"], len(sps), web[how]["loops"])
        for key, d, j in (("off_p10_round", 10, "round"), ("off_m10_miter", -10, "miter")):
            doc = Document(1000, 1000, "rgb", "px")
            with doc.edit("t"):
                it = item_from_dict(dicts[0])
                doc.add_item(it)
                try:
                    res = ops.offset_path(doc, [it], d, j, 4)
                except Exception:
                    res = []
            sps = [s for p in res for s in p.subpaths]
            cmp(key, sum(area_of(p.subpaths, p.fill_rule == "evenodd") for p in res), web[key]["area"], len(sps), web[key]["loops"])
        it = item_from_dict(dicts[0])
        q = ops._stroked(ops._raw_pathops(it.subpaths), 8, "round", "round", 10)
        qs = ops._from_pathops(q)
        cmp("stroke8", area_of(qs, False), web["stroke8"]["area"], len(qs), web["stroke8"]["loops"])
    print("[開いた線]")
    line = [Subpath.from_dict(x) for x in data["lines"]["line"]]
    for key, w, cap, join, dash in (("round", 24, "round", "round", None), ("butt_miter", 24, "butt", "miter", None), ("dash", 6, "butt", "miter", [20, 10])):
        q = ops._stroked(ops._raw_pathops(line), w, cap, join, 10, dash)
        cmp(key, area_of(ops._from_pathops(q), False), data["lines"][key])
    print(f"Web の計算 {data['ms']:.0f} ms")
    print("すべて OK" if not bad else f"NG {bad} 件")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())

"""PWA のアイコン（icons/*.png）を exe 版の make_icon.py と同じ絵で作る。  python tools/make_icons.py"""

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT.parent / "senkobo" / "tools"))
from make_icon import make  # noqa: E402

for name, size, opaque in (("icon-192", 192, False), ("icon-512", 512, False), ("apple-touch-icon", 180, True)):
    im = make(size)
    if opaque:      # iOS のホーム画面は透明を黒にするので下地を敷く
        bg = Image.new("RGBA", im.size, (29, 42, 92, 255))
        bg.alpha_composite(im)
        im = bg.convert("RGB")
    im.save(ROOT / "icons" / f"{name}.png")
print("ok")

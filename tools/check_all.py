"""exe との突き合わせを全部まとめて（PC 側）。

  python tools/snk_check.py prepare          （exe の見本を fixtures に。最初の 1 回）
  （画面で）eval(await (await fetch('tools/selftest.js')).text())
  python tools/check_all.py

.snk の往復（snk_check）・形の計算（boolean_check）・PDF（pdf_check）・Web で作った作品を exe で（webdoc_check）。
"""

import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
env = dict(os.environ, PYTHONIOENCODING="utf-8")
results = []
for name, args in (("snk の往復", ["snk_check.py", "check"]), ("形の計算", ["boolean_check.py"]), ("PDF", ["pdf_check.py"]),
                   ("Web で作った作品", ["webdoc_check.py"])):
    p = subprocess.run([sys.executable, str(HERE / args[0]), *args[1:]], capture_output=True, text=True, encoding="utf-8", env=env)
    out = (p.stdout + p.stderr).strip().splitlines()
    ng = [l for l in out if " NG" in l or "Traceback" in l or l.startswith("Error")]
    results.append((name, p.returncode == 0))
    print(f"== {name}: {'OK' if p.returncode == 0 else 'NG'}")
    for line in (ng or out[-3:]):
        print("   ", line)
print()
print("すべて OK" if all(ok for _, ok in results) else "NG があります: " + "・".join(n for n, ok in results if not ok))
sys.exit(0 if all(ok for _, ok in results) else 1)

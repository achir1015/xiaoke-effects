# -*- coding: utf-8 -*-
"""下載原版 EffectCraft 的瀏覽器版（WebAssembly）放到 engine/。
檔案約 60 MB，不放進 git；GitHub Pages 部署時由 CI 執行這支程式。
用法：python tools/fetch_engine.py [版本，預設最新]
"""
import io
import json
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / "engine"
API = "https://api.github.com/repos/storytold/effectcraft/releases"


def main():
    ver = sys.argv[1] if len(sys.argv) > 1 else None
    url = f"{API}/tags/v{ver}" if ver else f"{API}/latest"
    rel = json.load(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "xiaoke-effects"})))
    asset = next(a for a in rel["assets"] if a["name"].startswith("effectcraft-web-") and a["name"].endswith(".zip"))
    print("下載", asset["name"], round(asset["size"] / 1e6, 1), "MB")
    data = urllib.request.urlopen(asset["browser_download_url"]).read()
    if DEST.exists():
        shutil.rmtree(DEST)
    DEST.mkdir()
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for info in z.infolist():
            parts = Path(info.filename).parts[1:]   # 去掉最外層資料夾
            if not parts or info.is_dir():
                continue
            out = DEST.joinpath(*parts)
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(z.read(info))
    (DEST / "VERSION").write_text(rel["tag_name"], encoding="utf-8")
    print("完成：engine/", rel["tag_name"])


if __name__ == "__main__":
    main()

# -*- coding: utf-8 -*-
"""
小柯機器人動態圖形和視覺特效工具 — 桌面版（Windows 11／macOS 共用這支程式）

架構：
  AppInfo        名稱、版本、資料夾位置
  LocalServer    本機 http 伺服器：提供網頁檔案（web/，和線上版同一份）
  SaveSession    另存新檔（網頁把檔案分段傳過來，Python 寫進使用者選的位置）
  DesktopBridge  網頁可以呼叫的 Python 功能（window.pywebview.api.xxx）
  Updater        版本更新：查 GitHub Releases 最新版 → 下載 → 安裝 → 自動重開
  SelfTest       安裝後自動測試（CI 用）：開範本、套特效、算繪 MP4／GIF／PNG／Lottie 並存檔
  main()         開啟視窗

畫面：Windows 用內建的 Edge WebView2；Mac 用 Qt WebEngine（同樣是 Chromium 核心）。
Mac 的 Qt WebEngine 沒有 H.264 編碼器：網頁匯出的 MP4 會是 VP9，存檔時用 ffmpeg 轉成 H.264／AAC，QuickTime 才能播。
"""
import base64
import http.server
import json
import mimetypes
import os
import platform
import re
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

APP_NAME = "小柯機器人動態圖形和視覺特效工具"
APP_ID = "XiaokeEffects"
GITHUB_REPO = "achir1015/xiaoke-effects"
ONLINE_URL = "https://achir1015.github.io/xiaoke-effects/"
HTTP_PORT = int(os.environ.get("XKE_PORT") or 48131)  # 固定埠號：瀏覽器裡的自動儲存（IndexedDB）綁在這個網址上，每次開啟都還在

IS_WIN = sys.platform == "win32"
IS_MAC = sys.platform == "darwin"
MAC_ARCH = "AppleSilicon" if IS_MAC and platform.machine() == "arm64" else "Intel"

BASE = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))


def safe_print(text: str):
    """視窗程式的主控台可能不支援中文：印不出來就改用跳脫字元，絕不讓程式因此出錯。"""
    out = sys.stdout
    if out is None:
        return
    try:
        print(text, file=out, flush=True)
    except Exception:
        try:
            print(text.encode("ascii", "backslashreplace").decode("ascii"), file=out, flush=True)
        except Exception:
            pass


def _bundled_version() -> str:
    try:
        return json.loads((BASE / "web" / "version.json").read_text(encoding="utf-8"))["version"]
    except Exception:
        return "0.0.0"


APP_VERSION = _bundled_version()


class AppInfo:
    @staticmethod
    def web_dir() -> Path:
        return BASE / "web"

    @staticmethod
    def data_dir() -> Path:
        # 自我測試會設定 XKE_DATA_DIR，才不會動到使用者自己的自動儲存與設定
        if os.environ.get("XKE_DATA_DIR"):
            d = Path(os.environ["XKE_DATA_DIR"])
        elif IS_MAC:
            d = Path.home() / "Library" / "Application Support" / APP_ID
        elif IS_WIN:
            d = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local")) / APP_ID
        else:
            d = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) / APP_ID
        d.mkdir(parents=True, exist_ok=True)
        return d

    @staticmethod
    def shared_dir() -> Path:
        """小柯共用動畫素材：小柯特效匯出、小柯影音剪輯助手讀取（兩個 App 都用這個資料夾）"""
        d = Path(os.environ["XKE_SHARED_DIR"]) if os.environ.get("XKE_SHARED_DIR") else Path.home() / ("Movies" if IS_MAC else "Videos") / "小柯動畫素材"
        d.mkdir(parents=True, exist_ok=True)
        return d

    @staticmethod
    def default_save_dir() -> Path:
        d = Path.home() / ("Movies" if IS_MAC else "Videos") / APP_NAME
        try:
            d.mkdir(parents=True, exist_ok=True)
        except OSError:
            d = Path.home()
        return d


# ---------------------------------------------------------------- 本機伺服器
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("application/wasm", ".wasm")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(AppInfo.web_dir()), **kw)

    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        # 單一執行個體：第二次開啟 App 時，用這兩個網址確認並叫出已經開著的視窗
        if self.path == "/__xke_ping":
            return self._reply(APP_ID)
        if self.path == "/__xke_show":
            cb = LocalServer.on_show
            if cb:
                threading.Thread(target=cb, daemon=True).start()
            return self._reply("ok")
        if self.path.startswith("/__xke_open?"):
            # 已經開著時又雙擊了專案檔：交給目前的視窗開啟
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            f = (q.get("p") or [""])[0]
            if f and LocalServer.on_open:
                threading.Thread(target=LocalServer.on_open, args=(f,), daemon=True).start()
            return self._reply("ok")
        if self.path.startswith("/__xke_file/"):
            f = LocalServer.files.get(self.path.rsplit("/", 1)[-1])
            if not f or not Path(f).is_file():
                self.send_error(404)
                return
            data = Path(f).read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        return super().do_GET()

    def _reply(self, text):
        b = text.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)


class ExclusiveServer(http.server.ThreadingHTTPServer):
    # Python 預設 allow_reuse_address=True：在 Windows 上會讓第二個程式綁到同一個埠，請求被舊程式接走
    allow_reuse_address = False

    def server_bind(self):
        import socket
        if IS_WIN and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


class LocalServer:
    on_show = None   # 另一個執行個體要求顯示視窗時呼叫
    on_open = None   # 另一個執行個體要求開啟專案檔時呼叫
    files = {}       # 代號 → 要給網頁讀的本機檔案（雙擊開啟的專案檔）

    @staticmethod
    def existing_instance(open_path: str = "") -> bool:
        """固定埠號上已經有小柯特效在跑？有的話請它把視窗叫出來（並開啟專案檔）。"""
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{HTTP_PORT}/__xke_ping", timeout=1.5) as r:
                if r.read().decode("utf-8", "replace").strip() != APP_ID:
                    return False
            urllib.request.urlopen(f"http://127.0.0.1:{HTTP_PORT}/__xke_show", timeout=1.5).read()
            if open_path:
                urllib.request.urlopen(f"http://127.0.0.1:{HTTP_PORT}/__xke_open?p=" + urllib.parse.quote(open_path), timeout=1.5).read()
            return True
        except Exception:
            return False

    def __init__(self):
        self.port = HTTP_PORT
        for port in (HTTP_PORT, HTTP_PORT + 1, HTTP_PORT + 2, 0):
            try:
                self.httpd = ExclusiveServer(("127.0.0.1", port), Handler)
                self.port = self.httpd.server_address[1]
                break
            except OSError:
                continue
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    @property
    def url(self):
        return f"http://127.0.0.1:{self.port}/"


# ---------------------------------------------------------------- 存檔
class SaveSession:
    def __init__(self, path: Path, sidecar: str = ""):
        self.path = path
        self.sidecar = sidecar   # 共用動畫：存完再寫旁邊的 .json 說明檔
        self.tmp = path.with_name(path.name + ".part")
        self.fh = open(self.tmp, "wb")
        self.size = 0

    def write(self, b64: str) -> int:
        data = base64.b64decode(b64)
        self.fh.write(data)
        self.size += len(data)
        return self.size

    def finish(self) -> Path:
        self.fh.close()
        if self.path.exists():
            self.path.unlink()
        self.tmp.rename(self.path)
        if self.sidecar:
            Path(str(self.path) + ".json").write_text(self.sidecar, encoding="utf-8")
        return self.path


def ensure_standard_mp4(path: Path):
    """MP4 裡的影片不是 H.264（Mac 的 Qt WebEngine 只能編 VP9）就用 ffmpeg 轉成 H.264＋AAC。"""
    if path.suffix.lower() != ".mp4":
        return
    try:
        import imageio_ffmpeg
        ff = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return
    flags = 0x08000000 if IS_WIN else 0   # CREATE_NO_WINDOW
    probe = subprocess.run([ff, "-hide_banner", "-i", str(path)], capture_output=True, text=True, errors="replace", creationflags=flags)
    if re.search(r"Video: h264", probe.stderr):
        return
    tmp = path.with_name(path.stem + ".h264.mp4")
    r = subprocess.run([ff, "-y", "-hide_banner", "-loglevel", "error", "-i", str(path), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
                        "-preset", "medium", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(tmp)], creationflags=flags)
    if r.returncode == 0 and tmp.exists() and tmp.stat().st_size > 0:
        path.unlink()
        tmp.rename(path)
    elif tmp.exists():
        tmp.unlink()


class DesktopBridge:
    """網頁端透過 window.pywebview.api 呼叫。"""

    def __init__(self, server: LocalServer):
        self._window = None
        self._server = server
        self._sessions = {}
        self._aep = {"busy": False, "done": 0, "total": 0, "stage": ""}
        self._updater = Updater()
        self.forced_save_dir = None

    def attach(self, window):
        self._window = window
        self._updater.window = window

    # ---- 基本 ----
    def app_info(self):
        return {"name": APP_NAME, "version": APP_VERSION, "platform": sys.platform, "arch": MAC_ARCH if IS_MAC else platform.machine(),
                "saveDir": str(AppInfo.default_save_dir()), "online": ONLINE_URL}

    def open_folder(self, path: str = ""):
        target = Path(path) if path else AppInfo.default_save_dir()
        if target.is_file():
            target = target.parent
        if IS_WIN:
            os.startfile(str(target))  # noqa: S606
        else:
            subprocess.Popen(["open", str(target)])
        return True

    def open_url(self, url: str):
        # 只開自己的網站與 GitHub（例如原版 EffectCraft 引擎、下載頁）
        url = str(url)
        if not (url.startswith(ONLINE_URL) or url.startswith("https://github.com/")):
            return False
        import webbrowser
        webbrowser.open(url)
        return True

    # ---- 更新 ----
    def check_update(self):
        return self._updater.check()

    def install_update(self, url: str, version: str):
        return self._updater.install(str(url), str(version))

    def update_status(self):
        return self._updater.status

    # ---- 存檔 ----
    def begin_save(self, filename: str):
        try:
            filename = "".join(c for c in str(filename) if c not in '\\/:*?"<>|').strip() or "xiaoke.mp4"
            if self.forced_save_dir is not None:
                path = Path(self.forced_save_dir) / filename
            else:
                import webview
                ext = Path(filename).suffix.lstrip(".") or "*"
                # 檔案類型名稱只能用英數字與空白（其他字元會讓 pywebview 的對話框直接失敗）
                result = self._window.create_file_dialog(
                    webview.SAVE_DIALOG, directory=str(AppInfo.default_save_dir()), save_filename=filename,
                    file_types=(f"{ext.upper()} (*.{ext})", "All files (*.*)"))
                if not result:
                    return {"status": "declined"}
                path = Path(result if isinstance(result, str) else result[0])
            token = uuid.uuid4().hex
            self._sessions[token] = SaveSession(path)
            return {"status": "ok", "token": token, "path": str(path)}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    # ---- 匯入 After Effects 專案（轉成 .xke，網頁端再存成「我的模組」）----
    def aep_status(self):
        return dict(self._aep)

    def import_aep(self, path: str = "", folder: str = ""):
        """path 空白＝跳出選檔；folder＝'ask' 時跳出選資料夾（素材找不到時用）"""
        try:
            import webview
            path = str(path or "")
            if not path:
                result = self._window.create_file_dialog(webview.OPEN_DIALOG, allow_multiple=False,
                                                         file_types=("After Effects project (*.aep)", "All files (*.*)"))
                if not result:
                    return {"status": "declined"}
                path = result if isinstance(result, str) else result[0]
            photos = None
            if folder == "ask":
                r = self._window.create_file_dialog(webview.FOLDER_DIALOG, directory=str(Path(path).parent))
                if not r:
                    return {"status": "declined"}
                photos = r if isinstance(r, str) else r[0]
            elif folder:
                photos = str(folder)
            if not Path(path).is_file():
                return {"status": "error", "message": "file not found: " + path}
            import aep2xke
            out_dir = AppInfo.data_dir() / "aep"
            out_dir.mkdir(parents=True, exist_ok=True)
            for old in out_dir.glob("*.xke"):     # 上一次的轉換結果網頁端已經讀走了
                try:
                    old.unlink()
                except OSError:
                    pass
            out = out_dir / (uuid.uuid4().hex + ".xke")
            self._aep = {"busy": True, "done": 0, "total": 0, "stage": "parse"}

            def prog(done, total):
                self._aep = {"busy": True, "done": done, "total": total, "stage": "convert"}
            fx_js = AppInfo.web_dir() / "js" / "fx.js"
            report = aep2xke.convert(path, str(out), photos, 1600, str(fx_js) if fx_js.is_file() else None, prog)
            token = uuid.uuid4().hex
            LocalServer.files[token] = str(out)
            return {"status": "ok", "url": f"/__xke_file/{token}", "path": path, "report": report}
        except Exception as e:
            traceback.print_exc()
            return {"status": "error", "message": f"{type(e).__name__}: {e}"}
        finally:
            self._aep = {"busy": False, "done": 0, "total": 0, "stage": ""}

    # ---- 共用動畫素材（給小柯影音剪輯助手）----
    def shared_begin(self, filename: str, meta_json: str):
        try:
            d = AppInfo.shared_dir()
            base = "".join(c for c in str(filename) if c not in '\\/:*?"<>|').strip() or "animation.webm"
            stem, ext = os.path.splitext(base)
            path, n = d / base, 2
            while path.exists():
                path, n = d / f"{stem} ({n}){ext}", n + 1
            meta = json.loads(meta_json or "{}")
            meta["file"] = path.name
            token = uuid.uuid4().hex
            self._sessions[token] = SaveSession(path, json.dumps(meta, ensure_ascii=False))
            return {"status": "ok", "token": token, "path": str(path)}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def shared_list(self):
        items = []
        try:
            d = AppInfo.shared_dir()
            for p in sorted(d.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
                if p.suffix.lower() not in (".webm", ".mp4") or not p.is_file():
                    continue
                meta = {}
                side = Path(str(p) + ".json")
                if side.is_file():
                    try:
                        meta = json.loads(side.read_text(encoding="utf-8"))
                    except Exception:
                        meta = {}
                meta.update({"file": p.name, "path": str(p), "size": p.stat().st_size})
                meta.setdefault("name", p.stem)
                items.append(meta)
            return {"status": "ok", "dir": str(d), "items": items}
        except Exception as e:
            return {"status": "error", "message": str(e), "items": items}

    def shared_delete(self, filename: str):
        try:
            d = AppInfo.shared_dir()
            p = (d / Path(str(filename)).name)
            for f in (p, Path(str(p) + ".json")):
                if f.is_file():
                    f.unlink()
            return {"status": "ok"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def open_shared_dir(self):
        return self.open_folder(str(AppInfo.shared_dir()))

    def write_chunk(self, token: str, b64: str):
        s = self._sessions.get(token)
        if not s:
            return {"status": "error", "message": "no session"}
        return {"status": "ok", "size": s.write(b64)}

    def end_save(self, token: str):
        s = self._sessions.pop(token, None)
        if not s:
            return {"status": "error", "message": "no session"}
        p = s.finish()
        try:
            ensure_standard_mp4(p)
        except Exception:
            pass
        return {"status": "ok", "path": str(p), "size": p.stat().st_size}


# ---------------------------------------------------------------- 版本更新
class Updater:
    """問 GitHub 最新版本 → 下載對應平台的安裝檔 → 安裝 → 重開。
    Windows：Inno Setup 安裝檔靜默安裝後自動重開。
    Mac：下載 .dmg 並打開，拖進「應用程式」覆蓋（未簽章 App 無法自動替換）。"""

    API = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
    DOWNLOAD_PREFIX = f"https://github.com/{GITHUB_REPO}/releases/download/"

    def __init__(self):
        self.window = None
        self.status = {"state": "idle", "pct": 0}

    @staticmethod
    def wanted(name: str) -> bool:
        n = name.lower()
        if IS_WIN:
            return n.endswith(".exe")
        if IS_MAC:
            return n.endswith(".dmg") and MAC_ARCH.lower() in n
        return False

    def check(self):
        try:
            req = urllib.request.Request(self.API, headers={"Accept": "application/vnd.github+json", "User-Agent": f"{APP_ID}/{APP_VERSION}"})
            with urllib.request.urlopen(req, timeout=15) as r:
                rel = json.load(r)
            asset = next((a for a in rel.get("assets", []) if self.wanted(a.get("name", ""))), None)
            notes = (rel.get("body") or "").split("## 下載安裝")[0].strip()
            return {"status": "ok", "current": APP_VERSION, "latest": str(rel.get("tag_name", "")).lstrip("vV"), "notes": notes,
                    "date": (rel.get("published_at") or "")[:10], "url": asset["browser_download_url"] if asset else "", "page": rel.get("html_url", "")}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def install(self, url: str, version: str):
        if not url.startswith(self.DOWNLOAD_PREFIX):
            return {"status": "error", "message": "bad url"}
        if self.status["state"] in ("downloading", "launching"):
            return {"status": "ok"}
        self.status = {"state": "downloading", "pct": 0}
        threading.Thread(target=self._run, args=(url, version), daemon=True).start()
        return {"status": "ok"}

    def _run(self, url, version):
        try:
            name = "".join(ch for ch in url.rsplit("/", 1)[-1] if ch not in '\\/:*?"<>|') or f"{APP_ID}-{version}"
            dest = Path(tempfile.gettempdir()) / name
            req = urllib.request.Request(url, headers={"User-Agent": f"{APP_ID}/{APP_VERSION}"})
            with urllib.request.urlopen(req, timeout=60) as r, open(dest, "wb") as fh:
                total, done = int(r.headers.get("Content-Length") or 0), 0
                while chunk := r.read(256 * 1024):
                    fh.write(chunk)
                    done += len(chunk)
                    if total:
                        self.status = {"state": "downloading", "pct": int(done * 100 / total)}
            if dest.stat().st_size < 1_000_000:
                raise RuntimeError("下載的安裝檔不完整")
            if IS_MAC:
                subprocess.Popen(["open", str(dest)])
                self.status = {"state": "manual", "pct": 100}
                return
            self.status = {"state": "launching", "pct": 100}
            subprocess.Popen([str(dest), "/SILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CURRENTUSER", "/relaunch=1"],
                             creationflags=0x00000008 | 0x00000200, close_fds=True)
            self._quit()
        except Exception as e:
            self.status = {"state": "error", "pct": 0, "message": str(e)}

    def _quit(self):
        time.sleep(1.5)
        try:
            self.window.destroy()
        finally:
            time.sleep(.5)
            os._exit(0)


# ---------------------------------------------------------------- 自我測試
class SelfTest:
    """XiaokeEffects --selftest 報告.json：CI 安裝後執行，確認整個 App 能用。"""

    JS_TEST = r"""
    (async function () {
      const r = { steps: [] };
      const step = async (name, fn) => { window.__xkeProgress = '進行中：' + name; try { const v = await fn(); r.steps.push({ name, ok: true, info: String(v ?? '') }); } catch (e) { r.steps.push({ name, ok: false, info: String(e && (e.stack || e.message) || e).slice(0, 400) }); } window.__xkeProgress = r.steps.map(s => (s.ok ? '✔' : '✘') + s.name).join(' / '); };
      const O = location.origin;
      const st = await import(O + '/js/state.js');
      const fx = await import(O + '/js/fx.js');
      const { desktopSave } = await import(O + '/js/desktop.js');
      const E = await import(O + '/js/exporter.js');
      const comp = () => st.S.project.comps.find(c => c.id === st.S.compId);
      await step('WebGL2 特效處理器', async () => { if (!fx.fxAvailable()) throw new Error('WebGL2 不能用'); return fx.EFFECTS.length + ' 種特效'; });
      await step('範本「片頭標題」', async () => { const c = comp(); if (!c || c.layers.length < 5) throw new Error('範本沒有載入'); return c.name + ' ' + c.layers.length + ' 個圖層'; });
      await step('新增圖層、套用特效與動畫預設', async () => {
        await xiaokeFX.execute('layer.newText', { text: '自我測試 Self Test' });
        xiaokeFX.execute('effect.apply', 'glow'); xiaokeFX.execute('effect.apply', 'dropShadow');
        await xiaokeFX.execute('anim.preset', 'popIn');
        await xiaokeFX.execute('layer.newSolid', { name: 'Noise', w: 1920, h: 1080, color: [0, 0, 0, 1] });
        xiaokeFX.execute('effect.apply', 'fractalNoise'); xiaokeFX.execute('layer.toggle3D');
        await xiaokeFX.execute('layer.newCamera');
        return comp().layers.length + ' 個圖層';
      });
      await step('復原／重做', async () => { const n = comp().layers.length; xiaokeFX.execute('edit.undo'); const a = comp().layers.length; xiaokeFX.execute('edit.redo'); if (a !== n - 1 || comp().layers.length !== n) throw new Error(n + '/' + a); return 'ok'; });
      const c = comp(); c.workIn = 0; c.workOut = 2;
      const save = async (fmt, res) => { const t0 = performance.now(); const x = await E.exportComp(st.S.project, c, { format: fmt, res, quality: 'medium', range: 'work' }); const p = await desktopSave('selftest.' + x.ext, x.blob); r.files = r.files || {}; r.files[fmt] = { path: p, size: x.blob.size }; return `${x.codec || ''} ${x.blob.size} bytes ${Math.round(performance.now() - t0)} ms`; };
      await step('算繪 MP4 並存檔', () => save('mp4', 0.5));
      await step('算繪 GIF 並存檔', () => save('gif', 0.25));
      await step('PNG（透明）並存檔', () => save('png', 0.5));
      await step('Lottie JSON 並存檔', () => save('lottie', 1));
      await step('專案檔存檔（.xke）', async () => { const b = new Blob([JSON.stringify(st.S.project)], { type: 'application/json' }); const p = await desktopSave('selftest.xke', b); r.files.xke = { path: p, size: b.size }; return b.size; });
      await step('網頁版本號', async () => (await import(O + '/js/updater.js')).APP_VERSION);
      r.ok = r.steps.every(s => s.ok);
      window.__xkeTest = r;
      return 'started';
    })();
    'started'
    """

    def __init__(self, window, bridge: DesktopBridge, report_path: Path):
        self.window, self.bridge, self.report_path = window, bridge, report_path
        self.out_dir = report_path.parent
        bridge.forced_save_dir = self.out_dir

    def run(self):
        report = {"app": APP_NAME, "version": APP_VERSION, "platform": sys.platform, "ok": False}
        try:
            for _ in range(180):
                if self.window.evaluate_js("!!(window.xiaokeFX && window.pywebview && window.pywebview.api)"):
                    break
                time.sleep(0.5)
            time.sleep(2)
            self.window.evaluate_js(self.JS_TEST)
            res, last = None, None
            for _ in range(600):
                time.sleep(0.5)
                res = self.window.evaluate_js("window.__xkeTest ? JSON.stringify(window.__xkeTest) : null")
                if res:
                    break
                prog = self.window.evaluate_js("window.__xkeProgress || ''")
                if prog and prog != last:
                    safe_print("[selftest] " + prog)
                    last = prog
            report["web"] = json.loads(res) if res else {"ok": False, "note": "網頁沒有回傳測試結果"}
            files = report["web"].get("files") or {}
            report["files_ok"] = {k: Path(v.get("path") or "").is_file() and Path(v["path"]).stat().st_size > 100 for k, v in files.items()}
            mp4 = Path((files.get("mp4") or {}).get("path") or "")
            report["mp4_h264"] = mp4.is_file() and b"avc1" in mp4.read_bytes()[:200000]
            report["update_check"] = self.bridge.check_update()
            try:   # AE 專案轉換器（py_aep）有沒有一起打包進來
                import aep2xke
                report["aep_converter"] = {"ok": True, "py_aep": getattr(aep2xke.py_aep, "__version__", "?"), "fx_js": (AppInfo.web_dir() / "js" / "fx.js").is_file()}
            except Exception as e:
                report["aep_converter"] = {"ok": False, "error": f"{type(e).__name__}: {e}"}
            self.screenshot("selftest.png")
            report["ok"] = bool(report["web"].get("ok") and report["files_ok"] and all(report["files_ok"].values()) and report["aep_converter"]["ok"])
        except Exception:
            report["error"] = traceback.format_exc()
        finally:
            self.report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
            try:
                self.window.destroy()
            except Exception:
                os._exit(0 if report["ok"] else 1)

    def screenshot(self, name):
        try:
            from PIL import ImageGrab
            ImageGrab.grab().save(self.out_dir / name)
        except Exception as e:
            (self.out_dir / (name + ".txt")).write_text(str(e), encoding="utf-8")


class DisplayScale:
    """Windows「文字大小」放大（例如 210%）時 WebView2 會整頁放大變成手機版面：限制縮放讓網頁寬度至少 1366px。"""
    MIN_CSS_WIDTH = 1366

    @staticmethod
    def fit(window):
        try:
            info = None
            for _ in range(40):
                info = window.evaluate_js("[innerWidth, devicePixelRatio]")
                if info:
                    break
                time.sleep(0.25)
            css_width, dpr = info
            target = max(1.0, min(dpr, css_width * dpr / DisplayScale.MIN_CSS_WIDTH))
            zoom = round(target / dpr, 3)
            if abs(zoom - 1) < 0.01:
                return
            from System import Action
            control = window.native.browser.webview
            window.native.Invoke(Action(lambda: setattr(control, "ZoomFactor", zoom)))
        except Exception:
            pass


def make_dpi_aware():
    if not IS_WIN:
        return
    try:
        import ctypes
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception:
        pass


def main():
    args = sys.argv[1:]
    if "--version" in args:
        print(f"{APP_NAME} {APP_VERSION}")
        return
    selftest = None
    if "--selftest" in args:
        i = args.index("--selftest")
        selftest = Path(args[i + 1] if i + 1 < len(args) else "selftest.json").resolve()
        selftest.parent.mkdir(parents=True, exist_ok=True)
        # 測試用獨立的資料夾與埠號，不影響使用者正在開的小柯特效（共用動畫資料夾也換成測試用的）
        os.environ.setdefault("XKE_DATA_DIR", str(selftest.parent / "data"))
        os.environ.setdefault("XKE_SHARED_DIR", str(selftest.parent / "shared"))
        global HTTP_PORT
        HTTP_PORT = int(os.environ.get("XKE_PORT") or 48141)

    open_path = next((a for a in args if not a.startswith("--") and Path(a).suffix.lower() in (".xke", ".json") and Path(a).is_file()), "")
    open_path = str(Path(open_path).resolve()) if open_path else ""

    make_dpi_aware()
    if IS_MAC:
        os.environ.setdefault("QTWEBENGINE_CHROMIUM_FLAGS", "--autoplay-policy=no-user-gesture-required --enable-features=WebCodecs --ignore-gpu-blocklist")
    import webview

    if not selftest and LocalServer.existing_instance(open_path):
        return   # 已經開著：已請它把視窗叫到最前面
    server = LocalServer()
    bridge = DesktopBridge(server)
    url = server.url + ("?new=1&template=intro" if selftest else "")
    window = webview.create_window(APP_NAME, url=url, js_api=bridge, width=1440, height=900, min_size=(1000, 640),
                                   background_color="#121315", maximized=selftest is None)
    bridge.attach(window)

    def show_window():
        try:
            window.restore()
            window.show()
            window.on_top = True
            time.sleep(0.3)
            window.on_top = False
        except Exception:
            pass

    LocalServer.on_show = show_window

    def open_file(path):
        # 等網頁準備好，再請它從本機伺服器讀這個檔案
        token = uuid.uuid4().hex
        LocalServer.files[token] = path
        for _ in range(120):
            try:
                if window.evaluate_js("!!window.xiaokeFX"):
                    break
            except Exception:
                pass
            time.sleep(0.5)
        name = json.dumps(Path(path).name)
        window.evaluate_js(f"xiaokeFX.openUrl('/__xke_file/{token}', {name})")
        show_window()

    LocalServer.on_open = open_file
    try:
        webview.settings["ALLOW_DOWNLOADS"] = True
    except Exception:
        pass
    tester = SelfTest(window, bridge, selftest) if selftest else None

    def on_start():
        if IS_WIN:
            DisplayScale.fit(window)
        if tester:
            threading.Thread(target=tester.run, daemon=True).start()
        elif open_path:
            threading.Thread(target=open_file, args=(open_path,), daemon=True).start()

    gui = "edgechromium" if IS_WIN else "qt"
    webview.start(on_start, gui=gui, private_mode=False, storage_path=str(AppInfo.data_dir() / "webview"), debug=False)


if __name__ == "__main__":
    main()

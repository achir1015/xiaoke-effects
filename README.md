# 小柯機器人動態圖形和視覺特效工具

免費的動態圖形（Motion Graphics）與視覺特效（VFX）合成工具。參考開源專案 [EffectCraft](https://github.com/storytold/effectcraft) 的功能與操作方式，以 JavaScript／WebGL 重新撰寫，介面支援 13 種語言，手機、平板也能用。

**線上版：** https://achir1015.github.io/xiaoke-effects/（可「加入主畫面」當 App 使用，離線也能開）

**桌面版：** [Releases](https://github.com/achir1015/xiaoke-effects/releases/latest) 下載 Windows 10／11 安裝檔（.exe）或 Mac（Apple 晶片／Intel）.dmg。輸出直接存到電腦、雙擊 .xke 開專案（Windows）、App 內自動更新。

## 功能

- 合成與巢狀合成、工作區域、專案範本（片頭標題、下標字幕、粒子、3D 卡片、標誌顯示、直式短影音、倒數、霓虹、故障風、動態文字）
- 圖層：純色、形狀、文字、圖片、影片、音訊、空物件、調整圖層、巢狀合成、攝影機、燈光、Lottie、素材庫的動態背景／特效
- 關鍵影格（線性、貝茲、保持、緩和曲線）、圖表編輯器、表達式（wiggle、loopOut、linear、ease、thisComp.layer() …）
- 110 種 GPU 特效（模糊、色彩校正、扭曲、生成、風格化、圖層樣式、轉場、去背、粒子…），表達式控制項
- 遮罩（矩形、橢圓、鋼筆，羽化、擴展、模式）、軌道遮罩、28 種混合模式、動態模糊、父子關係
- 形狀圖層：修剪路徑、重複器、鋸齒、擺動、漸層填色；文字動畫器（範圍選取器）
- 3D 圖層、單／雙節點攝影機、點光源／聚光燈／平行光／環境光
- 動畫預設集 48 種、素材庫（貼圖、動態背景、動態特效、110 首配樂，取自小柯影音剪輯助手）
- 匯出 MP4（H.264＋AAC）、WebM、GIF、PNG 單張／序列（ZIP，透明背景）、WAV、Lottie JSON；可匯入 Lottie
- 算繪佇列、專案檔 `.xke`（JSON，內含素材）、自動儲存在瀏覽器
- 所有命令都有 ID，可用 `window.xiaokeFX.execute('layer.newText', {...})` 自動化
- 「說明 ▸ 開啟原版 EffectCraft 引擎」：在新分頁開啟原版的 WebAssembly 瀏覽器版（306 種特效）

## 開發

不需要編譯，任何靜態伺服器都能跑：

```
python -m http.server 8799
```

- 圖示：`python tools/make_icons.py`（需要 Pillow）
- 語言檔檢查：`node tools/check_i18n.mjs`（新字串先加進 `js/lang/zh-TW.js`，再補其他 12 種語言）
- 原版引擎：`python tools/fetch_engine.py` 下載到 `engine/`（不進 git，部署時由 CI 下載）
- 特效測試頁：`tests/fx-test.html`

## 桌面版

`desktop/app.py`：pywebview（Windows＝WebView2、Mac＝Qt WebEngine）＋本機伺服器（127.0.0.1:48131）提供和線上版同一份網頁。
- Windows 打包：`powershell -ExecutionPolicy Bypass -File desktop/build_windows.ps1` → `dist-installer/XiaokeEffects-Setup-版本.exe`
- 自我測試：`XiaokeEffects.exe --selftest 報告.json`（使用獨立資料夾與埠號 48141，不影響使用者資料）
- Mac 的 Qt WebEngine 沒有 H.264 編碼器：存 MP4 時用 ffmpeg 轉成 H.264＋AAC

## 發佈

改 `version.json`（版本號＋更新說明）與 `js/updater.js` 的 `APP_VERSION`，推到 main：
- `pages.yml`：檢查後發佈線上版到 GitHub Pages，網頁會提示「有新版本」
- `desktop.yml`：Windows、Mac 打包並安裝後自我測試，全部通過就建立 GitHub Release（版本號沒變時只測試不發佈）

## 授權

本專案程式碼：MIT。參考／使用的開源專案：EffectCraft（MIT／Apache-2.0）、mediabunny（MPL-2.0）、gifenc（MIT）、lottie-web（MIT）、Google Fonts（OFL）。

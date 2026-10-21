package com.achir.xiaokeeffects;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.View;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * 小柯機器人動態圖形和視覺特效工具 — Android 版
 * 用 WebView 開啟和線上版同一份網頁（放在 APK 的 assets/web）。
 * 網頁從 https://appassets.androidplatform.net/ 載入（安全來源：ES 模組、IndexedDB、WebCodecs 才能用），
 * 由 shouldInterceptRequest 直接回傳 assets 裡的檔案，不需要網路。
 */
public class MainActivity extends Activity {
    static final String TAG = "XiaokeFX";
    static final String ORIGIN = "https://appassets.androidplatform.net";
    static final int REQ_FILES = 1;

    WebView web;
    Bridge bridge;
    ValueCallback<Uri[]> fileCallback;
    /** 代號 → 其他 App 傳進來的檔案（網頁用 /__xke_file/代號 讀取） */
    final Map<String, Uri> sharedFiles = new HashMap<>();
    boolean pageReady = false;
    Uri pendingOpen;
    String pendingName;
    long lastBack = 0;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED);
        web = new WebView(this);
        web.setBackgroundColor(0xFF121315);
        setContentView(web);
        WebView.setWebContentsDebuggingEnabled(BuildFlags.DEBUG);   // python build.py debug 才開（給 chrome://inspect 測試用）

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setTextZoom(100);   // 不跟著系統字型大小放大，版面才不會擠在一起
        s.setUserAgentString(s.getUserAgentString() + " XiaokeEffectsAndroid/" + Bridge.version(this));

        bridge = new Bridge(this);
        web.addJavascriptInterface(bridge, "XiaokeAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (!ORIGIN.equals(u.getScheme() + "://" + u.getHost())) return null;
                return serve(u.getPath());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (ORIGIN.equals(u.getScheme() + "://" + u.getHost())) return false;
                // 外部連結（GitHub、原版引擎）交給系統瀏覽器
                try { startActivity(new Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); } catch (Exception ignored) { }
                return true;
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                pageReady = true;
                if (pendingOpen != null) { openInWeb(pendingOpen, pendingName); pendingOpen = null; }
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, p.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                String[] types = p.getAcceptTypes();
                if (types != null && types.length > 0 && !(types.length == 1 && types[0].isEmpty())) {
                    java.util.List<String> mimes = new java.util.ArrayList<>();
                    for (String t : types) for (String x : t.split(",")) { x = x.trim(); if (x.contains("/")) mimes.add(x); }
                    // .xke、.json 這類副檔名沒有對應的 MIME，就不限制類型
                    boolean onlyMime = true;
                    for (String t : types) for (String x : t.split(",")) if (x.trim().startsWith(".")) onlyMime = false;
                    if (onlyMime && !mimes.isEmpty()) i.putExtra(Intent.EXTRA_MIME_TYPES, mimes.toArray(new String[0]));
                }
                try { startActivityForResult(i, REQ_FILES); }
                catch (Exception e) { fileCallback = null; return false; }
                return true;
            }

            @Override
            public void onPermissionRequest(PermissionRequest r) { r.deny(); }

            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d(TAG, m.message() + " @" + m.sourceId() + ":" + m.lineNumber());
                return true;
            }
        });

        handleIntent(getIntent());
        web.loadUrl(ORIGIN + "/index.html");
    }

    /** 回傳 assets/web 裡的檔案，或其他 App 傳進來的檔案 */
    WebResourceResponse serve(String path) {
        try {
            if (path == null || path.equals("/")) path = "/index.html";
            Map<String, String> h = new HashMap<>();
            h.put("Cache-Control", "no-store");
            h.put("Access-Control-Allow-Origin", ORIGIN);
            if (path.startsWith("/__xke_file/")) {
                Uri u = sharedFiles.get(path.substring(path.lastIndexOf('/') + 1));
                if (u == null) return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", h, null);
                InputStream in = getContentResolver().openInputStream(u);
                return new WebResourceResponse("application/octet-stream", null, 200, "OK", h, in);
            }
            InputStream in = getAssets().open("web" + Uri.decode(path));
            return new WebResourceResponse(mime(path), mime(path).startsWith("text") || path.endsWith(".js") || path.endsWith(".json") ? "utf-8" : null, 200, "OK", h, in);
        } catch (Exception e) {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, null);
        }
    }

    static String mime(String p) {
        p = p.toLowerCase();
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".webmanifest")) return "application/manifest+json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".wasm")) return "application/wasm";
        return "application/octet-stream";
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        handleIntent(i);
    }

    /** 其他 App 開啟或分享檔案進來 */
    void handleIntent(Intent i) {
        if (i == null) return;
        Uri u = null;
        if (Intent.ACTION_VIEW.equals(i.getAction())) u = i.getData();
        else if (Intent.ACTION_SEND.equals(i.getAction())) u = i.getParcelableExtra(Intent.EXTRA_STREAM);
        if (u == null) return;
        String name = Bridge.displayName(this, u);
        if (pageReady) openInWeb(u, name); else { pendingOpen = u; pendingName = name; }
    }

    void openInWeb(final Uri u, final String name) {
        final String token = UUID.randomUUID().toString().replace("-", "");
        sharedFiles.put(token, u);
        // 等網頁的 xiaokeFX 準備好
        final Handler hd = new Handler(Looper.getMainLooper());
        final int[] tries = {0};
        hd.post(new Runnable() {
            public void run() {
                web.evaluateJavascript("!!window.xiaokeFX", v -> {
                    if ("true".equals(v)) {
                        String n = org.json.JSONObject.quote(name == null ? "file" : name);
                        web.evaluateJavascript("xiaokeFX.openUrl('/__xke_file/" + token + "', " + n + ")", null);
                    } else if (tries[0]++ < 60) hd.postDelayed(this, 500);
                });
            }
        });
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req == REQ_FILES && fileCallback != null) {
            Uri[] out = null;
            if (res == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int n = data.getClipData().getItemCount();
                    out = new Uri[n];
                    for (int k = 0; k < n; k++) out[k] = data.getClipData().getItemAt(k).getUri();
                } else if (data.getData() != null) out = new Uri[]{data.getData()};
            }
            fileCallback.onReceiveValue(out);
            fileCallback = null;
            return;
        }
        super.onActivityResult(req, res, data);
    }

    @Override
    public void onBackPressed() {
        // 先讓網頁關掉對話框／選單；沒有可關的再按一次才離開
        web.evaluateJavascript("(function(){var m=document.querySelector('.modal-bg,.dropdown');if(m){document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));var b=document.querySelector('.modal-bg');if(b)b.remove();document.querySelectorAll('.dropdown').forEach(function(d){d.remove()});return true}return false})()", v -> {
            if ("true".equals(v)) return;
            long now = System.currentTimeMillis();
            if (now - lastBack < 2000) { finish(); return; }
            lastBack = now;
            Toast.makeText(this, "再按一次返回鍵離開（作品已自動儲存）", Toast.LENGTH_SHORT).show();
        });
    }

    @Override
    protected void onPause() { super.onPause(); web.onPause(); }

    @Override
    protected void onResume() { super.onResume(); web.onResume(); }

    @Override
    protected void onDestroy() {
        web.removeJavascriptInterface("XiaokeAndroid");
        web.destroy();
        super.onDestroy();
    }
}

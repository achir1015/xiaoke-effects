import SwiftUI
import UIKit
import WebKit

/// 小柯機器人動態圖形和視覺特效工具 — iPhone／iPad 版
/// WKWebView 開啟 App 內建的網頁（和線上版同一份），由 LocalServer 在 127.0.0.1 提供。
@main
struct XiaokeEffectsApp: App {
    init() { LocalServer.shared.start() }

    var body: some Scene {
        WindowGroup {
            WebContainer()
                .background(Color(red: 0.07, green: 0.075, blue: 0.08))
                .ignoresSafeArea(.container, edges: .bottom)
                .onOpenURL { url in Web.shared.open(file: url) }
        }
    }
}

struct WebContainer: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView { Web.shared.view }
    func updateUIView(_ v: WKWebView, context: Context) {}
}

/// 網頁與 App 之間的橋：網頁呼叫 window.webkit.messageHandlers.xke.postMessage({cmd, args})，回傳 Promise
final class Web: NSObject, WKScriptMessageHandlerWithReply, WKNavigationDelegate, WKUIDelegate {
    static let shared = Web()
    let view: WKWebView
    private var saves: [String: (url: URL, handle: FileHandle, name: String)] = [:]
    private var pageReady = false
    private var pendingFile: URL?

    override init() {
        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.websiteDataStore = .default()
        // 讓網頁知道自己在 iPhone App 裡（網頁的 js/desktop.js 會改用 App 的存檔、開網址功能）
        let shim = WKUserScript(source: "window.XiaokeIOS = true;", injectionTime: .atDocumentStart, forMainFrameOnly: true)
        cfg.userContentController.addUserScript(shim)
        view = WKWebView(frame: .zero, configuration: cfg)
        super.init()
        cfg.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "xke")
        view.navigationDelegate = self
        view.uiDelegate = self
        view.isOpaque = false
        view.backgroundColor = UIColor(red: 0.07, green: 0.075, blue: 0.08, alpha: 1)
        view.scrollView.backgroundColor = view.backgroundColor
        view.scrollView.bounces = false
        view.scrollView.contentInsetAdjustmentBehavior = .never
        if #available(iOS 16.4, *) { view.isInspectable = true }
        view.load(URLRequest(url: LocalServer.shared.url))
    }

    // MARK: 從「檔案」App 開啟 .xke 專案檔
    func open(file: URL) {
        if !pageReady { pendingFile = file; return }
        // 先複製到 App 的暫存資料夾（離開「檔案」App 後原本的存取權可能失效）
        let ok = file.startAccessingSecurityScopedResource()
        defer { if ok { file.stopAccessingSecurityScopedResource() } }
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(file.lastPathComponent)
        try? FileManager.default.removeItem(at: tmp)
        try? FileManager.default.copyItem(at: file, to: tmp)
        let token = LocalServer.shared.register(tmp)
        let name = (try? String(data: JSONEncoder().encode(file.lastPathComponent), encoding: .utf8)) ?? "\"project.xke\""
        waitForApp { self.view.evaluateJavaScript("xiaokeFX.openUrl('/__xke_file/\(token)', \(name))") }
    }

    private func waitForApp(tries: Int = 0, _ then: @escaping () -> Void) {
        view.evaluateJavaScript("!!window.xiaokeFX") { v, _ in
            if (v as? Bool) == true { then() }
            else if tries < 60 { DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.waitForApp(tries: tries + 1, then) } }
        }
    }

    func webView(_ w: WKWebView, didFinish n: WKNavigation!) {
        pageReady = true
        if let f = pendingFile { pendingFile = nil; open(file: f) }
    }

    // 外部連結（GitHub、原版引擎）用 Safari 開
    func webView(_ w: WKWebView, decidePolicyFor a: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let u = a.request.url, u.host != "127.0.0.1", u.scheme?.hasPrefix("http") == true {
            UIApplication.shared.open(u); decisionHandler(.cancel); return
        }
        decisionHandler(.allow)
    }
    func webView(_ w: WKWebView, createWebViewWith c: WKWebViewConfiguration, for a: WKNavigationAction, windowFeatures f: WKWindowFeatures) -> WKWebView? {
        if let u = a.request.url { UIApplication.shared.open(u) }
        return nil
    }

    // 網頁的 alert / confirm（保險起見）
    func webView(_ w: WKWebView, runJavaScriptAlertPanelWithMessage m: String, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = UIAlertController(title: nil, message: m, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "好", style: .default) { _ in completionHandler() })
        top()?.present(a, animated: true)
    }

    // MARK: 網頁呼叫的功能
    func userContentController(_ u: WKUserContentController, didReceive m: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = m.body as? [String: Any], let cmd = body["cmd"] as? String else { replyHandler(nil, "bad message"); return }
        let args = body["args"] as? [Any] ?? []
        let s = { (i: Int) -> String in args.count > i ? "\(args[i])" : "" }
        switch cmd {
        case "app_info":
            let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0"
            replyHandler(["status": "ok", "name": "小柯特效", "version": v, "platform": "ios", "model": UIDevice.current.model], nil)
        case "begin_save":
            let name = s(0).replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: ":", with: "_")
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent("export", isDirectory: true)
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let url = dir.appendingPathComponent(name.isEmpty ? "xiaoke.mp4" : name)
            try? FileManager.default.removeItem(at: url)
            FileManager.default.createFile(atPath: url.path, contents: nil)
            guard let h = try? FileHandle(forWritingTo: url) else { replyHandler(["status": "error", "message": "無法建立檔案"], nil); return }
            let token = UUID().uuidString
            saves[token] = (url, h, url.lastPathComponent)
            replyHandler(["status": "ok", "token": token, "path": url.lastPathComponent], nil)
        case "write_chunk":
            guard let sv = saves[s(0)], let d = Data(base64Encoded: s(1)) else { replyHandler(["status": "error", "message": "no session"], nil); return }
            sv.handle.write(d)
            replyHandler(["status": "ok"], nil)
        case "end_save":
            guard let sv = saves.removeValue(forKey: s(0)) else { replyHandler(["status": "error", "message": "no session"], nil); return }
            try? sv.handle.close()
            // 打開分享選單：「儲存到檔案」、「儲存影片／影像」（存到照片）、AirDrop、LINE…
            share(sv.url) { done in replyHandler(done ? ["status": "ok", "path": sv.name] : ["status": "declined"], nil) }
        case "open_url":
            if let u = URL(string: s(0)), u.host == "achir1015.github.io" || u.host == "github.com" { UIApplication.shared.open(u) }
            replyHandler(true, nil)
        case "check_update":
            // iPhone 版由 Xcode 安裝，App 內不能自己更新：回報已是最新版
            let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0"
            replyHandler(["status": "ok", "current": v, "latest": v, "url": ""], nil)
        case "update_status":
            replyHandler(["state": "idle", "pct": 0], nil)
        default:
            replyHandler(nil, "unknown command \(cmd)")
        }
    }

    private func share(_ url: URL, done: @escaping (Bool) -> Void) {
        let vc = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        vc.completionWithItemsHandler = { _, completed, _, _ in done(completed) }
        if let p = vc.popoverPresentationController {   // iPad：從畫面中央彈出
            p.sourceView = view
            p.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
            p.permittedArrowDirections = []
        }
        top()?.present(vc, animated: true)
    }

    private func top() -> UIViewController? {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        var vc = scene?.windows.first(where: { $0.isKeyWindow })?.rootViewController
        while let p = vc?.presentedViewController { vc = p }
        return vc
    }
}

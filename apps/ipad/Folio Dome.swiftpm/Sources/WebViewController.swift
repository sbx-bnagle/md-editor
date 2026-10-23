// The web view: loads app://ui/index.html (the UI, with apps/ipad/src/main.ts before it),
// serves the app's files and the documents' images and fonts, and connects the page to Bridge.

import UIKit
import WebKit

/** A web view that adds "More…" to the text edit menu, which opens Folio Dome's own menu there. */
final class FolioWebView: WKWebView {
    var onMore: (() -> Void)?

    override func buildMenu(with builder: UIMenuBuilder) {
        super.buildMenu(with: builder)
        guard builder.system == .context, onMore != nil else { return }
        let more = UIAction(title: "More…", image: UIImage(systemName: "ellipsis.circle")) { [weak self] _ in
            self?.onMore?()
        }
        builder.insertChild(UIMenu(title: "", options: .displayInline, children: [more]), atEndOfMenu: .root)
    }
}

@MainActor
final class WebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    /** The window that has the web view (there is one; see WebContainer). */
    static private(set) weak var current: WebViewController?
    private static var claimed = false

    static func claim() -> WebViewController? {
        if claimed { return nil }
        claimed = true
        return WebViewController()
    }

    private(set) var webView: FolioWebView!
    private let bridge = Bridge()
    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid

    override func viewDidLoad() {
        super.viewDidLoad()
        WebViewController.current = self
        view.backgroundColor = UIColor(red: 0x1a / 255, green: 0x1b / 255, blue: 0x1d / 255, alpha: 1)
        Folders.shared.restore()

        let config = WebViewController.configuration()
        config.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "folio")
        bridge.controller = self

        webView = FolioWebView(frame: view.bounds, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = view.backgroundColor
        webView.scrollView.backgroundColor = view.backgroundColor
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false
        webView.allowsLinkPreview = false
        if #available(iOS 16.4, *) {
            // Safari on a Mac can inspect the page (Develop menu), which helps when something goes wrong.
            webView.isInspectable = true
        }
        webView.onMore = { [weak self] in self?.dispatch(["type": "contextmenu", "x": 0, "y": 0]) }
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])

        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(willResignActive), name: UIApplication.willResignActiveNotification, object: nil)
        center.addObserver(self, selector: #selector(didBecomeActive), name: UIApplication.didBecomeActiveNotification, object: nil)

        webView.load(URLRequest(url: URL(string: "app://ui/index.html")!))
    }

    /** The settings shared by the main web view and the ones that lay out exports. */
    static func configuration() -> WKWebViewConfiguration {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(AppSchemeHandler.shared, forURLScheme: "app")
        config.setURLSchemeHandler(AssetSchemeHandler.shared, forURLScheme: "mde-asset")
        config.userContentController = WKUserContentController()
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        config.dataDetectorTypes = []
        return config
    }

    // MARK: Events to the page

    func dispatch(_ event: [String: Any]) {
        webView?.callAsyncJavaScript("window.__folioDispatch && window.__folioDispatch(e)", arguments: ["e": event], in: nil, in: .page, completionHandler: nil)
    }

    // MARK: Life cycle

    /** Saves typing and history before iOS suspends the app (it may end it without asking). */
    @objc private func willResignActive() {
        guard backgroundTask == .invalid else { return }
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "Save") { [weak self] in self?.endBackgroundTask() }
        webView.callAsyncJavaScript("if (window.__folioSuspend) await window.__folioSuspend();", arguments: [:], in: nil, in: .page) { [weak self] _ in
            self?.endBackgroundTask()
        }
    }

    @objc private func didBecomeActive() {
        dispatch(["type": "app.active", "active": true])
    }

    private func endBackgroundTask() {
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
    }

    // MARK: Navigation: the page stays the app; links open in Safari.

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url, let scheme = url.scheme?.lowercased() else { return decisionHandler(.cancel) }
        if ["app", "mde-asset", "about", "blob", "data"].contains(scheme) {
            // Only the app's own pages load in the main frame.
            if action.targetFrame?.isMainFrame == true && scheme != "app" { return decisionHandler(.cancel) }
            return decisionHandler(.allow)
        }
        if ["http", "https", "mailto"].contains(scheme), action.navigationType == .linkActivated || action.targetFrame == nil {
            UIApplication.shared.open(url)
        }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url, ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "") {
            UIApplication.shared.open(url)
        }
        return nil
    }

    /** The page was ended (iOS reclaims memory from web content in the background): start it again. */
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: message, message: nil, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: message, message: nil, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = UIAlertController(title: prompt, message: nil, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(alert.textFields?.first?.text) })
        present(alert, animated: true)
    }

    /** The view controller to present pickers and alerts from. */
    var presenter: UIViewController {
        var top: UIViewController = self
        while let next = top.presentedViewController { top = next }
        return top
    }
}

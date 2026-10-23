// Exports: lays out a document in an offscreen web view with the same print page the Mac app
// uses (print.html, which pages it with Paged.js), then prints the pages to a PDF. WebKit on iPad
// prints without tags, so these PDFs do not carry PDF/UA (the backend leaves that claim out).

import UIKit
import WebKit

/** Prints at the page size the layout chose (each laid-out page is one PDF page). */
private final class PageRenderer: UIPrintPageRenderer {
    let page: CGRect

    init(page: CGRect) {
        self.page = page
        super.init()
    }

    override var paperRect: CGRect { page }
    override var printableRect: CGRect { page }
}

@MainActor
final class Printer: NSObject, WKNavigationDelegate {
    private var loads: [ObjectIdentifier: CheckedContinuation<Void, Error>] = [:]

    private func makeWebView() -> WKWebView {
        let web = WKWebView(frame: CGRect(x: 0, y: 0, width: 1000, height: 1200), configuration: WebViewController.configuration())
        web.navigationDelegate = self
        web.isOpaque = true
        // In the window (laid out and drawn like any page) but behind the app's own view.
        if let window = WebViewController.current?.view.window {
            window.insertSubview(web, at: 0)
        }
        return web
    }

    private func load(_ web: WKWebView) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            loads[ObjectIdentifier(web)] = continuation
            web.load(URLRequest(url: URL(string: "app://ui/print.html")!))
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loads.removeValue(forKey: ObjectIdentifier(webView))?.resume()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        loads.removeValue(forKey: ObjectIdentifier(webView))?.resume(throwing: error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        loads.removeValue(forKey: ObjectIdentifier(webView))?.resume(throwing: error)
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let scheme = action.request.url?.scheme?.lowercased() ?? ""
        decisionHandler(["app", "mde-asset", "about", "blob", "data"].contains(scheme) ? .allow : .cancel)
    }

    private func input(_ a: [String: Any]) -> [String: Any] {
        ["html": a["html"] as? String ?? "", "css": a["css"] as? String ?? "", "title": a["title"] as? String ?? "", "lang": a["lang"] as? String ?? "en"]
    }

    /** { pdf: base64, inserts } for print.pdf. */
    func pdf(_ a: [String: Any]) async throws -> [String: Any] {
        let web = makeWebView()
        defer { web.removeFromSuperview() }
        try await load(web)
        var request = input(a)
        request["print"] = true
        let layout = try await web.callAsyncJavaScript("return await window.__mdeRender(input);", arguments: ["input": request], in: nil, contentWorld: .page) as? [String: Any]
        // Paged.js lays out pages at the page size in CSS pixels (96 per inch); PDF pages are in points (72 per inch).
        let size = try await web.callAsyncJavaScript(
            "const p = document.querySelector('.pagedjs_page'); const r = p ? p.getBoundingClientRect() : { width: 816, height: 1056 }; return [r.width, r.height];",
            arguments: [:], in: nil, contentWorld: .page) as? [Double] ?? [816, 1056]
        let page = CGRect(x: 0, y: 0, width: size[0] * 0.75, height: size[1] * 0.75)
        let data = render(web, page: page, title: request["title"] as? String ?? "")
        return ["pdf": data.base64EncodedString(), "inserts": layout?["inserts"] ?? []]
    }

    /** The document's HTML with diagrams drawn, for the web page export. */
    func webPage(_ a: [String: Any]) async throws -> String {
        let web = makeWebView()
        defer { web.removeFromSuperview() }
        try await load(web)
        let html = try await web.callAsyncJavaScript("return await window.__mdeRenderWeb(input);", arguments: ["input": input(a)], in: nil, contentWorld: .page)
        return html as? String ?? ""
    }

    private func render(_ web: WKWebView, page: CGRect, title: String) -> Data {
        let renderer = PageRenderer(page: page)
        renderer.addPrintFormatter(web.viewPrintFormatter(), startingAtPageAt: 0)
        let data = NSMutableData()
        UIGraphicsBeginPDFContextToData(data, page, [kCGPDFContextTitle as String: title, kCGPDFContextCreator as String: "Folio Dome"])
        let pages = renderer.numberOfPages
        renderer.prepare(forDrawingPages: NSRange(location: 0, length: pages))
        for i in 0..<pages {
            UIGraphicsBeginPDFPage()
            renderer.drawPage(at: i, in: UIGraphicsGetPDFContextBounds())
        }
        UIGraphicsEndPDFContext()
        return data as Data
    }
}

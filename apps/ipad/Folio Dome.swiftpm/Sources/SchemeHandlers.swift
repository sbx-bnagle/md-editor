// app://ui/… serves the app's web files (as the Mac app's app:// protocol does); mde-asset://local/…
// serves images and fonts that documents and themes use, from the folders the backend allows
// (the library and the built-in seed), as the Mac app's asset protocol does.

import Foundation
import UniformTypeIdentifiers
import WebKit

private let mimeTypes: [String: String] = [
    "html": "text/html", "js": "text/javascript", "mjs": "text/javascript", "css": "text/css", "json": "application/json",
    "wasm": "application/wasm", "svg": "image/svg+xml", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
    "gif": "image/gif", "webp": "image/webp", "avif": "image/avif", "ico": "image/x-icon", "pdf": "application/pdf",
    "woff2": "font/woff2", "woff": "font/woff", "ttf": "font/ttf", "otf": "font/otf", "txt": "text/plain", "md": "text/markdown",
    "thes": "text/plain", "csv": "text/csv", "mp4": "video/mp4", "mov": "video/quicktime", "mp3": "audio/mpeg",
]

private func mimeType(_ url: URL) -> String {
    let ext = url.pathExtension.lowercased()
    if let known = mimeTypes[ext] { return known }
    return UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
}

/** Answers scheme requests, and forgets the ones WebKit has stopped (answering those would crash). */
class SchemeHandler: NSObject, WKURLSchemeHandler {
    private var active = Set<ObjectIdentifier>()

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        active.insert(ObjectIdentifier(task))
        guard let url = task.request.url, let file = file(for: url) else {
            return finish(task, url: task.request.url, status: 404, data: Data("Not found".utf8), type: "text/plain")
        }
        DispatchQueue.global(qos: .userInitiated).async {
            let data = try? FileOps.coordinateRead(file, "open") { try Data(contentsOf: $0) }
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    if let data {
                        self.finish(task, url: url, status: 200, data: data, type: mimeType(file))
                    } else {
                        self.finish(task, url: url, status: 404, data: Data("Not found".utf8), type: "text/plain")
                    }
                }
            }
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        active.remove(ObjectIdentifier(task))
    }

    /** The file a URL stands for, or nil when it may not be served. */
    func file(for url: URL) -> URL? { nil }

    private func finish(_ task: WKURLSchemeTask, url: URL?, status: Int, data: Data, type: String) {
        guard active.remove(ObjectIdentifier(task)) != nil, let url else { return }
        let headers = [
            "Content-Type": type,
            "Content-Length": "\(data.count)",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache",
        ]
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }
}

final class AppSchemeHandler: SchemeHandler {
    static let shared = AppSchemeHandler()

    override func file(for url: URL) -> URL? {
        guard url.host == "ui" else { return nil }
        let root = Resources.renderer.standardizedFileURL
        let file = root.appendingPathComponent(url.path).standardizedFileURL
        guard file.path.hasPrefix(root.path + "/"), FileManager.default.fileExists(atPath: file.path) else { return nil }
        return file
    }
}

final class AssetSchemeHandler: SchemeHandler {
    static let shared = AssetSchemeHandler()

    /** Set by the page (backend.allowedRoots()) when a library opens. */
    var roots: [String] = []

    override func file(for url: URL) -> URL? {
        guard url.host == "local" else { return nil }
        let path = url.path
        let real = FileOps.canonical(path)
        let allowed = roots.map(FileOps.canonical)
        guard allowed.contains(where: { real == $0 || real.hasPrefix($0 + "/") }), (try? FileOps.check(path, .read, "open")) != nil else { return nil }
        return URL(fileURLWithPath: path)
    }
}

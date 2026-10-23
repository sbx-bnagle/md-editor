// Requests from the page (apps/ipad/src/native.ts): { op, ...args } in, { ok, value } or
// { ok: false, code, message } out. File work runs off the main thread.

import UIKit
import WebKit

struct BridgeError: Error {
    let code: String?
    let message: String

    init(_ message: String, code: String? = nil) {
        self.message = message
        self.code = code
    }
}

/** Runs `work` on a background queue. */
func background<T>(_ work: @escaping () throws -> T) async throws -> T {
    try await withCheckedThrowingContinuation { continuation in
        DispatchQueue.global(qos: .userInitiated).async {
            continuation.resume(with: Result { try work() })
        }
    }
}

@MainActor
final class Bridge: NSObject, WKScriptMessageHandlerWithReply {
    weak var controller: WebViewController?
    private var selfTestPending: Bool = UserDefaults.standard.bool(forKey: "FolioSelfTest")
    private let printer = Printer()

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        // Only the app's own page (not documents in the preview) may make requests.
        guard message.frameInfo.isMainFrame, message.frameInfo.request.url?.scheme == "app",
              let body = message.body as? [String: Any], let op = body["op"] as? String else {
            replyHandler(["ok": false, "code": "EPERM", "message": "Not permitted."], nil)
            return
        }
        Task { @MainActor in
            do {
                let value = try await self.handle(op, body)
                replyHandler(["ok": true, "value": value ?? NSNull()], nil)
            } catch let e as BridgeError {
                var reply: [String: Any] = ["ok": false, "message": e.message]
                if let code = e.code { reply["code"] = code }
                replyHandler(reply, nil)
            } catch {
                replyHandler(["ok": false, "message": error.localizedDescription], nil)
            }
        }
    }

    private func handle(_ op: String, _ a: [String: Any]) async throws -> Any? {
        func string(_ key: String) throws -> String {
            guard let v = a[key] as? String else { throw BridgeError("\(op): “\(key)” is missing.", code: "EINVAL") }
            return v
        }
        func optionalString(_ key: String) -> String? { a[key] as? String }
        func int(_ key: String) -> Int? { (a[key] as? NSNumber)?.intValue }

        switch op {
        case "app.info":
            let selfTest = selfTestPending
            selfTestPending = false
            return [
                "home": NSHomeDirectory(),
                "web": Resources.web.path,
                "support": try FileOps.supportDirectory(),
                "version": Resources.version,
                "folders": Folders.shared.moved.map { ["path": $0.path, "previousPath": $0.previousPath] },
                "selfTest": selfTest,
            ] as [String: Any]
        case "log":
            NSLog("[Folio Dome] %@", optionalString("message") ?? "")
            return nil

        // Files (FileOps.swift)
        case "fs.stat":
            let path = try string("path"), follow = (a["follow"] as? Bool) ?? true
            return try await background { try FileOps.stat(path, follow: follow) }
        case "fs.readdir":
            let path = try string("path")
            return try await background { try FileOps.readdir(path) }
        case "fs.read":
            let path = try string("path"), encoding = optionalString("encoding") ?? "base64", offset = int("offset"), length = int("length")
            return try await background { try FileOps.read(path, encoding: encoding, offset: offset, length: length) }
        case "fs.write":
            let path = try string("path"), data = try string("data"), encoding = optionalString("encoding") ?? "utf8", flag = optionalString("flag") ?? "w"
            try await background { try FileOps.write(path, data: data, encoding: encoding, flag: flag) }
            return nil
        case "fs.mkdir":
            let path = try string("path"), recursive = (a["recursive"] as? Bool) ?? false
            try await background { try FileOps.mkdir(path, recursive: recursive) }
            return nil
        case "fs.rename":
            let from = try string("from"), to = try string("to")
            try await background { try FileOps.rename(from, to) }
            return nil
        case "fs.rm":
            let path = try string("path"), recursive = (a["recursive"] as? Bool) ?? false, force = (a["force"] as? Bool) ?? false
            try await background { try FileOps.rm(path, recursive: recursive, force: force) }
            return nil
        case "fs.copy":
            let from = try string("from"), to = try string("to")
            try await background { try FileOps.copy(from, to) }
            return nil
        case "fs.realpath":
            let path = try string("path")
            return try await background { try FileOps.realpath(path) }
        case "fs.truncate":
            let path = try string("path"), length = int("length") ?? 0
            try await background { try FileOps.truncate(path, length: length) }
            return nil
        case "fs.chmod":
            let path = try string("path"), mode = int("mode") ?? 0o644
            try await background { try FileOps.chmod(path, mode: mode) }
            return nil
        case "fs.xattr.get":
            let path = try string("path"), name = try string("name")
            return try await background { try FileOps.getXattr(path, name: name) }
        case "fs.xattr.set":
            let path = try string("path"), name = try string("name"), value = optionalString("value")
            try await background { try FileOps.setXattr(path, name: name, base64: value) }
            return nil
        case "fs.watch":
            let id = try string("id"), path = try string("path")
            try Watchers.shared.start(id: id, path: path) { [weak self] id, paths in
                self?.post(["type": "fs.change", "id": id, "paths": paths])
            }
            return nil
        case "fs.unwatch":
            Watchers.shared.stop(id: try string("id"))
            return nil
        case "files.trash":
            let path = try string("path")
            try await background { try FileOps.trash(path) }
            return nil
        case "files.reveal":
            try FileOps.reveal(try string("path"))
            return nil
        case "assets.roots":
            AssetSchemeHandler.shared.roots = (a["roots"] as? [String]) ?? []
            return nil
        case "menu.set":
            // The menu bar is built from MenuSpec.swift, generated from the same menus.
            return nil

        // Dialogs (Pickers.swift)
        case "dialog.confirm":
            return await Pickers.confirm(from: presenter(), message: try string("message"), detail: optionalString("detail") ?? "", ok: optionalString("ok") ?? "OK")
        case "dialog.folder":
            return await Pickers.chooseFolder(from: presenter(), title: optionalString("title") ?? "") ?? NSNull()
        case "dialog.files":
            return await Pickers.chooseFiles(from: presenter(), title: optionalString("title") ?? "", extensions: (a["extensions"] as? [String]) ?? [])
        case "dialog.save":
            return await Pickers.chooseSavePath(from: presenter(), title: optionalString("title") ?? "", name: try string("name"), extensions: (a["extensions"] as? [String]) ?? []) ?? NSNull()
        case "clipboard.read":
            return UIPasteboard.general.string ?? NSNull()

        // Keys (Keychain.swift)
        case "secrets.has":
            let name = try string("name")
            return try await background { Keychain.get(name) != nil }
        case "secrets.set":
            let name = try string("name"), value = optionalString("value")
            try await background { try Keychain.set(name, value) }
            return nil

        // Spelling (Spelling.swift)
        case "spell.check":
            return Spelling.misspelled((a["words"] as? [String]) ?? [])
        case "spell.suggest":
            return Spelling.guesses(try string("word"))
        case "spell.learn":
            Spelling.learn(try string("word"))
            return nil

        // HTTP for the AI services (HttpProxy.swift)
        case "http.start":
            let id = try string("id"), url = try string("url"), method = optionalString("method") ?? "GET"
            let headers = (a["headers"] as? [String: String]) ?? [:]
            let body = optionalString("body").flatMap { Data(base64Encoded: $0) }
            try HttpProxy.shared.start(id: id, url: url, method: method, headers: headers, body: body) { [weak self] event in
                self?.post(event)
            }
            return nil
        case "http.cancel":
            HttpProxy.shared.cancel(id: try string("id"))
            return nil

        // Printing (Printer.swift)
        case "print.pdf":
            return try await printer.pdf(a)
        case "print.web":
            return try await printer.webPage(a)

        default:
            throw BridgeError("Unknown request \(op).", code: "ENOSYS")
        }
    }

    /** Sends an event to the page from any thread, keeping the order events were sent in (streamed replies). */
    nonisolated func post(_ event: [String: Any]) {
        DispatchQueue.main.async {
            MainActor.assumeIsolated {
                self.controller?.dispatch(event)
            }
        }
    }

    private func presenter() -> UIViewController {
        controller?.presenter ?? UIViewController()
    }
}

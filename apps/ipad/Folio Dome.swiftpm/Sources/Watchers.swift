// Change notices for the library folder (apps/ipad/src/shims/fs.ts, watch). An NSFilePresenter
// hears about changes that other apps and sync services (iCloud Drive, the Mac) make through
// file coordination; the app's own writes pass the presenter to their coordinator, so they are
// not reported back.

import Foundation

final class FolderPresenter: NSObject, NSFilePresenter {
    let id: String
    let root: URL
    private let report: (String, [String]) -> Void
    private var pending = Set<String>()
    private var timer: DispatchWorkItem?
    private let queue = DispatchQueue(label: "FolioDome.watch")

    let presentedItemOperationQueue: OperationQueue = {
        let q = OperationQueue()
        q.maxConcurrentOperationCount = 1
        return q
    }()

    var presentedItemURL: URL? { root }

    init(id: String, root: URL, report: @escaping (String, [String]) -> Void) {
        self.id = id
        self.root = root
        self.report = report
    }

    /** "/private/var/…" and "/var/…" name the same place on iOS. */
    private static func plain(_ path: String) -> String {
        path.hasPrefix("/private/") ? String(path.dropFirst("/private".count)) : path
    }

    private func changed(_ url: URL) {
        let base = FolderPresenter.plain(root.standardizedFileURL.path)
        let path = FolderPresenter.plain(url.standardizedFileURL.path)
        guard path.hasPrefix(base + "/") else { return }
        var rel = String(path.dropFirst(base.count + 1))
        // A placeholder for a file not downloaded yet stands for the file.
        let name = (rel as NSString).lastPathComponent
        if name.hasPrefix("."), name.hasSuffix(".icloud"), name.count > 8 {
            let dir = (rel as NSString).deletingLastPathComponent
            let target = String(name.dropFirst().dropLast(7))
            rel = dir.isEmpty ? target : (dir as NSString).appendingPathComponent(target)
        }
        queue.async {
            self.pending.insert(rel)
            self.timer?.cancel()
            let work = DispatchWorkItem { [weak self] in
                guard let self else { return }
                let paths = Array(self.pending)
                self.pending.removeAll()
                if !paths.isEmpty { self.report(self.id, paths) }
            }
            self.timer = work
            self.queue.asyncAfter(deadline: .now() + 0.3, execute: work)
        }
    }

    func presentedSubitemDidChange(at url: URL) { changed(url) }
    func presentedSubitemDidAppear(at url: URL) { changed(url) }
    func presentedSubitem(at oldURL: URL, didMoveTo newURL: URL) {
        changed(oldURL)
        changed(newURL)
    }
    func accommodatePresentedSubitemDeletion(at url: URL, completionHandler: @escaping (Error?) -> Void) {
        changed(url)
        completionHandler(nil)
    }
}

final class Watchers {
    static let shared = Watchers()
    private let lock = NSLock()
    private var presenters: [String: FolderPresenter] = [:]

    func start(id: String, path: String, report: @escaping (String, [String]) -> Void) throws {
        try FileOps.check(path, .read, "watch")
        let presenter = FolderPresenter(id: id, root: URL(fileURLWithPath: path, isDirectory: true), report: report)
        lock.lock()
        let old = presenters.updateValue(presenter, forKey: id)
        lock.unlock()
        if let old { NSFileCoordinator.removeFilePresenter(old) }
        NSFileCoordinator.addFilePresenter(presenter)
    }

    func stop(id: String) {
        lock.lock()
        let old = presenters.removeValue(forKey: id)
        lock.unlock()
        if let old { NSFileCoordinator.removeFilePresenter(old) }
    }

    /** The presenter whose folder holds `url`, for the app's own coordinated writes. */
    func presenter(for url: URL) -> NSFilePresenter? {
        let path = url.standardizedFileURL.path
        lock.lock()
        defer { lock.unlock() }
        return presenters.values.first { path.hasPrefix($0.root.standardizedFileURL.path + "/") }
    }
}

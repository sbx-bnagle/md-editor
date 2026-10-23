// Folders the user picked (the library in iCloud Drive or Dropbox, places to save exports). iOS
// lets the app use them while it holds a security-scoped URL; bookmarks bring them back at the
// next launch, possibly at a new path, which the page uses to update saved paths.

import Foundation

final class Folders {
    static let shared = Folders()

    private struct Saved: Codable {
        var path: String
        var bookmark: Data
    }

    private let key = "FolioDome.folders"
    private let lock = NSLock()
    private var active: [String: URL] = [:]
    private(set) var moved: [(path: String, previousPath: String)] = []

    /** Paths of the folders in use. */
    var roots: [String] {
        lock.lock()
        defer { lock.unlock() }
        return Array(active.keys)
    }

    private func load() -> [Saved] {
        guard let data = UserDefaults.standard.data(forKey: key) else { return [] }
        return (try? JSONDecoder().decode([Saved].self, from: data)) ?? []
    }

    private func save(_ list: [Saved]) {
        if let data = try? JSONEncoder().encode(list) { UserDefaults.standard.set(data, forKey: key) }
    }

    /** Opens the folders picked before (once, at launch). */
    func restore() {
        var kept: [Saved] = []
        for saved in load() {
            var stale = false
            guard let url = try? URL(resolvingBookmarkData: saved.bookmark, options: [], relativeTo: nil, bookmarkDataIsStale: &stale) else { continue }
            guard url.startAccessingSecurityScopedResource() else { continue }
            lock.lock()
            active[url.path] = url
            lock.unlock()
            var entry = saved
            if url.path != saved.path { moved.append((url.path, saved.path)) }
            entry.path = url.path
            if stale, let fresh = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) { entry.bookmark = fresh }
            kept.append(entry)
        }
        save(kept)
    }

    /** Starts using a folder from the document picker and remembers it (the twelve most recent are kept). */
    func add(_ url: URL) {
        let accessing = url.startAccessingSecurityScopedResource()
        lock.lock()
        if accessing || active[url.path] == nil { active[url.path] = url }
        lock.unlock()
        guard let bookmark = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) else { return }
        var list = load().filter { $0.path != url.path }
        list.insert(Saved(path: url.path, bookmark: bookmark), at: 0)
        if list.count > 12 {
            for old in list[12...] {
                lock.lock()
                if let u = active.removeValue(forKey: old.path) { u.stopAccessingSecurityScopedResource() }
                lock.unlock()
            }
            list = Array(list.prefix(12))
        }
        save(list)
    }
}

/** The app's bundled web folder (Resources/web). */
enum Resources {
    static let web: URL = {
        let fm = FileManager.default
        let main = Bundle.main
        if let u = main.url(forResource: "web", withExtension: nil) { return u }
        // As a Swift package, resources are in a bundle inside the app ("Folio Dome_AppModule.bundle").
        var places = [main.bundleURL]
        if let r = main.resourceURL { places.append(r) }
        for place in places {
            let items = (try? fm.contentsOfDirectory(at: place, includingPropertiesForKeys: nil)) ?? []
            for bundle in items where bundle.pathExtension == "bundle" {
                for candidate in [bundle.appendingPathComponent("web"), bundle.appendingPathComponent("Resources/web")] where fm.fileExists(atPath: candidate.path) {
                    return candidate
                }
            }
        }
        for bundle in Bundle.allBundles {
            if let u = bundle.url(forResource: "web", withExtension: nil) { return u }
        }
        return main.bundleURL.appendingPathComponent("web")
    }()

    static var renderer: URL { web.appendingPathComponent("renderer") }

    static let version: String = {
        struct V: Decodable { let version: String }
        if let data = try? Data(contentsOf: web.appendingPathComponent("version.json")), let v = try? JSONDecoder().decode(V.self, from: data) { return v.version }
        return (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "0"
    }()
}

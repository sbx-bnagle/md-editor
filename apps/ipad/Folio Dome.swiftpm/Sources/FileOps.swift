// File access for the backend (apps/ipad/src/shims/fs.ts), with Node's error codes.
//
// Requests may touch the app's container, the app's own files (read only), and folders the user
// picked (Folders.swift). Contents are read and written with file coordination, as Apple asks
// for files in iCloud Drive and other providers' folders; reading an iCloud Drive file that is
// not on the iPad yet downloads it first.

import Foundation
import UIKit
import UniformTypeIdentifiers

/** stat(2). (Inside FileOps the name means its own stat, and Darwin.stat names the struct.) */
private func posixStat(_ path: String, _ st: inout stat) -> Int32 {
    stat(path, &st)
}

enum FileOps {
    // MARK: Errors

    private static let errnoNames: [Int32: String] = [
        EPERM: "EPERM", ENOENT: "ENOENT", EIO: "EIO", EBADF: "EBADF", EACCES: "EACCES", EBUSY: "EBUSY", EEXIST: "EEXIST",
        EXDEV: "EXDEV", ENOTDIR: "ENOTDIR", EISDIR: "EISDIR", EINVAL: "EINVAL", ENOSPC: "ENOSPC", EROFS: "EROFS",
        ENAMETOOLONG: "ENAMETOOLONG", ENOTEMPTY: "ENOTEMPTY", ELOOP: "ELOOP", ENOATTR: "ENOATTR", EDEADLK: "EDEADLK",
    ]

    /** An error in Node's form: "ENOENT: no such file or directory, open '/path'". */
    static func posixError(_ code: Int32, _ syscall: String, _ path: String) -> BridgeError {
        let name = errnoNames[code] ?? "E\(code)"
        return BridgeError("\(name): \(String(cString: strerror(code))), \(syscall) '\(path)'", code: name)
    }

    static func lastError(_ syscall: String, _ path: String) -> BridgeError {
        posixError(errno, syscall, path)
    }

    /** Foundation errors as POSIX ones. */
    static func mapped(_ error: Error, _ syscall: String, _ path: String) -> BridgeError {
        if let e = error as? BridgeError { return e }
        let ns = error as NSError
        if ns.domain == NSPOSIXErrorDomain { return posixError(Int32(ns.code), syscall, path) }
        if let underlying = ns.userInfo[NSUnderlyingErrorKey] as? NSError, underlying.domain == NSPOSIXErrorDomain {
            return posixError(Int32(underlying.code), syscall, path)
        }
        if ns.domain == NSCocoaErrorDomain {
            switch ns.code {
            case NSFileNoSuchFileError, NSFileReadNoSuchFileError: return posixError(ENOENT, syscall, path)
            case NSFileWriteFileExistsError: return posixError(EEXIST, syscall, path)
            case NSFileReadNoPermissionError, NSFileWriteNoPermissionError: return posixError(EACCES, syscall, path)
            case NSFileWriteOutOfSpaceError: return posixError(ENOSPC, syscall, path)
            case NSFileWriteVolumeReadOnlyError: return posixError(EROFS, syscall, path)
            default: break
            }
        }
        return BridgeError("\(syscall) '\(path)': \(ns.localizedDescription)", code: "EIO")
    }

    // MARK: Where requests may go

    /** The path with symbolic links resolved as far as it exists (/var is /private/var on iOS). */
    static func canonical(_ path: String) -> String {
        var existing = (path as NSString).standardizingPath
        var rest: [String] = []
        while !existing.isEmpty && existing != "/" && access(existing, F_OK) != 0 {
            rest.insert((existing as NSString).lastPathComponent, at: 0)
            existing = (existing as NSString).deletingLastPathComponent
        }
        var base = existing
        if let real = Darwin.realpath(existing, nil) {
            base = String(cString: real)
            free(real)
        }
        return rest.reduce(base) { ($0 as NSString).appendingPathComponent($1) }
    }

    private static func isInside(_ path: String, _ root: String) -> Bool {
        path == root || path.hasPrefix(root.hasSuffix("/") ? root : root + "/")
    }

    enum Access { case read, write }

    /** Refuses paths outside the places the app may use. */
    @discardableResult
    static func check(_ path: String, _ access: Access, _ syscall: String) throws -> URL {
        guard path.hasPrefix("/") else { throw BridgeError("EINVAL: not an absolute path, \(syscall) '\(path)'", code: "EINVAL") }
        let real = canonical(path)
        var roots = [canonical(NSHomeDirectory())] + Folders.shared.roots.map(canonical)
        if access == .read { roots.append(canonical(Resources.web.path)) }
        guard roots.contains(where: { isInside(real, $0) }) else {
            throw BridgeError("EACCES: permission denied (outside the folders Folio Dome may use), \(syscall) '\(path)'", code: "EACCES")
        }
        return URL(fileURLWithPath: path)
    }

    static func supportDirectory() throws -> String {
        let url = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        return url.path
    }

    // MARK: Coordination

    static func coordinateRead<T>(_ url: URL, _ syscall: String, _ body: (URL) throws -> T) throws -> T {
        var coordinationError: NSError?
        var result: Result<T, Error> = .failure(posixError(ENOENT, syscall, url.path))
        NSFileCoordinator(filePresenter: Watchers.shared.presenter(for: url)).coordinate(readingItemAt: url, options: [], error: &coordinationError) { u in
            result = Result { try body(u) }
        }
        if let e = coordinationError { throw mapped(e, syscall, url.path) }
        return try result.get()
    }

    static func coordinateWrite<T>(_ url: URL, _ options: NSFileCoordinator.WritingOptions, _ syscall: String, _ body: (URL) throws -> T) throws -> T {
        var coordinationError: NSError?
        var result: Result<T, Error> = .failure(posixError(EIO, syscall, url.path))
        NSFileCoordinator(filePresenter: Watchers.shared.presenter(for: url)).coordinate(writingItemAt: url, options: options, error: &coordinationError) { u in
            result = Result { try body(u) }
        }
        if let e = coordinationError { throw mapped(e, syscall, url.path) }
        return try result.get()
    }

    // MARK: iCloud Drive placeholders

    /** "Name" for an iCloud Drive placeholder ".Name.icloud" (a file not downloaded yet), else nil. */
    private static func placeholderTarget(_ name: String) -> String? {
        guard name.hasPrefix("."), name.hasSuffix(".icloud"), name.count > 8 else { return nil }
        return String(name.dropFirst().dropLast(7))
    }

    private static func placeholderPath(for path: String) -> String {
        let dir = (path as NSString).deletingLastPathComponent
        return (dir as NSString).appendingPathComponent(".\((path as NSString).lastPathComponent).icloud")
    }

    private static func startDownloading(_ path: String) {
        try? FileManager.default.startDownloadingUbiquitousItem(at: URL(fileURLWithPath: path))
    }

    // MARK: Operations

    private static func statInfo(_ st: Darwin.stat) -> [String: Any] {
        let type: String
        switch st.st_mode & S_IFMT {
        case S_IFDIR: type = "dir"
        case S_IFREG: type = "file"
        case S_IFLNK: type = "link"
        default: type = "other"
        }
        func ms(_ t: timespec) -> Double { Double(t.tv_sec) * 1000 + Double(t.tv_nsec) / 1_000_000 }
        return [
            "type": type,
            "size": Double(st.st_size),
            "mtimeMs": ms(st.st_mtimespec),
            "ctimeMs": ms(st.st_ctimespec),
            "birthtimeMs": ms(st.st_birthtimespec),
            "mode": Int(st.st_mode),
            "ino": Double(st.st_ino),
            "dev": Int(st.st_dev),
        ]
    }

    static func stat(_ path: String, follow: Bool) throws -> [String: Any] {
        try check(path, .read, follow ? "stat" : "lstat")
        var st = Darwin.stat()
        let r = follow ? posixStat(path, &st) : Darwin.lstat(path, &st)
        if r == 0 { return statInfo(st) }
        let err = errno
        // A file in iCloud Drive that is not downloaded yet: report it as a file and start fetching it.
        if err == ENOENT, Darwin.lstat(placeholderPath(for: path), &st) == 0 {
            startDownloading(path)
            var info = statInfo(st)
            info["type"] = "file"
            if let values = try? URL(fileURLWithPath: path).resourceValues(forKeys: [.fileSizeKey]), let size = values.fileSize {
                info["size"] = Double(size)
            }
            return info
        }
        throw posixError(err, follow ? "stat" : "lstat", path)
    }

    static func readdir(_ path: String) throws -> [[String: String]] {
        try check(path, .read, "scandir")
        let names: [String]
        do {
            names = try FileManager.default.contentsOfDirectory(atPath: path)
        } catch {
            var st = Darwin.stat()
            if posixStat(path, &st) == 0 && (st.st_mode & S_IFMT) != S_IFDIR { throw posixError(ENOTDIR, "scandir", path) }
            throw mapped(error, "scandir", path)
        }
        var seen = Set(names)
        var out: [[String: String]] = []
        for name in names {
            if let target = placeholderTarget(name) {
                if seen.contains(target) { continue }
                seen.insert(target)
                startDownloading((path as NSString).appendingPathComponent(target))
                out.append(["name": target, "type": "file"])
                continue
            }
            var st = Darwin.stat()
            let full = (path as NSString).appendingPathComponent(name)
            let type: String
            if Darwin.lstat(full, &st) == 0 {
                switch st.st_mode & S_IFMT {
                case S_IFDIR: type = "dir"
                case S_IFREG: type = "file"
                case S_IFLNK: type = "link"
                default: type = "other"
                }
            } else {
                type = "other"
            }
            out.append(["name": name, "type": type])
        }
        return out
    }

    static func read(_ path: String, encoding: String, offset: Int?, length: Int?) throws -> String {
        let url = try check(path, .read, "open")
        let data: Data = try coordinateRead(url, "open") { u in
            var st = Darwin.stat()
            if posixStat(u.path, &st) != 0 { throw lastError("open", path) }
            if (st.st_mode & S_IFMT) == S_IFDIR { throw posixError(EISDIR, "read", path) }
            if let offset, let length {
                let handle = try FileHandle(forReadingFrom: u)
                defer { try? handle.close() }
                try handle.seek(toOffset: UInt64(offset))
                return try handle.read(upToCount: length) ?? Data()
            }
            return try Data(contentsOf: u)
        }
        if encoding == "utf8" { return String(decoding: data, as: UTF8.self) }
        return data.base64EncodedString()
    }

    static func write(_ path: String, data text: String, encoding: String, flag: String) throws {
        let url = try check(path, .write, "open")
        let data: Data
        if encoding == "utf8" {
            data = Data(text.utf8)
        } else {
            guard let d = Data(base64Encoded: text) else { throw BridgeError("EINVAL: bad data, write '\(path)'", code: "EINVAL") }
            data = d
        }
        var st = Darwin.stat()
        let dir = (path as NSString).deletingLastPathComponent
        if posixStat(dir, &st) != 0 { throw posixError(ENOENT, "open", path) }
        if flag == "wx", Darwin.lstat(path, &st) == 0 { throw posixError(EEXIST, "open", path) }
        try coordinateWrite(url, flag == "a" ? .forMerging : .forReplacing, "write") { u in
            if flag == "a", FileManager.default.fileExists(atPath: u.path) {
                let handle = try FileHandle(forWritingTo: u)
                defer { try? handle.close() }
                try handle.seekToEnd()
                try handle.write(contentsOf: data)
            } else {
                do {
                    try data.write(to: u, options: flag == "wx" ? [.withoutOverwriting] : [])
                } catch {
                    throw mapped(error, "open", path)
                }
            }
        }
    }

    static func mkdir(_ path: String, recursive: Bool) throws {
        try check(path, .write, "mkdir")
        if recursive {
            var st = Darwin.stat()
            if posixStat(path, &st) == 0 {
                if (st.st_mode & S_IFMT) == S_IFDIR { return }
                throw posixError(EEXIST, "mkdir", path)
            }
            do {
                try FileManager.default.createDirectory(atPath: path, withIntermediateDirectories: true)
            } catch {
                throw mapped(error, "mkdir", path)
            }
        } else if Darwin.mkdir(path, 0o755) != 0 {
            throw lastError("mkdir", path)
        }
    }

    static func rename(_ from: String, _ to: String) throws {
        let src = try check(from, .write, "rename")
        let dst = try check(to, .write, "rename")
        var coordinationError: NSError?
        var failure: BridgeError?
        let coordinator = NSFileCoordinator(filePresenter: Watchers.shared.presenter(for: src))
        coordinator.coordinate(writingItemAt: src, options: .forMoving, writingItemAt: dst, options: .forReplacing, error: &coordinationError) { s, d in
            if Darwin.rename(s.path, d.path) != 0 {
                failure = lastError("rename", from)
            } else {
                coordinator.item(at: s, didMoveTo: d)
            }
        }
        if let e = coordinationError { throw mapped(e, "rename", from) }
        if let failure { throw failure }
    }

    static func rm(_ path: String, recursive: Bool, force: Bool) throws {
        let url = try check(path, .write, "rm")
        var st = Darwin.stat()
        if Darwin.lstat(path, &st) != 0 {
            if force && errno == ENOENT { return }
            throw lastError("rm", path)
        }
        if (st.st_mode & S_IFMT) == S_IFDIR && !recursive { throw posixError(EISDIR, "rm", path) }
        try coordinateWrite(url, .forDeleting, "rm") { u in
            do {
                try FileManager.default.removeItem(at: u)
            } catch {
                throw mapped(error, "rm", path)
            }
        }
    }

    static func copy(_ from: String, _ to: String) throws {
        let src = try check(from, .read, "copyfile")
        let dst = try check(to, .write, "copyfile")
        let data: Data = try coordinateRead(src, "copyfile") { u in
            do {
                return try Data(contentsOf: u)
            } catch {
                throw mapped(error, "copyfile", from)
            }
        }
        try coordinateWrite(dst, .forReplacing, "copyfile") { u in
            do {
                try data.write(to: u)
            } catch {
                throw mapped(error, "copyfile", to)
            }
        }
    }

    static func realpath(_ path: String) throws -> String {
        try check(path, .read, "realpath")
        guard let real = Darwin.realpath(path, nil) else { throw lastError("realpath", path) }
        defer { free(real) }
        return String(cString: real)
    }

    static func truncate(_ path: String, length: Int) throws {
        try check(path, .write, "truncate")
        if Darwin.truncate(path, off_t(length)) != 0 { throw lastError("truncate", path) }
    }

    static func chmod(_ path: String, mode: Int) throws {
        try check(path, .write, "chmod")
        // Files from other providers may not take permissions; that is not worth failing a save for.
        _ = Darwin.chmod(path, mode_t(mode & 0o7777))
    }

    static func getXattr(_ path: String, name: String) throws -> String? {
        try check(path, .read, "getxattr")
        let size = getxattr(path, name, nil, 0, 0, 0)
        if size < 0 {
            if errno == ENOATTR || errno == ENOTSUP { return nil }
            throw lastError("getxattr", path)
        }
        var buffer = Data(count: size)
        let read = buffer.withUnsafeMutableBytes { getxattr(path, name, $0.baseAddress, size, 0, 0) }
        if read < 0 { throw lastError("getxattr", path) }
        return buffer.prefix(read).base64EncodedString()
    }

    static func setXattr(_ path: String, name: String, base64: String?) throws {
        try check(path, .write, "setxattr")
        guard let base64 else {
            if removexattr(path, name, 0) != 0 && errno != ENOATTR { throw lastError("removexattr", path) }
            return
        }
        guard let data = Data(base64Encoded: base64) else { throw BridgeError("EINVAL: bad attribute value", code: "EINVAL") }
        let r = data.withUnsafeBytes { setxattr(path, name, $0.baseAddress, data.count, 0, 0) }
        if r != 0 && errno != ENOTSUP { throw lastError("setxattr", path) }
    }

    /** Moves an item to Recently Deleted (the Files app's Trash). */
    static func trash(_ path: String) throws {
        let url = try check(path, .write, "trash")
        try coordinateWrite(url, .forDeleting, "trash") { u in
            do {
                try FileManager.default.trashItem(at: u, resultingItemURL: nil)
            } catch {
                throw BridgeError("“\(u.lastPathComponent)” could not be moved to Recently Deleted (\(error.localizedDescription)). You can delete it in the Files app.")
            }
        }
    }

    /** Opens the Files app at the item's folder. */
    @MainActor
    static func reveal(_ path: String) throws {
        var st = Darwin.stat()
        let isDir = posixStat(path, &st) == 0 && (st.st_mode & S_IFMT) == S_IFDIR
        let folder = isDir ? path : (path as NSString).deletingLastPathComponent
        var components = URLComponents()
        components.scheme = "shareddocuments"
        components.path = folder
        guard let url = components.url else { throw BridgeError("Could not open the Files app.") }
        UIApplication.shared.open(url)
    }
}

// Dialogs: confirmations, and the Files app's pickers in place of the Mac's open and save panels.

import UIKit
import UniformTypeIdentifiers

@MainActor
enum Pickers {
    private static var lastSaveFolder: URL? {
        get { UserDefaults.standard.url(forKey: "FolioDome.lastSaveFolder") }
        set { UserDefaults.standard.set(newValue, forKey: "FolioDome.lastSaveFolder") }
    }

    static func confirm(from presenter: UIViewController, message: String, detail: String, ok: String) async -> Bool {
        await withCheckedContinuation { continuation in
            let alert = UIAlertController(title: message, message: detail.isEmpty ? nil : detail, preferredStyle: .alert)
            let destructive = ["Delete", "Trash", "Clear", "Without Saving", "Replace"].contains { ok.contains($0) }
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in continuation.resume(returning: false) })
            alert.addAction(UIAlertAction(title: ok, style: destructive ? .destructive : .default) { _ in continuation.resume(returning: true) })
            presenter.present(alert, animated: true)
        }
    }

    /** A folder, which the app may then use (now and after a restart). */
    static func chooseFolder(from presenter: UIViewController, title: String, startAt: URL? = nil) async -> String? {
        let urls = await pick(from: presenter, types: [.folder], asCopy: false, multiple: false, startAt: startAt)
        guard let url = urls.first else { return nil }
        Folders.shared.add(url)
        return url.path
    }

    /** Files to bring in (copies, in the app's temporary folder; the backend copies them into the library). */
    static func chooseFiles(from presenter: UIViewController, title: String, extensions: [String]) async -> [String] {
        let types = extensions.compactMap { UTType(filenameExtension: $0) }
        let urls = await pick(from: presenter, types: types.isEmpty ? [.item] : types, asCopy: true, multiple: true, startAt: nil)
        return urls.map(\.path)
    }

    /** Where to save an export: the Mac asks for a file name and folder; here the folder is picked and the name is kept. */
    static func chooseSavePath(from presenter: UIViewController, title: String, name: String, extensions: [String]) async -> String? {
        guard let folder = await chooseFolder(from: presenter, title: title, startAt: lastSaveFolder) else { return nil }
        lastSaveFolder = URL(fileURLWithPath: folder)
        let path = (folder as NSString).appendingPathComponent(name)
        if FileManager.default.fileExists(atPath: path) {
            let replace = await confirm(from: presenter, message: "“\(name)” already exists in that folder. Replace it?", detail: "", ok: "Replace")
            if !replace { return nil }
        }
        return path
    }

    private static var delegates: [PickerDelegate] = []

    private static func pick(from presenter: UIViewController, types: [UTType], asCopy: Bool, multiple: Bool, startAt: URL?) async -> [URL] {
        await withCheckedContinuation { continuation in
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: asCopy)
            picker.allowsMultipleSelection = multiple
            if let startAt { picker.directoryURL = startAt }
            let delegate = PickerDelegate { urls in
                continuation.resume(returning: urls)
            }
            delegates.append(delegate)
            delegate.done = { [weak delegate] in
                delegates.removeAll { $0 === delegate }
            }
            picker.delegate = delegate
            presenter.present(picker, animated: true)
        }
    }
}

private final class PickerDelegate: NSObject, UIDocumentPickerDelegate {
    private var finish: (([URL]) -> Void)?
    var done: (() -> Void)?

    init(finish: @escaping ([URL]) -> Void) {
        self.finish = finish
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        finish?(urls)
        finish = nil
        done?()
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        finish?([])
        finish = nil
        done?()
    }
}

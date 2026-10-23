// Folio Dome for iPad. The app is one web view running the same UI as the Mac app, with the
// backend in the page (apps/ipad/src); this shell supplies what a web page cannot do itself.

import SwiftUI
import UIKit

@main
struct FolioDomeApp: App {
    var body: some Scene {
        WindowGroup {
            WebContainer()
                .ignoresSafeArea(.container, edges: .bottom)
                .background(Color(red: 0x1a / 255, green: 0x1b / 255, blue: 0x1d / 255))
                .preferredColorScheme(.dark)
        }
        .commands {
            FolioCommands()
        }
    }
}

/** Hosts the one web view. A second window shows a note instead: two copies would write the same files. */
struct WebContainer: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> UIViewController {
        WebViewController.claim() ?? OtherWindowController()
    }

    func updateUIViewController(_ controller: UIViewController, context: Context) {}
}

final class OtherWindowController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0x1a / 255, green: 0x1b / 255, blue: 0x1d / 255, alpha: 1)
        let label = UILabel()
        label.text = "Folio Dome is open in another window."
        label.textColor = .secondaryLabel
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
        ])
    }
}

/** The menu bar (iPadOS 26) and the ⌘ menus, built from the Mac app's menus (MenuSpec.swift). */
struct FolioCommands: Commands {
    var body: some Commands {
        CommandGroup(replacing: .appSettings) {
            Button("Settings…") { send("settings") }
        }
        CommandGroup(replacing: .newItem) { MenuItems(items: MenuSpec.file) }
        CommandGroup(after: .textEditing) { MenuItems(items: MenuSpec.edit) }
        CommandGroup(replacing: .textFormatting) { MenuItems(items: MenuSpec.format) }
        CommandGroup(after: .sidebar) { MenuItems(items: MenuSpec.view) }
        CommandMenu("Assistant") { MenuItems(items: MenuSpec.assistant) }
        CommandMenu("History") { MenuItems(items: MenuSpec.history) }
        CommandGroup(after: .windowArrangement) { MenuItems(items: MenuSpec.window) }
    }
}

struct MenuItems: View {
    let items: [MenuSpec.Item]

    var body: some View {
        ForEach(Array(items.enumerated()), id: \.offset) { _, item in
            if let command = item.command {
                Button(item.label) { send(command) }
            } else {
                Divider()
            }
        }
    }
}

/** Runs a menu command in the UI (the same event the Mac app's menu sends). */
func send(_ command: String) {
    Task { @MainActor in
        WebViewController.current?.dispatch(["type": "menu", "command": command])
    }
}

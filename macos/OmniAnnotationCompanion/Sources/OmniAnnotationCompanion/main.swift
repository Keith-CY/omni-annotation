import AppKit
import OmniAnnotationCore

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem?
    private var selectedColor: AnnotationColor = .yellow
    private var actionController: CompanionActionController?
    private var selectionPopover: SelectionPopoverController?
    private let loginItemController = LoginItemController()

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)

        let selectionReader = AccessibilitySelectionReader()
        let pasteboard = PasteboardController()
        let chromeBridge = AppleScriptChromeBridge()
        let store = (try? JSONLinesExcerptStore()) ?? JSONLinesExcerptStore(
            fileURL: FileManager.default.temporaryDirectory.appendingPathComponent("omni-annotation-system-excerpts.jsonl")
        )
        let router = OmniActionRouter(chromeBridge: chromeBridge, excerptStore: store)
        actionController = CompanionActionController(
            selectionReader: selectionReader,
            pasteboard: pasteboard,
            router: router,
            appleNotes: AppleNotesController()
        )
        if let actionController {
            selectionPopover = SelectionPopoverController(
                selectionReader: selectionReader,
                actionController: actionController,
                getColor: { [weak self] in self?.selectedColor ?? .yellow },
                setColor: { [weak self] color in
                    self?.selectedColor = color
                    self?.statusItem?.menu = self?.buildMenu()
                }
            )
            selectionPopover?.start()
        }

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem?.button?.title = "Omni"
        statusItem?.menu = buildMenu()
    }

    private func buildMenu() -> NSMenu {
        let menu = NSMenu()
        menu.addItem(menuItem("Copy", action: #selector(copySelection)))
        menu.addItem(menuItem("Paste", action: #selector(paste)))
        menu.addItem(menuItem("Paste Without Style", action: #selector(pasteWithoutStyle)))
        menu.addItem(.separator())
        menu.addItem(menuItem("Translate", action: #selector(translateSelection)))
        menu.addItem(menuItem("New Apple Note", action: #selector(createAppleNote)))
        menu.addItem(menuItem("Note", action: #selector(createNote)))
        menu.addItem(menuItem("Highlight", action: #selector(highlightSelection)))
        menu.addItem(menuItem("Sentence", action: #selector(sentenceSelection)))
        menu.addItem(.separator())
        menu.addItem(colorMenu())
        menu.addItem(.separator())
        menu.addItem(startAtLoginMenuItem())
        menu.addItem(menuItem("Request Accessibility Permission", action: #selector(requestAccessibility)))
        menu.addItem(menuItem("Quit", action: #selector(quit)))
        return menu
    }

    private func startAtLoginMenuItem() -> NSMenuItem {
        let state = LoginItemMenuState(isEnabled: loginItemController.isEnabled)
        let item = menuItem(state.title, action: #selector(toggleStartAtLogin))
        item.state = state.menuState == "on" ? .on : .off
        return item
    }

    private func colorMenu() -> NSMenuItem {
        let item = NSMenuItem(title: "Color", action: nil, keyEquivalent: "")
        let submenu = NSMenu()
        for color in AnnotationColor.allCases {
            let colorItem = NSMenuItem(title: color.rawValue.capitalized, action: #selector(setColor(_:)), keyEquivalent: "")
            colorItem.target = self
            colorItem.representedObject = color.rawValue
            colorItem.state = color == selectedColor ? .on : .off
            submenu.addItem(colorItem)
        }
        item.submenu = submenu
        return item
    }

    private func menuItem(_ title: String, action: Selector) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
        item.target = self
        return item
    }

    @objc private func copySelection() {
        Task { await performPasteboardAction(.copy) }
    }

    @objc private func paste() {
        Task { await performPasteboardAction(.paste) }
    }

    @objc private func pasteWithoutStyle() {
        Task { await performPasteboardAction(.pasteWithoutStyle) }
    }

    @objc private func translateSelection() {
        Task { await performAnnotationAction(.translate) }
    }

    @objc private func createAppleNote() {
        Task { await performAnnotationAction(.appleNote) }
    }

    @objc private func createNote() {
        Task { await performAnnotationAction(.note) }
    }

    @objc private func highlightSelection() {
        Task { await performAnnotationAction(.highlight) }
    }

    @objc private func sentenceSelection() {
        Task { await performAnnotationAction(.sentence) }
    }

    @objc private func setColor(_ sender: NSMenuItem) {
        guard let rawValue = sender.representedObject as? String,
              let color = AnnotationColor(rawValue: rawValue)
        else {
            return
        }
        selectedColor = color
        statusItem?.menu = buildMenu()
    }

    @objc private func requestAccessibility() {
        AccessibilityPermission.request()
    }

    @objc private func toggleStartAtLogin() {
        do {
            try loginItemController.setEnabled(!loginItemController.isEnabled)
            statusItem?.menu = buildMenu()
        } catch {
            presentError(error)
        }
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }

    private func performPasteboardAction(_ action: OmniAction) async {
        do {
            try await actionController?.performPasteboardAction(action)
        } catch {
            presentError(error)
        }
    }

    private func performAnnotationAction(_ action: OmniAction) async {
        do {
            try await actionController?.performAnnotationAction(action, color: selectedColor)
        } catch {
            presentError(error)
        }
    }

    private func presentError(_ error: Error) {
        DispatchQueue.main.async {
            let alert = NSAlert(error: error)
            alert.runModal()
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()

import AppKit

protocol PasteboardControlling {
    func copy(_ text: String)
    func paste()
    func pasteWithoutStyle()
}

final class PasteboardController: PasteboardControlling {
    func copy(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }

    func paste() {
        sendKeystroke("v")
    }

    func pasteWithoutStyle() {
        if let text = NSPasteboard.general.string(forType: .string) {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text, forType: .string)
        }
        sendKeystroke("v")
    }

    private func sendKeystroke(_ key: String) {
        let source = CGEventSource(stateID: .combinedSessionState)
        let keyCode = key == "v" ? CGKeyCode(9) : CGKeyCode(0)
        let down = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: true)
        let up = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: false)
        down?.flags = .maskCommand
        up?.flags = .maskCommand
        down?.post(tap: .cghidEventTap)
        up?.post(tap: .cghidEventTap)
    }
}

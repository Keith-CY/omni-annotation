import AppKit
import ApplicationServices
import OmniAnnotationCore

protocol SelectionReading {
    func currentSelection() -> SystemSelection?
}

enum AccessibilityPermission {
    static func request() {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(options)
    }
}

final class AccessibilitySelectionReader: SelectionReading {
    func currentSelection() -> SystemSelection? {
        guard let app = NSWorkspace.shared.frontmostApplication,
              let pid = app.processIdentifier as pid_t?,
              let text = selectedText(pid: pid)
        else {
            return nil
        }

        return SystemSelection(
            text: text,
            contextBefore: "",
            contextAfter: "",
            appName: app.localizedName ?? app.bundleIdentifier ?? "Unknown App",
            bundleIdentifier: app.bundleIdentifier ?? "",
            windowTitle: windowTitle(pid: pid) ?? ""
        )
    }

    private func selectedText(pid: pid_t) -> String? {
        let appElement = AXUIElementCreateApplication(pid)
        guard let focused = focusedElement(in: appElement) else {
            return nil
        }

        var value: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(focused, kAXSelectedTextAttribute as CFString, &value)
        guard result == .success else {
            return nil
        }
        return value as? String
    }

    private func focusedElement(in appElement: AXUIElement) -> AXUIElement? {
        var value: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(appElement, kAXFocusedUIElementAttribute as CFString, &value)
        guard result == .success else {
            return nil
        }
        return value.map { $0 as! AXUIElement }
    }

    private func windowTitle(pid: pid_t) -> String? {
        let appElement = AXUIElementCreateApplication(pid)
        var value: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(appElement, kAXFocusedWindowAttribute as CFString, &value)
        guard result == .success, let window = value else {
            return nil
        }

        var title: CFTypeRef?
        let titleResult = AXUIElementCopyAttributeValue((window as! AXUIElement), kAXTitleAttribute as CFString, &title)
        guard titleResult == .success else {
            return nil
        }
        return title as? String
    }
}

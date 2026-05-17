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
              let focused = focusedElement(pid: pid),
              let text = selectedText(in: focused)
        else {
            return nil
        }

        return SystemSelection(
            text: text,
            contextBefore: "",
            contextAfter: "",
            appName: app.localizedName ?? app.bundleIdentifier ?? "Unknown App",
            bundleIdentifier: app.bundleIdentifier ?? "",
            windowTitle: windowTitle(pid: pid) ?? "",
            screenBounds: selectedTextScreenBounds(in: focused)
        )
    }

    private func focusedElement(pid: pid_t) -> AXUIElement? {
        let appElement = AXUIElementCreateApplication(pid)
        return focusedElement(in: appElement)
    }

    private func selectedText(in focused: AXUIElement) -> String? {
        var value: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(focused, kAXSelectedTextAttribute as CFString, &value)
        guard result == .success else {
            return nil
        }
        return value as? String
    }

    private func selectedTextScreenBounds(in focused: AXUIElement) -> ScreenBounds? {
        guard let selectedRange = selectedTextRange(in: focused) else {
            return nil
        }

        var boundsValue: CFTypeRef?
        let result = AXUIElementCopyParameterizedAttributeValue(
            focused,
            kAXBoundsForRangeParameterizedAttribute as CFString,
            selectedRange,
            &boundsValue
        )
        guard result == .success, let boundsValue else {
            return nil
        }

        var rect = CGRect.zero
        guard AXValueGetType(boundsValue as! AXValue) == .cgRect,
              AXValueGetValue(boundsValue as! AXValue, .cgRect, &rect),
              rect.width > 0,
              rect.height > 0
        else {
            return nil
        }

        let appKitRect = convertAccessibilityRectToAppKitScreenRect(rect)
        return ScreenBounds(
            x: Double(appKitRect.minX),
            y: Double(appKitRect.minY),
            width: Double(appKitRect.width),
            height: Double(appKitRect.height)
        )
    }

    private func selectedTextRange(in focused: AXUIElement) -> AXValue? {
        var rangeValue: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(focused, kAXSelectedTextRangeAttribute as CFString, &rangeValue)
        guard result == .success, let rangeValue else {
            return nil
        }

        let value = rangeValue as! AXValue
        guard AXValueGetType(value) == .cfRange else {
            return nil
        }
        return value
    }

    private func convertAccessibilityRectToAppKitScreenRect(_ rect: CGRect) -> CGRect {
        let screenMaxY = NSScreen.screens.map(\.frame.maxY).max() ?? NSScreen.main?.frame.maxY ?? 0
        return CGRect(x: rect.minX, y: screenMaxY - rect.maxY, width: rect.width, height: rect.height)
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

import Foundation

public enum AppleNotesScriptBuilder {
    public static func script(for selection: SystemSelection) -> String {
        let title = noteTitle(for: selection)
        let body = """
        <h1>\(escapeHTML(title))</h1>
        <blockquote>\(escapeHTML(selection.text).replacingOccurrences(of: "\n", with: "<br>"))</blockquote>
        <p><strong>Source:</strong> \(escapeHTML(selection.appName))</p>
        <p><strong>Window:</strong> \(escapeHTML(selection.windowTitle))</p>
        """

        return """
        tell application "Notes"
          activate
          set targetFolder to default folder of default account
          set createdNote to make new note at targetFolder with properties {name:"\(escapeAppleScript(title))", body:"\(escapeAppleScript(body))"}
          show createdNote
        end tell
        """
    }

    private static func noteTitle(for selection: SystemSelection) -> String {
        let trimmed = selection.text
            .replacingOccurrences(of: "\n", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            return "Omni Annotation"
        }
        return String(trimmed.prefix(64))
    }

    private static func escapeHTML(_ value: String) -> String {
        value
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
    }

    private static func escapeAppleScript(_ value: String) -> String {
        value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
    }
}

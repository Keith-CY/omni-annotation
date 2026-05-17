import Foundation

public struct ChromeBridgeCommand: Equatable, Sendable {
    public var action: OmniAction
    public var color: AnnotationColor

    public init(action: OmniAction, color: AnnotationColor) {
        self.action = action
        self.color = color
    }
}

public enum ChromeBridgeScriptBuilder {
    public static func script(for command: ChromeBridgeCommand) -> String {
        let payload = ChromeBridgePayload(action: contentAction(for: command.action), color: command.color.rawValue)
        let data = (try? JSONEncoder().encode(payload)) ?? Data()
        let json = String(data: data, encoding: .utf8) ?? "{}"
        return """
        window.dispatchEvent(new CustomEvent("omni-annotation-native-action", { detail: \(json) }));
        """
    }

    private static func contentAction(for action: OmniAction) -> String {
        switch action {
        case .highlight:
            return "highlight"
        case .sentence:
            return "sentence-highlight"
        case .stickyNote:
            return "sticky-note"
        case .screenshot:
            return "screenshot"
        case .note:
            return "highlight"
        case .appleNote:
            return "apple-note"
        case .copy, .paste, .pasteWithoutStyle, .translate:
            return action.rawValue
        }
    }
}

private struct ChromeBridgePayload: Encodable {
    var action: String
    var color: String
}

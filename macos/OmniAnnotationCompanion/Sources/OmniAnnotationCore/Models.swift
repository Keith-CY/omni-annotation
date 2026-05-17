import Foundation

public enum AnnotationColor: String, Codable, CaseIterable, Sendable {
    case yellow
    case green
    case pink
    case purple
    case cyan
}

public enum OmniAction: String, Sendable {
    case copy
    case paste
    case pasteWithoutStyle
    case translate
    case appleNote
    case note
    case highlight
    case sentence
    case stickyNote
    case screenshot
}

public struct SystemSelection: Codable, Equatable, Sendable {
    public var text: String
    public var contextBefore: String
    public var contextAfter: String
    public var appName: String
    public var bundleIdentifier: String
    public var windowTitle: String
    public var screenBounds: ScreenBounds?

    public init(
        text: String,
        contextBefore: String,
        contextAfter: String,
        appName: String,
        bundleIdentifier: String,
        windowTitle: String,
        screenBounds: ScreenBounds? = nil
    ) {
        self.text = text
        self.contextBefore = contextBefore
        self.contextAfter = contextAfter
        self.appName = appName
        self.bundleIdentifier = bundleIdentifier
        self.windowTitle = windowTitle
        self.screenBounds = screenBounds
    }
}

public struct ScreenPoint: Codable, Equatable, Sendable {
    public var x: Double
    public var y: Double

    public init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }
}

public struct ScreenBounds: Codable, Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var width: Double
    public var height: Double

    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }
}

public enum SelectionPopoverAnchor {
    public static func point(for selection: SystemSelection, fallbackMouse: ScreenPoint) -> ScreenPoint {
        guard let bounds = selection.screenBounds, bounds.width > 0, bounds.height > 0 else {
            return fallbackMouse
        }

        return ScreenPoint(x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height)
    }
}

public struct SystemExcerptRecord: Codable, Equatable, Sendable {
    public var id: String
    public var kind: String
    public var title: String
    public var createdAt: Date
    public var updatedAt: Date
    public var color: AnnotationColor
    public var note: String
    public var tags: [String]
    public var collectionIds: [String]
    public var review: ReviewState
    public var target: SystemSelectionTarget
    public var source: MacOSRecordSource

    public init(
        id: String = "rec_system_\(UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased())",
        selection: SystemSelection,
        color: AnnotationColor,
        note: String,
        createdAt: Date = Date()
    ) {
        self.id = id
        self.kind = "system-excerpt"
        self.title = SystemExcerptRecord.title(for: selection)
        self.createdAt = createdAt
        self.updatedAt = createdAt
        self.color = color
        self.note = note
        self.tags = []
        self.collectionIds = []
        self.review = ReviewState(enabled: false)
        self.target = SystemSelectionTarget(selection: selection)
        self.source = MacOSRecordSource(selection: selection)
    }

    private static func title(for selection: SystemSelection) -> String {
        if selection.windowTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return selection.appName
        }
        return "\(selection.appName) - \(selection.windowTitle)"
    }
}

public struct ReviewState: Codable, Equatable, Sendable {
    public var enabled: Bool
}

public struct SystemSelectionTarget: Codable, Equatable, Sendable {
    public var type: String
    public var quote: String
    public var contextBefore: String
    public var contextAfter: String
    public var appName: String
    public var bundleIdentifier: String
    public var windowTitle: String

    public init(selection: SystemSelection) {
        self.type = "system-selection"
        self.quote = selection.text
        self.contextBefore = selection.contextBefore
        self.contextAfter = selection.contextAfter
        self.appName = selection.appName
        self.bundleIdentifier = selection.bundleIdentifier
        self.windowTitle = selection.windowTitle
    }
}

public struct MacOSRecordSource: Codable, Equatable, Sendable {
    public var provider: String
    public var bundleIdentifier: String
    public var appName: String
    public var windowTitle: String

    public init(selection: SystemSelection) {
        self.provider = "macos"
        self.bundleIdentifier = selection.bundleIdentifier
        self.appName = selection.appName
        self.windowTitle = selection.windowTitle
    }
}

public extension JSONEncoder {
    static var omni: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return encoder
    }
}

import Foundation

public protocol ChromeBridge: AnyObject {
    func canHandle(selection: SystemSelection) -> Bool
    func send(_ command: ChromeBridgeCommand) async throws
}

public protocol ExcerptStore: AnyObject {
    func append(_ record: SystemExcerptRecord) async throws
}

public final class OmniActionRouter {
    private let chromeBridge: ChromeBridge
    private let excerptStore: ExcerptStore

    public init(chromeBridge: ChromeBridge, excerptStore: ExcerptStore) {
        self.chromeBridge = chromeBridge
        self.excerptStore = excerptStore
    }

    public func perform(_ action: OmniAction, selection: SystemSelection, color: AnnotationColor) async throws {
        switch action {
        case .highlight, .sentence, .stickyNote, .screenshot:
            if chromeBridge.canHandle(selection: selection) {
                try await chromeBridge.send(ChromeBridgeCommand(action: action, color: color))
                return
            }
            try await saveSystemExcerpt(selection: selection, color: color, note: selection.text)
        case .note:
            try await saveSystemExcerpt(selection: selection, color: color, note: selection.text)
        case .copy, .paste, .pasteWithoutStyle, .translate, .appleNote:
            return
        }
    }

    private func saveSystemExcerpt(selection: SystemSelection, color: AnnotationColor, note: String) async throws {
        let record = SystemExcerptRecord(selection: selection, color: color, note: note)
        try await excerptStore.append(record)
    }
}

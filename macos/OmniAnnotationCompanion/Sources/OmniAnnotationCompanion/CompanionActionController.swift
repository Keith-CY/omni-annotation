import AppKit
import OmniAnnotationCore

enum CompanionError: LocalizedError {
    case noSelection

    var errorDescription: String? {
        switch self {
        case .noSelection:
            return "No selected text is available from the frontmost app."
        }
    }
}

final class CompanionActionController {
    private let selectionReader: SelectionReading
    private let pasteboard: PasteboardControlling
    private let router: OmniActionRouter
    private let appleNotes: AppleNotesController

    init(
        selectionReader: SelectionReading,
        pasteboard: PasteboardControlling,
        router: OmniActionRouter,
        appleNotes: AppleNotesController
    ) {
        self.selectionReader = selectionReader
        self.pasteboard = pasteboard
        self.router = router
        self.appleNotes = appleNotes
    }

    func performPasteboardAction(_ action: OmniAction) async throws {
        switch action {
        case .copy:
            let selection = try currentSelection()
            pasteboard.copy(selection.text)
        case .paste:
            pasteboard.paste()
        case .pasteWithoutStyle:
            pasteboard.pasteWithoutStyle()
        default:
            return
        }
    }

    func performAnnotationAction(_ action: OmniAction, color: AnnotationColor) async throws {
        let selection = try currentSelection()
        if action == .translate {
            openTranslate(for: selection.text)
            return
        }
        if action == .appleNote {
            try appleNotes.createNote(from: selection)
            return
        }
        try await router.perform(action, selection: selection, color: color)
    }

    private func currentSelection() throws -> SystemSelection {
        guard let selection = selectionReader.currentSelection(), !selection.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw CompanionError.noSelection
        }
        return selection
    }

    private func openTranslate(for text: String) {
        var components = URLComponents(string: "https://translate.google.com/")
        components?.queryItems = [
            URLQueryItem(name: "sl", value: "auto"),
            URLQueryItem(name: "tl", value: "zh-CN"),
            URLQueryItem(name: "text", value: text),
            URLQueryItem(name: "op", value: "translate")
        ]
        if let url = components?.url {
            NSWorkspace.shared.open(url)
        }
    }
}

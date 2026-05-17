import Foundation
import OmniAnnotationCore

final class AppleNotesController {
    func createNote(from selection: SystemSelection) throws {
        let script = AppleNotesScriptBuilder.script(for: selection)
        var error: NSDictionary?
        NSAppleScript(source: script)?.executeAndReturnError(&error)
        if let error {
            throw NSError(domain: "OmniAnnotation.AppleNotes", code: 1, userInfo: error as? [String: Any])
        }
    }
}

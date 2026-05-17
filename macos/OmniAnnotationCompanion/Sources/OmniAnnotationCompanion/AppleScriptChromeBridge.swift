import Foundation
import OmniAnnotationCore

final class AppleScriptChromeBridge: ChromeBridge {
    func canHandle(selection: SystemSelection) -> Bool {
        selection.bundleIdentifier == "com.google.Chrome" || selection.bundleIdentifier == "com.google.Chrome.canary"
    }

    func send(_ command: ChromeBridgeCommand) async throws {
        let script = ChromeBridgeScriptBuilder.script(for: command)
        let escaped = script
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        let source = """
        tell application "Google Chrome"
          if (count of windows) is 0 then return
          tell active tab of front window
            execute javascript "\(escaped)"
          end tell
        end tell
        """
        var error: NSDictionary?
        NSAppleScript(source: source)?.executeAndReturnError(&error)
        if let error {
            throw NSError(domain: "OmniAnnotation.ChromeBridge", code: 1, userInfo: error as? [String: Any])
        }
    }
}

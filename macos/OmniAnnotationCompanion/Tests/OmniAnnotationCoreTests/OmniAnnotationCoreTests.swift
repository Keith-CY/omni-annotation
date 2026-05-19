import XCTest
@testable import OmniAnnotationCore

final class OmniAnnotationCoreTests: XCTestCase {
    func testSystemExcerptRecordUsesStableOmniShape() throws {
        let selection = SystemSelection(
            text: "selected text",
            contextBefore: "before ",
            contextAfter: " after",
            appName: "Preview",
            bundleIdentifier: "com.apple.Preview",
            windowTitle: "Document.pdf"
        )

        let record = SystemExcerptRecord(
            id: "rec_system_1",
            selection: selection,
            color: .cyan,
            note: "important",
            createdAt: Date(timeIntervalSince1970: 1_800_000_000)
        )

        let data = try JSONEncoder.omni.encode(record)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let target = try XCTUnwrap(object["target"] as? [String: Any])
        let source = try XCTUnwrap(object["source"] as? [String: Any])

        XCTAssertEqual(object["id"] as? String, "rec_system_1")
        XCTAssertEqual(object["kind"] as? String, "system-excerpt")
        XCTAssertEqual(object["title"] as? String, "Preview - Document.pdf")
        XCTAssertEqual(object["color"] as? String, "cyan")
        XCTAssertEqual(target["type"] as? String, "system-selection")
        XCTAssertEqual(target["quote"] as? String, "selected text")
        XCTAssertEqual(target["contextBefore"] as? String, "before ")
        XCTAssertEqual(target["contextAfter"] as? String, " after")
        XCTAssertEqual(source["provider"] as? String, "macos")
        XCTAssertEqual(source["bundleIdentifier"] as? String, "com.apple.Preview")
    }

    func testActionRouterUsesChromeForBrowserHighlightAndLocalStoreForSystemNote() async throws {
        let chromeBridge = RecordingChromeBridge(canHandleCurrentApp: true)
        let store = RecordingExcerptStore()
        let router = OmniActionRouter(chromeBridge: chromeBridge, excerptStore: store)
        let selection = SystemSelection(
            text: "quote",
            contextBefore: "",
            contextAfter: "",
            appName: "Google Chrome",
            bundleIdentifier: "com.google.Chrome",
            windowTitle: "Example"
        )

        try await router.perform(.highlight, selection: selection, color: .yellow)
        try await router.perform(.note, selection: selection, color: .green)

        XCTAssertEqual(chromeBridge.commands.map(\.action), [.highlight])
        XCTAssertEqual(chromeBridge.commands.map(\.color), [.yellow])
        XCTAssertEqual(store.records.map(\.note), ["quote"])
        XCTAssertEqual(store.records.map(\.color), [.green])
    }

    func testChromeBridgeScriptDispatchesOmniBridgeEvent() {
        let command = ChromeBridgeCommand(action: .sentence, color: .purple)
        let script = ChromeBridgeScriptBuilder.script(for: command)

        XCTAssertTrue(script.contains("window.dispatchEvent"))
        XCTAssertTrue(script.contains("omni-annotation-native-action"))
        XCTAssertTrue(script.contains("\"action\":\"sentence-highlight\""))
        XCTAssertTrue(script.contains("\"color\":\"purple\""))
    }

    func testAutomaticPopoverIsNotSuppressedForChromeBecauseTheAppOwnsSelectionUi() {
        XCTAssertFalse(AutomaticPopoverPolicy.shouldSuppress(bundleIdentifier: "com.google.Chrome"))
        XCTAssertFalse(AutomaticPopoverPolicy.shouldSuppress(bundleIdentifier: "com.google.Chrome.canary"))
        XCTAssertFalse(AutomaticPopoverPolicy.shouldSuppress(bundleIdentifier: "com.apple.Preview"))
    }

    func testAppleNotesScriptCreatesANewNoteWithEscapedSelectionHtml() {
        let selection = SystemSelection(
            text: "A <quoted> \"selection\"",
            contextBefore: "",
            contextAfter: "",
            appName: "Preview",
            bundleIdentifier: "com.apple.Preview",
            windowTitle: "Document.pdf"
        )

        let script = AppleNotesScriptBuilder.script(for: selection)

        XCTAssertTrue(script.contains("tell application \"Notes\""))
        XCTAssertTrue(script.contains("make new note"))
        XCTAssertTrue(script.contains("A &lt;quoted&gt; &quot;selection&quot;"))
        XCTAssertTrue(script.contains("Document.pdf"))
    }

    func testLoginItemMenuStateReflectsLaunchAtLoginRegistration() {
        let enabled = LoginItemMenuState(isEnabled: true)
        let disabled = LoginItemMenuState(isEnabled: false)

        XCTAssertEqual(enabled.title, "Start at Login")
        XCTAssertEqual(enabled.menuState, "on")
        XCTAssertEqual(disabled.title, "Start at Login")
        XCTAssertEqual(disabled.menuState, "off")
    }

    func testSelectionPopoverAnchorPrefersSelectionBoundsOverMouseLocation() {
        let selection = SystemSelection(
            text: "selected text",
            contextBefore: "",
            contextAfter: "",
            appName: "Safari",
            bundleIdentifier: "com.apple.Safari",
            windowTitle: "Example",
            screenBounds: ScreenBounds(x: 120, y: 320, width: 240, height: 28)
        )

        let anchor = SelectionPopoverAnchor.point(for: selection, fallbackMouse: ScreenPoint(x: 900, y: 100))

        XCTAssertEqual(anchor, ScreenPoint(x: 240, y: 348))
    }

    func testSelectionMonitorLifecycleReinstallsMonitorAfterWakeRecovery() {
        var lifecycle = SelectionMonitorLifecycle()

        XCTAssertEqual(lifecycle.start(), [.installMonitor, .startWatchdog])
        XCTAssertEqual(lifecycle.recoverAfterWake(), [.removeMonitor, .installMonitor, .restartWatchdog])
        XCTAssertEqual(lifecycle.stop(), [.removeMonitor, .stopWatchdog])
    }
}

private final class RecordingChromeBridge: ChromeBridge {
    let canHandleCurrentApp: Bool
    var commands: [ChromeBridgeCommand] = []

    init(canHandleCurrentApp: Bool) {
        self.canHandleCurrentApp = canHandleCurrentApp
    }

    func canHandle(selection: SystemSelection) -> Bool {
        canHandleCurrentApp && selection.bundleIdentifier == "com.google.Chrome"
    }

    func send(_ command: ChromeBridgeCommand) async throws {
        commands.append(command)
    }
}

private final class RecordingExcerptStore: ExcerptStore {
    var records: [SystemExcerptRecord] = []

    func append(_ record: SystemExcerptRecord) async throws {
        records.append(record)
    }
}

import Foundation

public struct LoginItemMenuState: Equatable, Sendable {
    public var isEnabled: Bool

    public init(isEnabled: Bool) {
        self.isEnabled = isEnabled
    }

    public var title: String {
        "Start at Login"
    }

    public var menuState: String {
        isEnabled ? "on" : "off"
    }
}

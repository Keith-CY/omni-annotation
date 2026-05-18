import Foundation

public enum SelectionMonitorOperation: Equatable, Sendable {
    case install
    case remove
}

public struct SelectionMonitorLifecycle: Sendable {
    private var isInstalled = false

    public init() {}

    public mutating func start() -> [SelectionMonitorOperation] {
        guard !isInstalled else {
            return []
        }
        isInstalled = true
        return [.install]
    }

    public mutating func recoverAfterWake() -> [SelectionMonitorOperation] {
        isInstalled = true
        return [.remove, .install]
    }

    public mutating func stop() -> [SelectionMonitorOperation] {
        guard isInstalled else {
            return []
        }
        isInstalled = false
        return [.remove]
    }
}

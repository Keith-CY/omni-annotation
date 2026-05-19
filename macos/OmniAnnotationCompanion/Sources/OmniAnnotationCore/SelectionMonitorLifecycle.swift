import Foundation

public enum SelectionMonitorOperation: Equatable, Sendable {
    case installMonitor
    case removeMonitor
    case startWatchdog
    case restartWatchdog
    case stopWatchdog
}

public struct SelectionMonitorLifecycle: Sendable {
    private var isInstalled = false

    public init() {}

    public mutating func start() -> [SelectionMonitorOperation] {
        guard !isInstalled else {
            return []
        }
        isInstalled = true
        return [.installMonitor, .startWatchdog]
    }

    public mutating func recoverAfterWake() -> [SelectionMonitorOperation] {
        isInstalled = true
        return [.removeMonitor, .installMonitor, .restartWatchdog]
    }

    public mutating func stop() -> [SelectionMonitorOperation] {
        guard isInstalled else {
            return []
        }
        isInstalled = false
        return [.removeMonitor, .stopWatchdog]
    }
}

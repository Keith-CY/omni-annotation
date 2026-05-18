import AppKit
import OmniAnnotationCore

final class SelectionPopoverController: NSObject {
    private let selectionReader: SelectionReading
    private let actionController: CompanionActionController
    private let getColor: () -> AnnotationColor
    private let setColor: (AnnotationColor) -> Void
    private var monitor: Any?
    private var lifecycle = SelectionMonitorLifecycle()
    private var panel: NSPanel?
    private var tooltipPanel: NSPanel?
    private var colorPanel: NSPanel?
    private var notificationObservers: [NSObjectProtocol] = []
    private var currentSelection: SystemSelection?
    private var lastSelectionKey = ""
    private let panelHeight: CGFloat = 44

    init(
        selectionReader: SelectionReading,
        actionController: CompanionActionController,
        getColor: @escaping () -> AnnotationColor,
        setColor: @escaping (AnnotationColor) -> Void
    ) {
        self.selectionReader = selectionReader
        self.actionController = actionController
        self.getColor = getColor
        self.setColor = setColor
    }

    func start() {
        applyMonitorOperations(lifecycle.start())
        installRecoveryObserversIfNeeded()
    }

    func stop() {
        removeRecoveryObservers()
        applyMonitorOperations(lifecycle.stop())
        panel?.orderOut(nil)
        panel?.close()
        tooltipPanel?.orderOut(nil)
        tooltipPanel?.close()
        colorPanel?.orderOut(nil)
        colorPanel?.close()
        panel = nil
        tooltipPanel = nil
        colorPanel = nil
    }

    private func recoverMonitorAfterWake() {
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                return
            }
            self.applyMonitorOperations(self.lifecycle.recoverAfterWake())
            self.hide()
        }
    }

    private func installRecoveryObserversIfNeeded() {
        guard notificationObservers.isEmpty else {
            return
        }

        let workspaceCenter = NSWorkspace.shared.notificationCenter
        notificationObservers.append(
            workspaceCenter.addObserver(
                forName: NSWorkspace.didWakeNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                self?.recoverMonitorAfterWake()
            }
        )
        notificationObservers.append(
            workspaceCenter.addObserver(
                forName: NSWorkspace.screensDidWakeNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                self?.recoverMonitorAfterWake()
            }
        )
        notificationObservers.append(
            NotificationCenter.default.addObserver(
                forName: NSApplication.didBecomeActiveNotification,
                object: NSApp,
                queue: .main
            ) { [weak self] _ in
                self?.recoverMonitorAfterWake()
            }
        )
    }

    private func removeRecoveryObservers() {
        let workspaceCenter = NSWorkspace.shared.notificationCenter
        for observer in notificationObservers {
            workspaceCenter.removeObserver(observer)
            NotificationCenter.default.removeObserver(observer)
        }
        notificationObservers.removeAll()
    }

    private func applyMonitorOperations(_ operations: [SelectionMonitorOperation]) {
        for operation in operations {
            switch operation {
            case .install:
                installMouseUpMonitor()
            case .remove:
                removeMouseUpMonitor()
            }
        }
    }

    private func installMouseUpMonitor() {
        removeMouseUpMonitor()
        monitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseUp]) { [weak self] _ in
            self?.scheduleSelectionCheck()
        }
    }

    private func removeMouseUpMonitor() {
        if let monitor {
            NSEvent.removeMonitor(monitor)
        }
        monitor = nil
    }

    private func scheduleSelectionCheck() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) { [weak self] in
            self?.showForCurrentSelectionIfNeeded()
        }
    }

    private func showForCurrentSelectionIfNeeded() {
        guard let selection = selectionReader.currentSelection(),
              !selection.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            hide()
            return
        }

        if AutomaticPopoverPolicy.shouldSuppress(bundleIdentifier: selection.bundleIdentifier) {
            hide()
            return
        }

        let key = selectionKey(selection)
        if panel?.isVisible == true && key == lastSelectionKey {
            hide()
            return
        }

        currentSelection = selection
        lastSelectionKey = key
        let mouseLocation = NSEvent.mouseLocation
        let anchor = SelectionPopoverAnchor.point(
            for: selection,
            fallbackMouse: ScreenPoint(x: Double(mouseLocation.x), y: Double(mouseLocation.y))
        )
        show(at: NSPoint(x: anchor.x, y: anchor.y))
    }

    private func selectionKey(_ selection: SystemSelection) -> String {
        [
            selection.bundleIdentifier,
            selection.windowTitle,
            selection.text
        ].joined(separator: "\n")
    }

    private func show(at point: NSPoint) {
        if panel == nil {
            panel = makePanel()
        }

        guard let panel else {
            return
        }

        let content = makeContentView()
        panel.contentView = content
        let width = content.fittingSize.width
        let targetFrame = NSRect(x: point.x - width / 2, y: point.y + 12, width: width, height: panelHeight)
        panel.setFrame(targetFrame, display: true)
        panel.orderFrontRegardless()
    }

    private func hide() {
        panel?.orderOut(nil)
        hideTooltip()
        hideColorPalette()
    }

    private func makePanel() -> NSPanel {
        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 360, height: panelHeight),
            styleMask: [.nonactivatingPanel, .borderless],
            backing: .buffered,
            defer: false
        )
        panel.level = .floating
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.hidesOnDeactivate = false
        return panel
    }

    private func makeContentView() -> NSView {
        let container = NSView(frame: NSRect(x: 0, y: 0, width: 360, height: panelHeight))
        applyPopoverSurface(to: container, cornerRadius: 10)

        let stack = NSStackView()
        stack.orientation = .horizontal
        stack.alignment = .centerY
        stack.spacing = 5
        stack.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(stack)

        stack.addArrangedSubview(iconButton(symbol: "doc.on.doc", title: "Copy", action: #selector(copySelectionAction)))
        stack.addArrangedSubview(iconButton(symbol: "doc.on.clipboard", title: "Paste", action: #selector(pasteAction)))
        stack.addArrangedSubview(iconButton(symbol: "textformat", title: "Paste without style", action: #selector(pasteWithoutStyleAction)))
        stack.addArrangedSubview(iconButton(symbol: "character.book.closed", title: "Translate", action: #selector(translateAction)))
        stack.addArrangedSubview(iconButton(symbol: "note.text", title: "Save to Omni", action: #selector(noteAction)))
        stack.addArrangedSubview(iconButton(symbol: "note.text.badge.plus", title: "Create Apple Note", action: #selector(appleNoteAction)))
        stack.addArrangedSubview(iconButton(symbol: "highlighter", title: "Highlight", action: #selector(highlightAction)))
        stack.addArrangedSubview(iconButton(symbol: "text.quote", title: "Sentence", action: #selector(sentenceAction)))
        stack.addArrangedSubview(colorCardButton(color: getColor()))
        stack.addArrangedSubview(iconButton(symbol: "xmark", title: "Dismiss", action: #selector(dismissAction), hoverTint: .systemRed))

        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 7),
            stack.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -7),
            stack.topAnchor.constraint(equalTo: container.topAnchor, constant: 7),
            stack.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -7)
        ])
        container.layoutSubtreeIfNeeded()
        let width = stack.fittingSize.width + 14
        container.frame = NSRect(x: 0, y: 0, width: width, height: panelHeight)
        return container
    }

    private func colorCardButton(color: AnnotationColor) -> NSButton {
        let button = HoverIconButton(title: "", target: self, action: #selector(toggleColorPalette(_:)))
        button.image = colorSwatchImage(color: color, selected: true, size: NSSize(width: 18, height: 18))
        button.imagePosition = .imageOnly
        button.bezelStyle = .regularSquare
        button.isBordered = false
        button.focusRingType = .none
        button.toolTip = "Color"
        button.onHoverChanged = { [weak self] isHovered in
            if isHovered {
                self?.showTooltip("Color", near: button)
            } else {
                self?.hideTooltip()
            }
        }
        button.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            button.widthAnchor.constraint(equalToConstant: 34),
            button.heightAnchor.constraint(equalToConstant: 28)
        ])
        return button
    }

    private func iconButton(symbol: String, title: String, action: Selector, hoverTint: NSColor = .controlAccentColor) -> NSButton {
        let button = HoverIconButton(title: "", target: self, action: action)
        let image = NSImage(systemSymbolName: symbol, accessibilityDescription: title)
        image?.isTemplate = true
        button.image = image
        button.imagePosition = .imageOnly
        button.imageScaling = .scaleProportionallyDown
        button.bezelStyle = .regularSquare
        button.isBordered = false
        button.focusRingType = .none
        button.configureTint(normal: PopoverStyle.inactiveIcon, hover: hoverTint)
        button.toolTip = title
        button.onHoverChanged = { [weak self] isHovered in
            if isHovered {
                self?.showTooltip(title, near: button)
            } else {
                self?.hideTooltip()
            }
        }
        button.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            button.widthAnchor.constraint(equalToConstant: 30),
            button.heightAnchor.constraint(equalToConstant: 28)
        ])
        return button
    }

    private func applyPopoverSurface(to view: NSView, cornerRadius: CGFloat) {
        view.wantsLayer = true
        view.layer?.backgroundColor = PopoverStyle.background.cgColor
        view.layer?.cornerRadius = cornerRadius
        view.layer?.borderWidth = 1
        view.layer?.borderColor = PopoverStyle.border.cgColor
    }

    private func showTooltip(_ title: String, near button: NSView) {
        guard let window = button.window else {
            return
        }

        let tooltip = tooltipPanel ?? makeTooltipPanel()
        tooltipPanel = tooltip
        tooltip.contentView = makeTooltipContent(title)
        let buttonRect = button.convert(button.bounds, to: nil)
        let screenRect = window.convertToScreen(buttonRect)
        let size = tooltip.contentView?.fittingSize ?? NSSize(width: 120, height: 30)
        let frame = NSRect(
            x: screenRect.midX - size.width / 2,
            y: screenRect.maxY + 8,
            width: size.width,
            height: size.height
        )
        tooltip.setFrame(frame, display: true)
        tooltip.orderFrontRegardless()
    }

    private func hideTooltip() {
        tooltipPanel?.orderOut(nil)
    }

    @objc private func toggleColorPalette(_ sender: NSButton) {
        if colorPanel?.isVisible == true {
            hideColorPalette()
            return
        }
        showColorPalette(near: sender)
    }

    private func showColorPalette(near sender: NSView) {
        guard let window = sender.window else {
            return
        }

        hideTooltip()
        let palette = colorPanel ?? makeColorPanel()
        colorPanel = palette
        palette.contentView = makeColorPaletteContent()
        let senderRect = sender.convert(sender.bounds, to: nil)
        let screenRect = window.convertToScreen(senderRect)
        let size = palette.contentView?.fittingSize ?? NSSize(width: 178, height: 42)
        palette.setFrame(
            NSRect(x: screenRect.midX - size.width / 2, y: screenRect.maxY + 8, width: size.width, height: size.height),
            display: true
        )
        palette.orderFrontRegardless()
    }

    private func hideColorPalette() {
        colorPanel?.orderOut(nil)
    }

    private func makeColorPanel() -> NSPanel {
        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 178, height: 42),
            styleMask: [.nonactivatingPanel, .borderless],
            backing: .buffered,
            defer: false
        )
        panel.level = .floating
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.hidesOnDeactivate = false
        return panel
    }

    private func makeColorPaletteContent() -> NSView {
        let container = NSView()
        applyPopoverSurface(to: container, cornerRadius: 10)

        let stack = NSStackView()
        stack.orientation = .horizontal
        stack.alignment = .centerY
        stack.spacing = 7
        stack.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(stack)

        for (index, color) in AnnotationColor.allCases.enumerated() {
            let button = NSButton(title: "", target: self, action: #selector(selectColor(_:)))
            button.image = colorSwatchImage(color: color, selected: color == getColor(), size: NSSize(width: 22, height: 22))
            button.imagePosition = .imageOnly
            button.bezelStyle = .regularSquare
            button.isBordered = false
            button.tag = index
            button.toolTip = color.rawValue.capitalized
            button.translatesAutoresizingMaskIntoConstraints = false
            NSLayoutConstraint.activate([
                button.widthAnchor.constraint(equalToConstant: 26),
                button.heightAnchor.constraint(equalToConstant: 26)
            ])
            stack.addArrangedSubview(button)
        }

        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 9),
            stack.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -9),
            stack.topAnchor.constraint(equalTo: container.topAnchor, constant: 8),
            stack.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -8)
        ])
        container.frame = NSRect(x: 0, y: 0, width: 178, height: 42)
        return container
    }

    @objc private func selectColor(_ sender: NSButton) {
        let colors = AnnotationColor.allCases
        guard colors.indices.contains(sender.tag) else {
            return
        }
        let color = colors[sender.tag]
        setColor(color)
        hideColorPalette()
        if let panel {
            panel.contentView = makeContentView()
        }
    }

    private func makeTooltipPanel() -> NSPanel {
        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 120, height: 30),
            styleMask: [.nonactivatingPanel, .borderless],
            backing: .buffered,
            defer: false
        )
        panel.level = .floating
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.hidesOnDeactivate = false
        return panel
    }

    private func colorSwatchImage(color: AnnotationColor, selected: Bool, size: NSSize) -> NSImage {
        let image = NSImage(size: size)
        image.lockFocus()
        let rect = NSRect(origin: .zero, size: size).insetBy(dx: 2, dy: 2)
        swatchColor(color).setFill()
        NSBezierPath(ovalIn: rect).fill()
        if selected {
            NSColor.labelColor.setStroke()
            let stroke = NSBezierPath(ovalIn: rect.insetBy(dx: -1.5, dy: -1.5))
            stroke.lineWidth = 1.5
            stroke.stroke()
        }
        image.unlockFocus()
        image.isTemplate = false
        return image
    }

    private func swatchColor(_ color: AnnotationColor) -> NSColor {
        switch color {
        case .yellow:
            return NSColor(calibratedRed: 0.96, green: 0.78, blue: 0.23, alpha: 1)
        case .green:
            return NSColor(calibratedRed: 0.32, green: 0.72, blue: 0.46, alpha: 1)
        case .pink:
            return NSColor(calibratedRed: 0.91, green: 0.45, blue: 0.61, alpha: 1)
        case .purple:
            return NSColor(calibratedRed: 0.58, green: 0.44, blue: 0.83, alpha: 1)
        case .cyan:
            return NSColor(calibratedRed: 0.26, green: 0.66, blue: 0.78, alpha: 1)
        }
    }

    private func makeTooltipContent(_ title: String) -> NSView {
        let label = NSTextField(labelWithString: title)
        label.font = .systemFont(ofSize: 12, weight: .medium)
        label.textColor = .white
        label.alignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false

        let container = NSView()
        container.wantsLayer = true
        container.layer?.backgroundColor = NSColor(calibratedWhite: 0.08, alpha: 0.96).cgColor
        container.layer?.cornerRadius = 8
        container.addSubview(label)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 10),
            label.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -10),
            label.topAnchor.constraint(equalTo: container.topAnchor, constant: 6),
            label.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -6)
        ])
        container.frame = NSRect(x: 0, y: 0, width: max(72, label.intrinsicContentSize.width + 20), height: 30)
        return container
    }

    @objc private func copySelectionAction() {
        runPasteboard(.copy)
    }

    @objc private func pasteAction() {
        runPasteboard(.paste)
    }

    @objc private func pasteWithoutStyleAction() {
        runPasteboard(.pasteWithoutStyle)
    }

    @objc private func translateAction() {
        runAnnotation(.translate)
    }

    @objc private func noteAction() {
        runAnnotation(.note)
    }

    @objc private func appleNoteAction() {
        runAnnotation(.appleNote)
    }

    @objc private func highlightAction() {
        runAnnotation(.highlight)
    }

    @objc private func sentenceAction() {
        runAnnotation(.sentence)
    }

    @objc private func dismissAction() {
        hide()
    }

    private func runPasteboard(_ action: OmniAction) {
        Task {
            do {
                try await actionController.performPasteboardAction(action)
                await hideOnMainActor()
            } catch {
                presentError(error)
            }
        }
    }

    private func runAnnotation(_ action: OmniAction) {
        Task {
            do {
                try await actionController.performAnnotationAction(action, color: getColor())
                await hideOnMainActor()
            } catch {
                presentError(error)
            }
        }
    }

    @MainActor
    private func hideOnMainActor() {
        hide()
    }

    private func presentError(_ error: Error) {
        DispatchQueue.main.async {
            let alert = NSAlert(error: error)
            alert.runModal()
        }
    }
}

private final class HoverIconButton: NSButton {
    var onHoverChanged: ((Bool) -> Void)?
    private var normalTint = PopoverStyle.inactiveIcon
    private var hoverTint = NSColor.controlAccentColor
    private var isHovering = false
    private var hoverTrackingArea: NSTrackingArea?

    func configureTint(normal: NSColor, hover: NSColor) {
        normalTint = normal
        hoverTint = hover
        updateTint()
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let hoverTrackingArea {
            removeTrackingArea(hoverTrackingArea)
        }
        let area = NSTrackingArea(
            rect: bounds,
            options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
            owner: self,
            userInfo: nil
        )
        addTrackingArea(area)
        hoverTrackingArea = area
    }

    override func mouseEntered(with event: NSEvent) {
        isHovering = true
        updateTint()
        onHoverChanged?(true)
    }

    override func mouseExited(with event: NSEvent) {
        isHovering = false
        updateTint()
        onHoverChanged?(false)
    }

    private func updateTint() {
        contentTintColor = isHovering ? hoverTint : normalTint
    }
}

private enum PopoverStyle {
    static let background = NSColor.white
    static let border = NSColor(calibratedWhite: 0, alpha: 0.12)
    static let inactiveIcon = NSColor(calibratedWhite: 0.62, alpha: 1)
}

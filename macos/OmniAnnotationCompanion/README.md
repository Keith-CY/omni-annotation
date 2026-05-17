# Omni Annotation Companion

macOS companion app for Omni Annotation. It provides a small menu bar entry for global selection actions while keeping real web-page highlights in the Chrome extension.

## Run

```bash
cd macos/OmniAnnotationCompanion
swift run OmniAnnotationCompanion
```

The app appears as `Omni` in the macOS menu bar. It also watches for mouse-up selection changes and shows a small floating icon action bar near the mouse when selected text is available. Hover an icon to see a compact dark tooltip.

## Install

```bash
cd macos/OmniAnnotationCompanion
Scripts/install-app.sh
```

The install script builds a release `.app`, copies it to `/Applications/Omni Annotation.app`, removes quarantine metadata when present, and opens the app.

## Permissions

Use `Omni > Request Accessibility Permission`, then grant permission in System Settings. Selection reading and paste keystrokes depend on macOS Accessibility/Input Monitoring behavior.

Use `Omni > Start at Login` to register or unregister the installed app as a macOS login item.

## V1 Behavior

- `Copy`, `Paste`, and `Paste Without Style` use the system pasteboard.
- `Translate` opens Google Translate with the current selection.
- `Note` saves the current system selection to `~/Library/Application Support/OmniAnnotation/system-excerpts.jsonl`.
- `Create Apple Note` creates a new Apple Notes note from the current selection. macOS may ask for Automation permission for Notes.
- `Highlight`, `Sentence`, `Sticky note`, and `Shot` route to the Chrome extension when Google Chrome is frontmost; otherwise they save a system excerpt.
- Cross-app original-position highlight restore is intentionally not part of V1.

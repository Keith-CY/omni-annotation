#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="Omni Annotation"
PRODUCT_NAME="OmniAnnotationCompanion"
CONFIGURATION="${CONFIGURATION:-release}"
BUILD_DIR="$ROOT_DIR/.build/$CONFIGURATION"
APP_DIR="$ROOT_DIR/build/$APP_NAME.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"

cd "$ROOT_DIR"
swift build -c "$CONFIGURATION" --product "$PRODUCT_NAME"

rm -rf "$APP_DIR"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR"
cp "$BUILD_DIR/$PRODUCT_NAME" "$MACOS_DIR/$PRODUCT_NAME"
cp "$ROOT_DIR/Bundle/Info.plist" "$CONTENTS_DIR/Info.plist"
chmod 755 "$MACOS_DIR/$PRODUCT_NAME"

if command -v codesign >/dev/null 2>&1; then
  codesign --force --sign - "$APP_DIR"
fi

echo "$APP_DIR"

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="Omni Annotation"
APP_SOURCE="$ROOT_DIR/build/$APP_NAME.app"
APP_TARGET="/Applications/$APP_NAME.app"

if [[ ! -d "$APP_SOURCE" ]]; then
  "$ROOT_DIR/Scripts/build-app.sh"
fi

if [[ -d "$APP_TARGET" ]]; then
  rm -rf "$APP_TARGET"
fi

cp -R "$APP_SOURCE" "$APP_TARGET"
xattr -dr com.apple.quarantine "$APP_TARGET" 2>/dev/null || true
open "$APP_TARGET"

echo "$APP_TARGET"

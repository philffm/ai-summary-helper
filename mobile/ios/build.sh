#!/bin/bash
# One command for the iOS app:
#   ./build.sh              generate the Xcode project and build for the simulator
#   ./build.sh --run        ... then install and start it in a simulator ($SIMULATOR, default "iPhone 17")
#   ./build.sh --open       only generate the project and open it in Xcode
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
command -v xcodegen >/dev/null || { echo "xcodegen is missing: brew install xcodegen" >&2; exit 1; }
./scripts/version.sh
xcodegen generate --quiet
case "${1:-}" in
  --open) open Kaivo.xcodeproj; exit 0 ;;
esac
SIMULATOR="${SIMULATOR:-iPhone 17}"
xcodebuild -project Kaivo.xcodeproj -scheme Kaivo -configuration Debug -destination "platform=iOS Simulator,name=$SIMULATOR" \
  -derivedDataPath build -quiet build
APP="build/Build/Products/Debug-iphonesimulator/Kaivo.app"
echo "built $APP"
if [ "${1:-}" = "--run" ]; then
  xcrun simctl boot "$SIMULATOR" 2>/dev/null || true
  xcrun simctl bootstatus "$SIMULATOR" -b >/dev/null
  # the window with the simulator: DeviceHub since Xcode 27, Simulator before; the app runs without it too
  open "$(xcode-select -p)/../Applications/DeviceHub.app" 2>/dev/null || open -a Simulator 2>/dev/null || true
  xcrun simctl install "$SIMULATOR" "$APP"
  ID=$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$APP/Info.plist")
  xcrun simctl launch "$SIMULATOR" "$ID"
fi

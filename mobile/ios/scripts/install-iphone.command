#!/bin/bash
# Builds the app, signs it with the team of Config/Local.xcconfig and installs it on an iPhone.
#     IPHONE=<device id> mobile/ios/scripts/install-iphone.command
# `xcrun devicectl list devices` shows the ids. The id may instead lie in mobile/ios/build/iphone-id (not committed).
cd "$(dirname "$0")/.." || exit 1
mkdir -p build
U=${IPHONE:-$(cat build/iphone-id 2>/dev/null)}
[ -n "$U" ] || { echo "Which iPhone? Set IPHONE=<device id> or write the id to mobile/ios/build/iphone-id."; exit 1; }
exec > >(tee build/install-iphone.log) 2>&1
echo "Building and signing. If macOS asks about the keychain: enter the Mac's password and choose \"Always Allow\"."
xcodegen generate --quiet || exit 1
build() { xcodebuild -quiet -project Kaivo.xcodeproj -scheme Kaivo -destination "platform=iOS,id=$U" -derivedDataPath build/device \
  -allowProvisioningUpdates build 2>&1 | grep -v IDESchemeActionDeviceRecord | grep -E "error|errSec|FAILED"; return "${PIPESTATUS[0]}"; }
build || { echo "RESULT: build failed, nothing installed"; exit 1; }
APP=build/device/Build/Products/Debug-iphoneos/Kaivo.app
codesign --verify --deep "$APP" || { echo "RESULT: signing failed"; exit 1; }
ID=$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$APP/Info.plist") || exit 1
echo "Installing on the iPhone (leave it unlocked) …"
xcrun devicectl device install app --device "$U" "$APP" || { echo "RESULT: install failed"; exit 1; }
if xcrun devicectl device process launch --device "$U" "$ID"; then echo "RESULT: running"; else
  echo "RESULT: installed, start blocked. On the iPhone: Settings > General > VPN & Device Management > trust the developer app."; fi

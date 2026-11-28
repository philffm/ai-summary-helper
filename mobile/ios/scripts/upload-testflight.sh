#!/bin/bash
# Archives Kaivo with the store bundle id and uploads it to App Store Connect (TestFlight), signed through the Apple
# account set up in Xcode. Every run gets a higher build number: <version code>.<yymmddHHMM>.
# The build gets the "BETA" icon. A build that is meant for the App Store needs --release: it keeps the store's icon,
# and only such a build may be submitted for review.
#   scripts/upload-testflight.sh                        archive, check, upload (beta icon)
#   scripts/upload-testflight.sh --release              the same with the store's icon
#   scripts/upload-testflight.sh [--release] --no-upload   archive and check only
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
ID=eu.byphil.kaivo
ICON=AppIcon-Beta UPLOAD=1
for arg in "$@"; do
    case "$arg" in
        --release) ICON=AppIcon ;;
        --no-upload) UPLOAD= ;;
        *) echo "unknown option: $arg" >&2; exit 1 ;;
    esac
done
./scripts/version.sh
BUILD="$(sed -n 's/^CURRENT_PROJECT_VERSION *= *//p' Config/Version.xcconfig).$(date +%y%m%d%H%M)"
xcodegen generate --quiet
rm -rf build/Kaivo.xcarchive
# Config/Local.xcconfig may give device builds a test id: the command line wins over it
xcodebuild -quiet -project Kaivo.xcodeproj -scheme Kaivo -configuration Release -destination 'generic/platform=iOS' \
    -derivedDataPath build/release -archivePath build/Kaivo.xcarchive -allowProvisioningUpdates \
    "KAIVO_BUNDLE_ID=$ID" "CURRENT_PROJECT_VERSION=$BUILD" "KAIVO_ICON=$ICON" KAIVO_NAME=Kaivo archive
APP=build/Kaivo.xcarchive/Products/Applications/Kaivo.app
for part in "$APP" "$APP"/PlugIns/*.appex; do
    got=$(plutil -extract CFBundleIdentifier raw "$part/Info.plist")
    [[ "$got" == "$ID" || "$got" == "$ID".* ]] && [[ "$got" != *devphil* ]] || { echo "wrong bundle id: $got" >&2; exit 1; }
    codesign -d --entitlements - --xml "$part" 2>/dev/null | grep -q ">group.$ID<" || { echo "$got: app group group.$ID missing" >&2; exit 1; }
done
got=$(plutil -extract CFBundleIcons.CFBundlePrimaryIcon.CFBundleIconName raw "$APP/Info.plist")
[[ "$got" == "$ICON" ]] || { echo "wrong icon: $got instead of $ICON" >&2; exit 1; }
grep -q 'STORE_BUILD = true' "$APP/PlugIns/KaivoExtension.appex/modules/storeBuild.js" || { echo "the extension is not the store build" >&2; exit 1; }
echo "archive ok: Kaivo $(plutil -extract CFBundleShortVersionString raw "$APP/Info.plist") ($BUILD), icon $ICON"
[ -n "$UPLOAD" ] || exit 0
# the export calls Apple's rsync, which fails when Homebrew's newer rsync is found on the PATH ("Copy failed")
env PATH=/usr/bin:/bin:/usr/sbin:/sbin xcodebuild -exportArchive -archivePath build/Kaivo.xcarchive \
    -exportOptionsPlist scripts/ExportOptions.plist -exportPath build/export -allowProvisioningUpdates

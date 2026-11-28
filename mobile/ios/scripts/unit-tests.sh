#!/bin/bash
# The app's unit tests on a simulator, with the lines worth reading. T: seconds before the run is given up.
#     SIMULATOR=<simulator id> mobile/ios/scripts/unit-tests.sh      (`xcrun simctl list devices` shows the ids)
set -o pipefail
cd "$(dirname "$0")/.." || exit 1
: "${SIMULATOR:?set SIMULATOR to a simulator id}"
xcodegen generate --quiet || exit 1
perl -e 'alarm shift; exec @ARGV' "${T:-600}" xcodebuild -project Kaivo.xcodeproj -scheme Kaivo -destination "platform=iOS Simulator,id=$SIMULATOR" \
  -derivedDataPath build -parallel-testing-enabled NO -only-testing:KaivoTests test 2>&1 \
  | grep -E "error:|Executed [0-9]+ tests|TEST |XCTAssert|skipped" | cut -c1-600 | sort -u | tail -40

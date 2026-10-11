# AISH Companion (Android)

A tiny share target for the AISH browser extension. Share a link from any app → **AISH**; it is encrypted on the phone
(AES-256-GCM, key from the pairing code) and put in your byPhil inbox. The extension collects it, lists it under
**History → From phone**, and you tap **Summarize**.

## Build
Open `mobile/android` in Android Studio (Koala or newer), let it sync, run on a device. Unit tests: `./gradlew test`
(or run `InboxCryptoTest` from the IDE). The tests use the shared vector in `src/test/resources/inbox-vector.json`,
a copy of `plugin/tests/fixtures/inbox-vector.json`: keep them identical.

## Pairing
Extension → Settings → Phone inbox → **Pair a phone** shows a QR code; the app scans it with Google's code scanner
(no camera permission) or accepts the pasted `aish-inbox://v1?...` text. The code holds the inbox id, the message key and a
*write-only* token. The read token stays in the extension.

## Notes
* Wire format and API: `plugin/inbox-api/openapi.yaml`.
* Only http(s) links are sent; the first one in the shared text.
* Offline or server busy: WorkManager retries with backoff. A rejected pairing shows an error in the app.
* Launcher icon is the platform default placeholder.

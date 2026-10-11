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
* Launcher icons are rendered from `plugin/src/icons/icon.svg` (adaptive icon: gradient background + artwork in the safe zone, legacy PNGs for every density, and `ic_launcher-playstore.png` (512 px) for the Play listing).

## Releases
The release workflow (`.github/workflows/release.yml`) builds the app and attaches it to every GitHub release as
`aish-companion.apk` (a fixed name, so `…/releases/latest/download/aish-companion.apk` always works; the landing page links it).
The version follows the extension (`current_version.json`).

Without secrets the APK is debug-signed: it installs fine, but a later switch to a real key means uninstalling first. To sign
properly, create a keystore once and add four repository secrets:

```
keytool -genkeypair -v -keystore aish-release.jks -alias aish -keyalg RSA -keysize 2048 -validity 10000
base64 -i aish-release.jks | pbcopy          # → ANDROID_KEYSTORE_BASE64
# plus ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS (aish), ANDROID_KEY_PASSWORD
```
Keep the keystore somewhere safe: losing it means users must uninstall to update. Shrinking (R8) is off until a release build has been tested on a device.

# AISH Companion (Android)

A companion for the AISH browser extension, in two directions, both end-to-end encrypted:

* **Phone → browser:** share a link from any app → **AISH**; it is encrypted on the phone (AES-256-GCM, key from the pairing
  code) and put in your byPhil inbox. The extension collects it, lists it under **History → From phone**, and you tap **Summarize**.
* **Browser → phone:** in the extension choose **⋯ → Send to phone** on an article. The full text (no images) is encrypted,
  sent through a second inbox, and the app collects it every 15 minutes (or on **Check now**), saves it on the phone and deletes
  it from the server. Read it offline in the **Reading list**.

* **Feeds:** a basic RSS reader (RSS, Atom, JSON Feed; own parser, no external entities). The feed *list* (URL, name, tags; the
  first tag is the folder) syncs end-to-end encrypted with the extension through one vault document; items and articles never sync,
  each device fetches its own. In a feed item tap **To browser** to send the link to the extension, or **Read page** to open it in
  the in-app web view.
* **Reading list:** articles from **Send to phone**, with the AI summary as bullets and your highlights and the AI's ghost highlights
  marked in the text (yellow, blue) and listed below.
* **Reading tools:** per article, read aloud (play, pause, speed), speed reading (one word at a time, 150–900 wpm), copy or share as
  Markdown (front matter like the extension), archive (swipe left; an Archive filter keeps them), and search over title, site and text.
  **Settings → Backup & restore** exports preferences to a file (never the pairing, licence or account) and imports them on a new phone.
* **Reader comfort:** typeface (app font Hanken Grotesk, serif, or Atkinson Hyperlegible "easy read"), text size, line spacing and background
  (auto, paper, white, dark) from the **Aa** chip or Settings → Accessibility. From the reader you can also summarize on the phone and
  set a reminder (in an hour, this evening, tomorrow morning; one notification, one tap opens the article).
* **Layout:** Material 3, bottom tabs Feeds · Reading · Settings. From 600 dp width (a Fold's inner screen, tablets, landscape) the
  tabs become a side rail and lists open next to their article. The activity handles size changes itself (`configChanges`), so
  folding or unfolding keeps the open article, scroll position and web page. Not yet: tabletop posture / hinge awareness.

## Build
Open `mobile/android` in Android Studio (Koala or newer), let it sync, run on a device. The Gradle wrapper is pinned to 8.13 (the
range the Android Gradle plugin 8.13 supports; Gradle 9.x needs a newer plugin). Unit tests: `./gradlew test`. They use the shared
vectors in `src/test/resources/` (`inbox-vector.json`, `feed-sync-vector.json`), copies of `plugin/tests/fixtures/`: keep them identical (CI compares).

## Pairing
Extension → Settings → Phone inbox → **Pair a phone** shows a QR code; the app scans it with Google's code scanner
(no camera permission) or accepts the pasted `aish-inbox://v1?...` text. The code holds the inbox id, the message key and a
*write-only* token; the read token of that inbox stays in the extension. When **Send to phone** is on, the code also carries
`&ti=<inbox id>&tr=<read token>` of the second inbox (the one the phone reads); when **feed sync** is on it carries
`&vi=<vault id>&vt=<vault token>` as well. If you switch either on later, scan the new code once.

## Notes
* Articles: wire format v2 (gzip, then AES-GCM), plain text blocks only (`h1 h2 h3 p li q pre`), at most 4 MB after decompression.
  They are stored in the app's private storage (`files/articles`), not readable by other apps, and removed on uninstall.
  The unit tests decrypt the `article` part of the shared vector.
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

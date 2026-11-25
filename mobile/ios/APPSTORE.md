# App Store readiness (iOS)

State 2026-11-25. Guideline references are to Apple's
[App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) (page dated 16 Oct 2026). Sections 5.x
and the screenshot sizes were only read as a summary: check them on the live pages before submitting. This is a working
checklist, not legal advice.

**The app is not ready to submit yet.** The blockers are below.

## Blockers

| # | Guideline | Problem | What to do |
| --- | --- | --- | --- |
| 1 | 2.1 | What the Safari extension saves does not appear in the app yet. (The app is useful on its own: feeds, library, highlights, widgets.) | The extension sends saves to its native handler (`nativeMessaging`), which writes them into the App Group; the app picks them up. Later two-way, in the sync format. |
| 2 | 3.1.1, 4.4 | The extension offers the Support Pass through a web checkout (`modules/supportPass.js`); extensions may not contain purchases or marketing. | Hide all purchase UI in the iOS build. Sell in the app with StoreKit (auto-renewable subscription); keep web purchases valid (3.1.3(b)). |
| 3 | 5.1.2(i) (summary) | Page text goes to third-party AI providers; no explicit consent step was found. | Before the first request: say which provider receives what, ask, remember the answer, allow withdrawing. |
| 4 | 5.1.1(v) (summary) | byPhil Cloud sign-in exists in the extension; no account deletion was found. | Offer deletion in the app (needs an API endpoint). |
| 5 | Developer Program | Xcode only shows a free Personal Team. | Join the paid program; set `DEVELOPMENT_TEAM`. |

## Before submission

* [ ] 2.3.3 Screenshots show the app in use: the drafts in `videos/out/store-ios/` use **sample data**. Recapture once real
      features back every screen. Have the translations checked by native speakers (`needs_review` in the string catalog).
* [ ] 2.3.7 / 2.3.10 Listing texts and screenshots: no prices, no names of other mobile platforms (the existing
      `store-listing/` texts mention them).
* [ ] 2.3.1 Review notes: describe the Safari extension, how to switch it on, and give a test provider key or account.
* [ ] 2.1(b) In-app purchases complete and visible to the reviewer.
* [ ] 5.1.1(i) Privacy policy link in App Store Connect and in the app (the app links `kaivo.byphil.eu/privacy.html`;
      check that it covers the iOS app).
* [ ] App privacy answers and `App/PrivacyInfo.xcprivacy`: list what app **and** extension collect (account e-mail, usage
      data, page content sent to AI providers). Only the UserDefaults reason is declared so far.
* [ ] Export compliance: `ITSAppUsesNonExemptEncryption` is `false` in `project.yml`. The extension encrypts sync data with
      the system's WebCrypto; confirm that this counts as exempt.
* [ ] 4.4.2 Website access: the extension asks for `<all_urls>` and `file:///*`; drop `file:///*` on iOS, justify the rest.
* [ ] 2.5.2 No downloaded code (none found outside the bundled libraries).
* [ ] Bundle id decided (`Config/Base.xcconfig`).
* [ ] App Store Small Business Program enrolled **before** selling (15 % instead of 26 % in the EU).
* [ ] Ukrainian, Arabic and Finnish listings: supported by App Store Connect (summary).

## What does not work on iOS (extension features)

From reading the code; **not yet tested on a device**.

| Feature | On iOS | Instead |
| --- | --- | --- |
| Right-click / context menu | no | popup, selection button |
| Keyboard shortcuts (iPhone) | no | – |
| Notifications from the extension | no | native notifications from the app (later) |
| Side panel | Chrome only | in-page sidebar |
| Background work (feed polling, timers, scheduled recap, sync) | unreliable: the background page is suspended | run it in the app with background refresh |
| Read aloud / podcast after closing the popup | likely stops | native player in the app |
| Folder sync and Syncthing (`showDirectoryPicker`) | no | S3 / WebDAV (Nextcloud); later a folder in the Files app, natively |
| Browser bookmarks, "search the web" | Safari lacks the APIs | – |
| Built-in browser AI (Chrome, Firefox) | no | own key or byPhil Cloud; later Apple's on-device models from the app |
| Ollama on `localhost` | no: the phone has no local server | address of a computer on the network (needs testing) |
| MCP (AI apps reading the library) | no relay can run on the phone | desktop only |
| LocalSend | doubtful (direct network transfer) | share sheet |
| Local files (`file://`) | no | open files in the app (later) |

## Money

In the app: StoreKit subscription. Everywhere else: Stripe. One entitlement in the byPhil API with its source
(`apple` or `stripe`), StoreKit 2 with App Store Server Notifications, `appAccountToken` to tie a purchase to the account,
"Restore purchases", and no second purchase offered to someone who already has the pass.

Apple's cut (Apple pages read 2026-11-25): EU 26 %, with the Small Business Program 15 % (also after a subscriber's first
year); outside the EU 15 % with the program.

# App Store readiness (iOS)

State 2026-11-25. Guideline references are to Apple's
[App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) (page dated 16 Oct 2026). Sections 5.x
and the screenshot sizes were only read as a summary: check them on the live pages before submitting. This is a working
checklist, not legal advice.

**The app is not ready to submit yet.** The open points are below.

## Blockers

| # | Guideline | State 2026-11-26 | What is left |
| --- | --- | --- | --- |
| 1 | 2.1 | Done: what Safari saves arrives in the app (seen on a device). | Two-way sync later. |
| 2 | 3.1.1, 4.4 | Done for the extension: the iOS build shows no prices, checkout, donation or license key field (`modules/storeBuild.js`, test294). A pass bought elsewhere keeps working. | Until the pass is also sold in the app (see Money), unlocking it here is a review risk (3.1.3(b)). |
| 3 | 5.1.2(i) | Done: the extension (iOS build) and the app name the recipient and ask before the first request to a host on the internet; the local network needs no yes; withdraw under Models & API (extension) and Model (app). test295, ConsentTests. | The privacy policy already names byPhil Cloud, OpenRouter and the model provider (`plugin/src/privacy.md`); check the web copy before submitting. Desktop and Android do not ask. |
| 4 | 5.1.1(v) | Done: Settings → Account → Delete account in the extension (also deletable on byphil.eu). The app says where. | The API cancels the Stripe subscription (deployed on 2026-11-26, as reported by the owner); the confirmation says so. Apple's page asks for deletion to start in the app; whether the Safari extension counts is a review judgement: be ready to add it to the app. |
| 5 | Developer Program | Active since 2026-11-26 (Individual, team `BZKS624HDA`; renews 2027-11-27). App record "Kaivo: Read Later & AI Summary", bundle ID `eu.byphil.kaivo`, SKU `kaivo-ios`. First TestFlight build 2.2.57 (20257) uploaded 2026-11-26, from uncommitted files on top of `3c4983b7`. Later uploads: `scripts/upload-testflight.sh`. | EU trader status entered (Hamburg service address, public phone and info@byphil.eu); e-mail verified, supporting documents to be uploaded by the owner. Trader details: Hamburg service address from philwornath.com/legal as the public address (phone and e-mail open; proof such as a bill; the membership address stays). A change of the member name to the full legal name is requested. |

Review notes (draft): "Account: open Safari, open the Kaivo extension, More → Settings → Account. Delete account removes it."

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
* [x] Bundle id decided (`Config/Base.xcconfig`).
* [ ] App Store Small Business Program enrolled **before** selling (15 % instead of 26 % in the EU).
* [ ] Ukrainian, Arabic and Finnish listings: supported by App Store Connect (summary).

## Store listing

Entered on 2026-11-26 for version 1.0 (draft): name, subtitle and keywords in 28 languages, as listed in
<https://claude.ai/artifact/2VNE8SCcNvQMmkfujCNyap> (read back and compared). "Touch your knowledge" goes on the first
screenshot. Before submitting:

* [ ] Descriptions for all 28 languages are drafted in `store/descriptions.json` (`store/build.py` writes it; the twelve
      languages without an app interface say so). Entered in App Store Connect on 2026-11-26 and read back; native speakers
      have not checked them.
* [ ] Screenshots (or the English ones as fallback).
* [ ] Native speakers check names, subtitles and keywords outside German and English.
* [ ] `pdf` is a keyword: PDF summaries are not yet tested on an iPhone.
* [x] Availability: 174 countries and regions, China mainland left out (2026-11-26). TestFlight: internal group "Team".
* [ ] Set the version number in App Store Connect to the version of the build to be released (it says 1.0).

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

Decided 2026-11-26: the Support Pass becomes an App Store subscription; until then the iOS build sells nothing.
Planned, not built:

1. **App Store Connect**: paid apps agreement, tax and banking; a subscription group with monthly and yearly. Pick the
   price points nearest €4.99 and €29.94 (check what Apple offers). Enrol in the Small Business Program before selling
   (Apple pages read 2026-11-25: EU 26 %, with the program 15 %; outside the EU 15 % with it).
2. **App** (StoreKit 2): buy and "Restore purchases" live in the app, never in the extension. A StoreKit configuration
   file allows testing without App Store Connect. The app has no sign-in of its own: it needs the account to attach the
   purchase to (the session the extension hands over, or its own e-mail code sign-in).
3. **appAccountToken** must be a UUID, PocketBase ids are not: derive a UUIDv5 from the user id, or store one per user.
4. **API**: `POST /v1/webhooks/appstore` for App Store Server Notifications v2 with signature (JWS) verification; the
   entitlement gets a source (`apple` or `stripe`) and stays one record per account.
5. **One pass, one payment**: whoever has an active pass is offered nothing again; the account screen says where it is
   managed (Stripe receipt, or Apple's subscription settings).
6. **Deleting an account** cancels Stripe (on main of byphilapi, deploy pending on 2026-11-26). Apple subscriptions can only be cancelled by the buyer:
   say so in the confirmation once they exist.

# AISH library for KOReader

`aish.koplugin` keeps your **encrypted AISH library** on an e-reader running [KOReader](https://koreader.rocks):
the AI summaries, the full articles, your highlights and notes. It reads the same encrypted sync place the AISH browser
extension writes to your own Nextcloud/WebDAV folder, and decrypts it on the reader. Nothing goes anywhere else.

Highlights and notes go **both ways**: what you mark on the reader appears in the extension, and the other way round.

## What you get

- a folder `AISH` in KOReader's home folder, one HTML file per article:
  the title and source, the **AI summary**, the **full text**, and **your notes on the article** at the end;
- **highlights as KOReader highlights**: when you open an article, your AISH highlights appear as KOReader highlights
  (AI highlights underlined) with their comment as the note;
- **back to AISH**: a highlight you make on the reader becomes an AISH highlight (with the words around it, as the
  extension saves them); its note becomes the comment. Editing a note edits the comment, removing a highlight deletes it
  (an AI highlight is dismissed), and opening an article marks it read. These go out when you close the article
  (when Wi-Fi is on; *Send changes when closing an article*) or at the next sync;
- AISH **collections** as KOReader collections named `AISH: <name>`;
- an article deleted in AISH is removed from the reader at the next sync (with its KOReader sidecar);
  renaming an article keeps its file, so your reading position stays;
- each sync downloads only the files that changed (ETags); a file that cannot be read is skipped and tried again later.

How the two sides agree: every record carries per-field time stamps, and the reader merges exactly like the extension
(newer field wins, a deletion marker beats older edits; same hashes and rules, checked against the extension's test vector).
A file is written only if the server's copy is still the one the reader knows (`If-Match`); if another device wrote it
first, the two are merged and it is sent again. A server copy that cannot be read is never overwritten.
When a note was changed on both sides since the last sync, the reader's wins.

Feed stubs (feed items not summarized yet) are left out. Images are not downloaded yet: their description stays in the text.

## Install

1. Copy the folder `aish.koplugin` into KOReader's `plugins` folder
   (Kobo: `.adds/koreader/plugins/`, Kindle: `koreader/plugins/`, Android: `koreader/plugins/` on the storage).
2. Restart KOReader. The menu is **Tools (🛠) → AISH library**.

## Connect

**With Nextcloud (recommended): Tools → AISH library → Connect with Nextcloud (QR code).** Enter the address of your
Nextcloud and the folder of the AISH place. The reader shows a QR code: scan it with your phone, log in there and allow
access. The reader gets **its own login** ("AISH KOReader" in Nextcloud → Settings → Security → Devices & sessions);
nothing is typed on the reader. Then it asks once for the passphrase of the library.

Other ways:

- **Connect with a code**: in the extension, **Settings → Sync & backup →** your *encrypted* place **→ Show code for the
  phone → Save code as file (KOReader)**. Copy `aish-library.txt` into KOReader's home folder (over USB) and choose
  *Connect with a code*; the file is deleted after reading (it holds your login), delete it from the computer too.
  On KOReader for Android the code can also be pasted.
- **Connect manually**: WebDAV address (Nextcloud: `https://host/remote.php/dav/files/<user>/`), user, app password, folder.

**Sync now** in the menu, or put **AISH: sync library** on a gesture (Settings → Taps and gestures).

## If the reader is lost

1. In Nextcloud: **Settings → Security → Devices & sessions → AISH KOReader → Wipe device**. The reader's login stops
   working at once. The next time the reader is online, the plugin asks Nextcloud, deletes the AISH articles, the
   library data, the login and the key, and tells Nextcloud it is done
   ([Nextcloud remote wipe](https://docs.nextcloud.com/server/stable/developer_manual/client_apis/RemoteWipe/index.html)).
   This needs the login made with *Connect with Nextcloud*; a login from a code or typed by hand can only be revoked.
2. If you also distrust the library key that was on the reader: set the encrypted place up again in the extension
   (new key) and connect your devices again.

**Give the reader as little as possible:** a Nextcloud login reaches the whole account (files, calendar, contacts).
Make a Nextcloud user just for the reader (e.g. `phil-reader`), share only the AISH folder with it (with edit rights),
and log the reader in as that user. A lost reader then exposes only that folder, and its content is encrypted.

**PIN (optional): Protect login and key with a PIN.** The login and the library key are sealed with a PIN of at least 6
digits (PBKDF2-SHA256, 600,000 rounds → AES-256-GCM); KOReader asks for it once after each start, when the library is
synced. It keeps the settings of a lost reader from giving away your login. Honestly: someone with the copied files and
enough computing power can still try every 6-digit PIN, and the articles already on the reader stay readable (KOReader
opens them as plain files, and e-readers do not encrypt their storage).

## Security

- Decryption happens on the reader with KOReader's own libcrypto (LibreSSL) and zlib, the same scheme as the extension:
  PBKDF2-SHA256 (600,000 rounds) → HKDF → AES-256-GCM. The passphrase is not saved; the key derived from it is
  (in KOReader's settings, sealed when the PIN is on), so later syncs do not repeat the key derivation.
  **Disconnect** forgets login and key, and gives a Nextcloud login made by QR code back to Nextcloud.
- The articles on the reader are plain HTML files, as with any other book on the device.
- Each record is checked: a file whose name does not match the record inside (copied or swapped on the server) is refused.
- The reader writes only what you changed on it (highlights, comments, read marks); it never deletes files on the server.
- S3 places and readable (unencrypted) places are not supported yet.

## Development

```
luajit koreader/tests/run.lua          # the Lua modules: crypto, hashes and merges against plugin/tests/fixtures/sync-vector.json,
                                       # highlight reconciling, conditional writes and the 412 merge, rendering
bash koreader/tests/interop.sh         # the extension's own sync engine and the plugin, both ways, over wsgidav with a login
```
Needs `luajit`, `lua-socket`, `node` and `pip install wsgidav cheroot`. CI runs both (job `koreader`).

Layout: `main.lua` (KOReader menu, dialogs, collections) · `aishlib/crypto.lua` · `aishlib/webdav.lua` ·
`aishlib/library.lua` (pull, push, files) · `aishlib/stamps.lua` (hashes, merge) · `aishlib/annots.lua` (KOReader
highlights ↔ AISH) · `aishlib/render.lua` · `aishlib/marks.lua` · `aishlib/code.lua` · `aishlib/json.lua`.

## Not yet

S3 places, images in articles, reading progress (KOReader's percentage has no place in AISH yet).

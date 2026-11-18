# AISH library for KOReader

`aish.koplugin` keeps your **encrypted AISH library** on an e-reader running [KOReader](https://koreader.rocks):
the AI summaries, the full articles, your highlights and notes. It reads the same encrypted sync place the AISH browser
extension writes to your own Nextcloud/WebDAV folder, and decrypts it on the reader. Nothing goes anywhere else.

**Stage 1 (this version) is read-only**: it never writes to the server.

## What you get

- a folder `AISH` in KOReader's home folder, one HTML file per article:
  the title and source, the **AI summary**, the **full text** with **your highlights** (grey) and **AI highlights**
  (underlined), **notes on a highlight** as footnotes (tap the number), and **your notes on the article** at the end;
- AISH **collections** as KOReader collections named `AISH: <name>`;
- an article deleted in AISH is removed from the reader at the next sync (with its KOReader sidecar);
  renaming an article keeps its file, so your reading position stays;
- each sync downloads only the files that changed (ETags); a file that cannot be read is skipped and tried again later.

Feed stubs (feed items not summarized yet) are left out. Images are not downloaded yet: their description stays in the text.

## Install

1. Copy the folder `aish.koplugin` into KOReader's `plugins` folder
   (Kobo: `.adds/koreader/plugins/`, Kindle: `koreader/plugins/`, Android: `koreader/plugins/` on the storage).
2. Restart KOReader. The menu is **Tools (🛠) → AISH library**.

## Connect

In the extension: **Settings → Sync & backup →** your *encrypted* place **→ Show code for the phone →
Save code as file (KOReader)**. That saves `aish-library.txt` (the code `aish-library://v1?…`). Then either

- copy **`aish-library.txt`** into KOReader's home folder (over USB) and choose **Connect with a code**.
  The file is deleted after reading (it holds your login); delete it from the computer too, or
- paste the code into the dialog of **Connect with a code** (KOReader on Android), or
- **Connect manually**: WebDAV address (Nextcloud: `https://host/remote.php/dav/files/<user>/`), user, app password, folder.

When the code carries the suggested words, the library unlocks right away; otherwise KOReader asks for the passphrase once.

**Sync now** in the menu, or put **AISH: sync library** on a gesture (Settings → Taps and gestures).

## Security

- Decryption happens on the reader with KOReader's own libcrypto (LibreSSL) and zlib, the same scheme as the extension:
  PBKDF2-SHA256 (600,000 rounds) → HKDF → AES-256-GCM. The passphrase is not saved; the key derived from it is
  (in KOReader's settings), so later syncs do not repeat the key derivation. **Disconnect** forgets login and key.
- The articles on the reader are plain HTML files, as with any other book on the device.
- Each record is checked: a file whose name does not match the record inside (copied or swapped on the server) is refused.
- S3 places and readable (unencrypted) places are not supported yet.

## Development

```
luajit koreader/tests/run.lua          # the Lua modules (crypto against plugin/tests/fixtures/sync-vector.json, marks, rendering)
bash koreader/tests/interop.sh         # a place made by the extension's own sync engine, served by wsgidav, pulled by the plugin
```
Needs `luajit`, `lua-socket`, `lua-cjson`, `node` and `pip install wsgidav cheroot`. CI runs both (job `koreader`).

Layout: `main.lua` (KOReader menu, dialogs, collections) · `aishlib/crypto.lua` · `aishlib/webdav.lua` ·
`aishlib/library.lua` (pull + files) · `aishlib/render.lua` · `aishlib/marks.lua` · `aishlib/code.lua` · `aishlib/json.lua`.

## Next (stage 2)

Highlights and notes made in KOReader go back to AISH (as `hl` / `note` records with field stamps, the extension's merge rules),
reading state and progress, S3 places.

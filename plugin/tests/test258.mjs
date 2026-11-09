// The build slims _locales (plugin/scripts/slim-locales.mjs): unused keys out, translator notes only in en, no indentation.
// Nothing the extension asks for may go missing: every T()/TN()/data-i18n/__MSG__/getMessage key stays, in every locale.
import assert from 'assert'; import fs from 'fs'; import os from 'os'; import path from 'path'; import { pathToFileURL } from 'url';
const SRC = process.env.AISH_SRC;
const { slimLocales, usedKeys } = await import(pathToFileURL(path.join(SRC, '..', 'scripts', 'slim-locales.mjs')).href);
const { extract } = await import(pathToFileURL(path.join(SRC, '..', '..', 'scripts', 'feed-i18n.mjs')).href);
const { i18nKey } = await import(pathToFileURL(path.join(SRC, 'modules', 'i18nKey.js')).href);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aish-loc-'));
fs.cpSync(path.join(SRC, '_locales'), path.join(tmp, '_locales'), { recursive: true });
const en = JSON.parse(fs.readFileSync(path.join(SRC, '_locales', 'en', 'messages.json'), 'utf8'));
const err = console.error; console.error = () => {};   // extract() warns about popup.html attribute mismatches
const strings = extract(); console.error = err;
const r = slimLocales(tmp, SRC);
assert(r.locales >= 25 && r.after < r.before * 0.85, 'smaller: ' + JSON.stringify(r));
const required = new Set(strings.map(i18nKey).filter((k) => k in en));
// named keys the code and manifests use
const html = fs.readFileSync(path.join(SRC, 'popup.html'), 'utf8');
for (const m of html.matchAll(/data-i18n(?:-title|-aria|-placeholder)?="([^"]+)"/g)) if (m[1] in en) required.add(m[1]);
for (const p of ['chrome', 'firefox', 'android', 'ios']) for (const m of fs.readFileSync(path.join(SRC, '..', 'platforms', p, 'manifest.json'), 'utf8').matchAll(/__MSG_(\w+)__/g)) required.add(m[1]);
for (const k of ['ctxSpeedRead', 'ctxSummarizePage', 'notifReopen', 'settingsBack']) required.add(k);
const used = usedKeys(en, SRC);
for (const k of required) assert(used.has(k), 'needed key dropped: ' + k + ' ' + JSON.stringify(en[k]));
for (const l of fs.readdirSync(path.join(tmp, '_locales'))) {
  const raw = fs.readFileSync(path.join(tmp, '_locales', l, 'messages.json'), 'utf8');
  assert(!raw.includes('\n'), l + ': no indentation');
  const m = JSON.parse(raw);
  for (const k of required) assert(k in m, `${l} lost ${k}`);
  if (l !== 'en') assert(!Object.values(m).some((v) => v.description), l + ': notes only in en');
}
const built = JSON.parse(fs.readFileSync(path.join(tmp, '_locales', 'en', 'messages.json'), 'utf8'));
assert(Object.values(built).some((v) => v.description), 'en keeps its notes');
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`TEST 258 OK (${r.dropped} unused keys, ${Math.round(r.before / 1024)} → ${Math.round(r.after / 1024)} KB)`); process.exit(0);

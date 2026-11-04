// The Android app and the extension share one look: the core colours of both must agree, so a change on one side is noticed on the other.
import assert from 'assert';
import fs from 'fs'; import path from 'path';
const root = path.resolve(process.env.AISH_SRC, '..', '..');
const kt = fs.readFileSync(path.join(root, 'mobile/android/app/src/main/java/eu/byphil/aishcompanion/Theme.kt'), 'utf8');
const notes = fs.readFileSync(path.join(root, 'mobile/android/app/src/main/java/eu/byphil/aishcompanion/NotesScreen.kt'), 'utf8');

// the extension's colours as the token pipeline resolves them (design-system/dist/tokens.resolved.json, default brand)
const resolved = JSON.parse(fs.readFileSync(path.join(root, 'design-system/dist/tokens.resolved.json'), 'utf8')).aish.app;
const hexOf = (mode, name) => { const t = resolved[mode][name]; assert.ok(t, name + ' missing'); return /#[0-9a-fA-F]{6}/.exec(t.value)[0].toLowerCase(); };
const tokenAfter = (from, name) => hexOf(from, name);
const darkFrom = 'dark';
const kotlin = (scheme, field) => { const b = kt.slice(kt.indexOf(scheme + ' = ')); const m = new RegExp('\\b' + field + ' = Color\\(0xFF([0-9A-Fa-f]{6})\\)').exec(b); assert.ok(m, scheme + '.' + field); return '#' + m[1].toLowerCase(); };

const pairs = [['primary', '--accent'], ['background', '--bg-page'], ['onSurface', '--text-primary'], ['onSurfaceVariant', '--text-muted']];
for (const [field, token] of pairs) {
    assert.equal(kotlin('private val Light', field), tokenAfter('light', token), `light ${field} ↔ ${token}`);
    assert.equal(kotlin('private val Dark', field), tokenAfter(darkFrom, token), `dark ${field} ↔ ${token}`);
}
assert.equal(kotlin('private val Light', 'error'), tokenAfter('light', '--danger'), 'light error ↔ --danger');

// the stickies of the Notes tab: the extension's note colours
const st = (mode) => Object.fromEntries(['bg', 'fg', 'bar'].map((k) => [k, hexOf(mode, '--saved-note-note-' + k)]));
const lightSt = st('light');
const darkSt = st('dark');
const sticky = [...notes.matchAll(/Sticky\(Color\(0xFF([0-9A-F]{6})\), Color\(0xFF([0-9A-F]{6})\), Color\(0xFF([0-9A-F]{6})\)/g)].map((m) => ({ bg: '#' + m[1].toLowerCase(), fg: '#' + m[2].toLowerCase(), bar: '#' + m[3].toLowerCase() }));
assert.equal(sticky.length, 2, 'a dark and a light sticky');
assert.deepEqual(sticky[0], darkSt, 'dark sticky ↔ --saved-note-note-* (dark)'); assert.deepEqual(sticky[1], lightSt, 'light sticky ↔ --saved-note-note-* (light)');
console.log('TEST 215 OK');

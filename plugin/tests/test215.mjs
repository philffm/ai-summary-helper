// The Android app and the extension share one look: the core colours of both must agree, so a change on one side is noticed on the other.
import assert from 'assert';
import fs from 'fs'; import path from 'path';
const root = path.resolve(process.env.AISH_SRC, '..', '..');
const css = fs.readFileSync(path.resolve(process.env.AISH_SRC, 'styles.css'), 'utf8');
const kt = fs.readFileSync(path.join(root, 'mobile/android/app/src/main/java/eu/byphil/aishcompanion/Theme.kt'), 'utf8');
const notes = fs.readFileSync(path.join(root, 'mobile/android/app/src/main/java/eu/byphil/aishcompanion/NotesScreen.kt'), 'utf8');

const tokenAfter = (from, name) => { const i = css.indexOf(name + ':', from); assert.ok(i >= 0, name + ' missing'); return /#[0-9a-fA-F]{6}/.exec(css.slice(i, css.indexOf(';', i)))[0].toLowerCase(); };
const darkFrom = css.indexOf('/* ── Dark Mode');
const kotlin = (scheme, field) => { const b = kt.slice(kt.indexOf(scheme + ' = ')); const m = new RegExp('\\b' + field + ' = Color\\(0xFF([0-9A-Fa-f]{6})\\)').exec(b); assert.ok(m, scheme + '.' + field); return '#' + m[1].toLowerCase(); };

const pairs = [['primary', '--accent'], ['background', '--bg-page'], ['onSurface', '--text-primary'], ['onSurfaceVariant', '--text-muted']];
for (const [field, token] of pairs) {
    assert.equal(kotlin('private val Light', field), tokenAfter(0, token), `light ${field} ↔ ${token}`);
    assert.equal(kotlin('private val Dark', field), tokenAfter(darkFrom, token), `dark ${field} ↔ ${token}`);
}
assert.equal(kotlin('private val Light', 'error'), tokenAfter(0, '--danger'), 'light error ↔ --danger');

// the stickies of the Notes tab: the extension's note colours
const st = (line) => Object.fromEntries([...line.matchAll(/--st-note-(bg|fg|bar):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2].toLowerCase()]));
const lightSt = st(/^:root \{ --st-user-bg[^\n]*/m.exec(css)[0]);
const darkSt = st(/^:root\[data-theme='dark'\] \{ --st-user-bg[^\n]*/m.exec(css)[0]);
const sticky = [...notes.matchAll(/Sticky\(Color\(0xFF([0-9A-F]{6})\), Color\(0xFF([0-9A-F]{6})\), Color\(0xFF([0-9A-F]{6})\)/g)].map((m) => ({ bg: '#' + m[1].toLowerCase(), fg: '#' + m[2].toLowerCase(), bar: '#' + m[3].toLowerCase() }));
assert.equal(sticky.length, 2, 'a dark and a light sticky');
assert.deepEqual(sticky[0], darkSt, 'dark sticky ↔ --st-note-* (dark)'); assert.deepEqual(sticky[1], lightSt, 'light sticky ↔ --st-note-* (light)');
console.log('TEST 215 OK');

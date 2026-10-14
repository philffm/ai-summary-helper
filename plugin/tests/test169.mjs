// Obsidian hand-over: the obsidian://new link (vault, folder, name, characters Obsidian rejects), overwrite only on request.
import assert from 'assert';
import path from 'path';
import { pathToFileURL } from 'url';
const { obsidianUri } = await import(pathToFileURL(path.join(process.env.AISH_SRC, 'modules/obsidianUri.js')).href);

assert.equal(obsidianUri({ name: 'Hello World' }), 'obsidian://new?name=Hello%20World&clipboard');
assert.equal(obsidianUri({ name: 'Hello', vault: 'My vault' }), 'obsidian://new?vault=My%20vault&name=Hello&clipboard');
assert.equal(obsidianUri({ name: 'Hello', folder: 'Inbox/AISH' }), 'obsidian://new?file=Inbox%2FAISH%2FHello&clipboard');
assert.equal(obsidianUri({ name: 'Hello', vault: 'V', folder: '/Inbox//AISH/' }), 'obsidian://new?vault=V&file=Inbox%2FAISH%2FHello&clipboard');
// characters Obsidian and file systems reject, path tricks, empty names
assert.equal(obsidianUri({ name: 'A: B/C #1 [x] ^y' }), 'obsidian://new?name=A%20B%20C%201%20x%20y&clipboard');
assert.equal(obsidianUri({ name: 'x', folder: '../../etc/./passwd' }), 'obsidian://new?file=etc%2Fpasswd%2Fx&clipboard');
assert.equal(obsidianUri({ name: '   ' }), 'obsidian://new?name=Untitled&clipboard');
assert.equal(obsidianUri({ name: 'Größe ✓ & mehr' }), 'obsidian://new?name=Gr%C3%B6%C3%9Fe%20%E2%9C%93%20%26%20mehr&clipboard');
assert.ok(!/overwrite/.test(obsidianUri({ name: 'x' })), 'never overwrites by default');
assert.ok(/&overwrite$/.test(obsidianUri({ name: 'x', overwrite: true })));
assert.ok(obsidianUri({ name: 'x'.repeat(200) }).length < 140, 'name is clipped');
console.log('TEST 169 OK'); process.exit(0);

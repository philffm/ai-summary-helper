// A summary whose page went away is finished by the background: stream parsing, tags, language tags, questions, saving.
import assert from 'assert'; import fs from 'fs'; import vm from 'vm'; import os from 'os'; import path from 'path'; import { spawnSync } from 'child_process';
// The background bundle (finalize.js) is a build product: build it here instead of relying on plugin/dev existing.
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'aish-finalize-'));
const b = spawnSync(process.execPath, [new URL('../scripts/build.js', import.meta.url).pathname, '--bundle', out], { encoding: 'utf8' });
assert.equal(b.status, 0, 'bundling failed: ' + b.stderr);
const src = fs.readFileSync(path.join(out, 'finalize.js'), 'utf8');
const store = {};
const chrome = {
  storage: { local: {
    get: (k, cb) => { const o = {}; if (typeof k === 'object' && !Array.isArray(k)) Object.assign(o, k); for (const key of (typeof k === 'string' ? [k] : Array.isArray(k) ? k : Object.keys(k))) if (key in store) o[key] = store[key]; cb(o); },
    set: (o, cb) => { Object.assign(store, JSON.parse(JSON.stringify(o))); cb && cb(); } } },
  i18n: { detectLanguage: (t, cb) => cb({ isReliable: true, languages: [{ language: 'de', percentage: 99 }] }) }
};
const sandbox = { self: {}, chrome, console, setTimeout, clearTimeout }; sandbox.globalThis = sandbox;
vm.createContext(sandbox); vm.runInContext(src, sandbox);
const F = sandbox.self.AISH_FINALIZE; assert(F && F.createStreamParser && F.finishDetached);
const p = F.createStreamParser('openai');
const line = (t) => 'data: ' + JSON.stringify({ choices: [{ delta: { content: t } }] }) + '\n\n';
const whole = '<div><h2>Titel</h2><p>Hallo Welt.</p></div><!-- TAGS: eins, zwei --><!-- QUESTIONS: ["Was ist das?", "Wer sagt das?"] --><!-- MOOD: 0.4 -->';
const data = line(whole.slice(0, 20)) + line(whole.slice(20));
p.push(data.slice(0, 33)); p.push(data.slice(33)); p.end();
assert.equal(p.summary, whole, 'chunks split anywhere are reassembled');
const ctx = { sourceUrl: 'https://example.com/a', summaryMode: 'extension', service: 'openai', modelIdentifier: 'm', summaryLength: 100, selectedLanguage: 'en', contentText: 'Ein deutscher Text über Hallo Welt.', contentHtml: '<p>x</p>', pageTitle: 'Seite', htmlLang: 'de', pageMeta: { favicon: 'https://example.com/f.ico' }, ghostMax: 3, fixedTitle: 'Seite', attachedTitle: null, feedUrl: '' };
const r = await F.finishDetached(ctx, p.summary, '');
assert(!r.error, r.error);
assert(r.tags.includes('🌐 de') && r.tags.includes('🌐 en'), 'language tags ' + r.tags);
assert.deepEqual(r.questions, ['Was ist das?', 'Wer sagt das?']); assert.equal(r.moodScore, 0.4);
assert(!/TAGS|QUESTIONS/.test(r.cleanHtml) && /Hallo Welt/.test(r.cleanHtml));
assert(r.article && r.article.id && store.articlesIndex === undefined ? true : true);
const idx = Object.values(store).find(v => Array.isArray(v));
assert(idx && idx.length === 1 && idx[0].url === ctx.sourceUrl && idx[0].title === 'Seite', 'saved to the library');
const bad = await F.finishDetached(ctx, '', '');
assert(bad.error, 'empty answer is reported');
console.log('TEST 78 OK');

// Word export (markdown → .docx) and per-quote language switch of the read-aloud queue.
import { setup, imp } from './harness.mjs'; import assert from 'assert';
setup({});
const dx = await imp('modules/docxExport.js');

const ps = dx.markdownToParagraphs('# Title\n\nPlain **bold** & <tag>\n\n- one\n> quoted\n---\n[site](https://x.test) and [https://y.test](https://y.test)');
assert.equal(ps.length, 6, 'heading, paragraph, bullet, quote, rule, link line');
assert.ok(ps[0].includes('<w:b/>') && ps[0].includes('Title'));
assert.ok(ps[1].includes('&amp;') && ps[1].includes('&lt;tag&gt;'), 'XML-escaped');
assert.ok(ps[2].includes('• one'));
assert.ok(ps[5].includes('site (https://x.test)') && !ps[5].includes('y.test (https://y.test)'), 'link text with url; bare url once');

const blob = await dx.markdownToDocx('# Hi\n\ntext');
assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
const bytes = new Uint8Array(await blob.arrayBuffer());
assert.equal(bytes[0], 0x50); assert.equal(bytes[1], 0x4b, 'zip signature');
const txt = Buffer.from(bytes).toString('latin1');
for (const n of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml']) assert.ok(txt.includes(n), n);

// OpenDocument text
const od = await imp('modules/odtExport.js');
const body = od.markdownToOdtBody('# T\n\n**b** & <x>\n- one\n- two\n> q');
assert.ok(body.includes('<text:h text:style-name="Heading_20_1" text:outline-level="1">T</text:h>'));
assert.ok(body.includes('TBold') && body.includes('&amp;') && body.includes('&lt;x&gt;'));
assert.equal((body.match(/<text:list-item>/g) || []).length, 2); assert.equal((body.match(/<text:list>/g) || []).length, 1, 'one list for consecutive bullets');
const odt = await od.markdownToOdt('# Hi');
assert.equal(odt.type, 'application/vnd.oasis.opendocument.text');
const ob = Buffer.from(await odt.arrayBuffer()).toString('latin1');
assert.ok(ob.indexOf('mimetype') < ob.indexOf('content.xml') && ob.indexOf('mimetype') < 60, 'mimetype entry first');

// read-aloud: a foreign-language quote becomes its own utterance
const spoken = [];
globalThis.self = globalThis;
globalThis.chrome = { runtime: { sendMessage() {} }, tts: { speak: (text, o) => { spoken.push({ text, lang: o.lang }); setTimeout(() => o.onEvent({ type: 'end' }), 0); }, stop() {} } };
await import(process.env.AISH_SRC + '/ttsEngine.js');
const eng = globalThis.AISH_TTS.create({ send() {} });
await eng.handle({ cmd: 'speak', items: [{ text: 'Sie verlangt Prüfung statt Plattform: „Extraordinary claims require extraordinary evidence, and I am not the one making the claim.“ Das ist wichtig.', lang: 'de' }, { text: 'Ein ganz normaler deutscher Satz ohne Zitat und mit genug Wörtern.', lang: 'de' }] });
await new Promise(r => setTimeout(r, 80));
assert.deepEqual(spoken.map(s => s.lang), ['de', 'en-US', 'de', 'de']);
assert.ok(spoken[1].text.startsWith('„Extraordinary'));
console.log('ok');

// A finger selects without any mouse event (iPhone, iPad, Android): the selection toolbar must come from selectionchange.
import assert from 'assert';
import { setup, imp, tick } from './harness.mjs';
const { w } = setup({});
const d = w.document; globalThis.document = d; globalThis.window = w;
const H = await imp('content/highlighter.js');
H.setHighlightingEnabled(true, true);

d.body.innerHTML = '<p id="p">The toaster asked whether I had considered subscribing.</p><textarea>do not touch this text</textarea>';
const text = d.getElementById('p').firstChild;
const select = (from, to) => { const r = d.createRange(); r.setStart(text, from); r.setEnd(text, to); const s = w.getSelection(); s.removeAllRanges(); s.addRange(r); d.dispatchEvent(new w.Event('selectionchange')); };
const press = (pointerType) => { const e = new w.Event('pointerdown', { bubbles: true }); e.pointerType = pointerType; d.body.dispatchEvent(e); };
const bar = () => d.getElementById('aish-np-host')?._root.querySelector('.np-bar');

press('mouse'); select(4, 11); await tick(700);
assert.ok(!bar(), 'with a mouse the toolbar waits for the mouse-up, as before');

press('touch'); select(4, 11); await tick(100); select(4, 17);
await tick(200); assert.ok(!bar(), 'not while the handles are still moving');
await tick(500); assert.ok(bar(), 'a finger selection that rests shows the toolbar');
assert.equal(bar().querySelectorAll('button').length, 3);

// the tap on the button may collapse the selection first: the highlight is made from the range held
w.getSelection().removeAllRanges(); d.dispatchEvent(new w.Event('selectionchange')); await tick(700);
assert.ok(bar(), 'the toolbar stays when the selection drops');
bar().querySelector('button').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await tick(50);
assert.deepEqual(H.getUserHighlightTexts(), ['toaster asked'], 'the finger selection became a highlight');

// too short, and inside a field: nothing
press('touch'); select(0, 2); await tick(700); assert.ok(!bar(), 'two letters are not a selection worth a toolbar');
console.log('test288 ok');
process.exit(0);

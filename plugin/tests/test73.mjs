// Chat answers: markdown tables, headings, lists, inline styles render as DOM (no innerHTML).
import { setup, imp } from './harness.mjs'; import assert from 'assert';
const { w } = setup({}); const d = w.document; globalThis.document = d; globalThis.window = w;
const { renderAnswer } = await imp('modules/qaView.js');
const el = d.createElement('div');
renderAnswer(el, `## Zusammenfassung im Vergleich
| Merkmal | Self-Attention | Cross-Attention |
| :--- | :--- | :--- |
| Hauptfunktion | Kontext **innerhalb** einer Sequenz. | Kontext zwischen zwei Sequenzen. |
| Ort im Modell | Encoder und Decoder. | Nur im Decoder. |

Danach ein Absatz mit \`code\` und *kursiv*.

- eins
- zwei

1. a
2. b`);
assert.equal(el.querySelector('h3.md-h').textContent, 'Zusammenfassung im Vergleich');
const t = el.querySelector('.md-table-wrap table.md-table');
assert(t, 'table rendered even without a blank line after the heading');
assert.deepEqual([...t.tHead.rows[0].cells].map(c => c.textContent), ['Merkmal', 'Self-Attention', 'Cross-Attention']);
assert.equal(t.tBodies[0].rows.length, 2); assert.equal(t.tBodies[0].rows[0].cells[1].querySelector('strong').textContent, 'innerhalb');
assert(el.querySelector('code') && el.querySelector('em') && el.querySelector('ul li') && el.querySelector('ol li'));
assert(!/\|/.test(el.textContent), 'no raw pipes left');
const e2 = d.createElement('div'); renderAnswer(e2, 'Just a | pipe in text\nand 2 * 3 * 4'); assert.equal(e2.querySelectorAll('table').length, 0); assert(e2.textContent.includes('2 * 3 * 4'));
const e3 = d.createElement('div'); renderAnswer(e3, '| a | b |\n| - | - |\n| 1 |'); assert.equal(e3.querySelector('tbody tr').cells.length, 2, 'short rows are padded');
console.log('TEST 73 OK'); process.exit(0);

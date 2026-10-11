// Monthly AI allowance bar (account settings) + the server's budget error codes mapped to friendly messages.
import assert from 'assert';
import fs from 'fs';
import { setup, imp } from './harness.mjs';
const { w } = setup({});
const d = w.document; globalThis.document = d; globalThis.window = w;
const { renderQuota } = await imp('modules/authManager.js');
const host = d.createElement('div'); const badge = d.createElement('span'); host.append(badge); d.body.append(host);

renderQuota(badge, { percent: 40, used_usd: 0.6, limit_usd: 1.5, reset_at: '2026-11-01T00:00:00.000Z' });
let box = host.querySelector('.ai-quota');
assert.ok(box, 'bar shown'); assert.equal(host.children[1], box, 'right under the plan badge');
assert.equal(box.querySelector('.ai-quota-pct').textContent, '40% used');
const bar = box.querySelector('.ai-quota-bar');
assert.equal(bar.getAttribute('role'), 'progressbar'); assert.equal(bar.getAttribute('aria-valuenow'), '40'); assert.equal(bar.firstElementChild.style.width, '40%');
assert.ok(!/\$|usd/i.test(box.textContent), 'percent only, no money amounts');
assert.ok(!box.classList.contains('warn') && !box.classList.contains('full'));

renderQuota(badge, { percent: 85, reset_at: '2026-11-01T00:00:00.000Z' });
assert.equal(host.querySelectorAll('.ai-quota').length, 1, 'updated in place');
assert.ok(host.querySelector('.ai-quota').classList.contains('warn')); assert.ok(/lighter model/.test(host.querySelector('.ai-quota-note').textContent));
renderQuota(badge, { percent: 100, reset_at: 'nonsense' });
assert.ok(host.querySelector('.ai-quota').classList.contains('full')); assert.ok(/local models still work/.test(host.querySelector('.ai-quota-note').textContent));
renderQuota(badge, { percent: 250 }); assert.equal(host.querySelector('.ai-quota-bar').getAttribute('aria-valuenow'), '100', 'clamped');
renderQuota(badge, null); assert.ok(!host.querySelector('.ai-quota'), 'free / unmetered accounts: no bar');

// friendly messages for the server's codes (background.js + content.js hold their own copy of the mapping)
for (const f of ['background.js', 'content.js']) {
    const src = fs.readFileSync(new URL('../src/' + f, import.meta.url), 'utf8');
    const at = src.search(/function (?:aiFriendlyError|friendlyLimitError)\(/);
    assert.ok(at >= 0, f + ': function found');
    let i = src.indexOf('{', at), depth = 0, j = i;
    for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}' && --depth === 0) break; }
    const code = src.slice(at, j + 1);
    const params = code.match(/\(([^)]*)\)/)[1];
    const fn = new Function(`${code}; return ${code.match(/function (\w+)/)[1]};`)();
    const call = (txt) => fn(...(params.includes(',') ? [429, txt] : [txt]));
    assert.match(call('{"code":"quota_exceeded"}'), /monthly AI allowance is used up/, f);
    assert.match(call('{"code":"rate_limited"}'), /Too many AI requests/, f);
    assert.match(call('{"code":"too_large"}'), /too much text/, f);
    assert.match(call('Free trial exhausted (3 requests per day)'), /daily/, f + ': old wording unchanged');
}
console.log('TEST 144 OK');

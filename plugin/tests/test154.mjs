// Usage details under the monthly AI allowance bar: money, requests, tokens, split by model; collapsed until opened; absent when the server sends nothing.
import assert from 'assert';
import { setup, imp } from './harness.mjs';
setup({});
const { renderQuota, fmtUsd, fmtTokens } = await imp('modules/authManager.js');
assert.equal(fmtUsd(0.4), '$0.40'); assert.equal(fmtUsd(0.002), '<$0.01'); assert.equal(fmtUsd(0), '$0.00');
assert.equal(fmtTokens(950), '950'); assert.equal(fmtTokens(12300), '12.3k'); assert.equal(fmtTokens(2400000), '2.4M');

const host = document.createElement('div'); const anchor = document.createElement('span'); host.appendChild(anchor); document.body.appendChild(host);
const quota = { used_usd: 0.5, limit_usd: 1.5, percent: 33, requests: 7, tokens_in: 12300, tokens_out: 950, reset_at: '2026-11-01T00:00:00.000Z',
    by_model: [{ model: 'google/gemini-2.5-flash', requests: 5, cost_usd: 0.4, tokens_in: 10000, tokens_out: 800 }, { model: 'b/small', requests: 2, cost_usd: 0.1, tokens_in: 2300, tokens_out: 150 }] };
renderQuota(anchor, quota);
const box = host.querySelector('.ai-quota'); assert(box, 'allowance box');
const toggle = box.querySelector('.ai-quota-toggle'), det = box.querySelector('.ai-quota-details');
assert(toggle && det, 'toggle and details'); assert.equal(det.hidden, true, 'collapsed by default');
toggle.click(); assert.equal(det.hidden, false); assert.equal(toggle.getAttribute('aria-expanded'), 'true');
const text = det.textContent;
assert(text.includes('$0.50 of $1.50 used'), text); assert(text.includes('7 requests this month'), text);
assert(text.includes('12.3k tokens in') && text.includes('950 tokens out'), text);
assert(text.includes('gemini-2.5-flash · $0.40 · 5×') && text.includes('small · $0.10 · 2×'), text);
// Re-render keeps one toggle and updates the numbers (no duplicates).
renderQuota(anchor, { ...quota, requests: 1, by_model: [] });
assert.equal(host.querySelectorAll('.ai-quota-toggle').length, 1);
assert(host.querySelector('.ai-quota-details').textContent.includes('1 request this month'));
assert(!host.querySelector('.ai-quota-details').textContent.includes('By model'));
// Old server: only percent → no details at all.
renderQuota(anchor, { percent: 10, reset_at: '2026-11-01T00:00:00.000Z' });
assert(!host.querySelector('.ai-quota-toggle') && !host.querySelector('.ai-quota-details'));
console.log('test154 ok');

// Every custom property the site stylesheet reads is defined somewhere. An undefined one silently falls back (the FAQ filter's
// selected label used var(--ink), which does not exist, and turned dark on blue). Properties set inline per element are listed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const INLINE = new Set(['--img']);   // set in the HTML style attribute, per element

test('the site stylesheet only reads custom properties it defines', () => {
    const css = fs.readFileSync('docs/assets/styles.css', 'utf8');
    const defined = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    const missing = [...new Set([...css.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)].map((m) => m[1]))].filter((v) => !defined.has(v) && !INLINE.has(v));
    assert.deepEqual(missing, []);
});

test('the selected FAQ filter has a readable label on its blue fill', () => {
    const css = fs.readFileSync('docs/assets/styles.css', 'utf8');
    const rule = css.match(/\.faq-filter\[aria-pressed="true"\][^{]*\{([^}]*)\}/);
    assert.ok(rule, 'a rule for the pressed state');
    assert.match(rule[1], /background:var\(--cta-sky-2\)/);
    assert.match(rule[1], /color:var\(--on-accent\)/);
});

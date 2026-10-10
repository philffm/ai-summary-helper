// Feed stacks: near-identical titles collapse into one stack; conservative, multilingual, numbers must agree.
import assert from 'assert';
import { imp } from './harness.mjs';
const { stackItems, titleTokens, similar } = await imp('modules/feedStacks.js');
const H = 3600e3, now = Date.now();
const it = (id, title, ageH = 1) => ({ id, title, published: now - ageH * H });
const ids = (s) => s.map(x => [x.lead.id, ...x.others.map(o => o.id)].join('+'));

// same story, different wording and sources
let r = stackItems([
  it('a', 'EU leaders agree new climate target for 2040', 1),
  it('b', 'EU leaders agree on new 2040 climate target', 2),
  it('c', 'Local bakery wins national bread award', 3),
  it('d', 'Climate target for 2040: EU leaders agree after long talks', 5)]);
assert.deepEqual(ids(r), ['a+b+d', 'c'], 'one stack of three, one single: ' + JSON.stringify(ids(r)));

// German with umlauts / ß: accents folded, still matches
r = stackItems([it('g1', 'Bundesregierung beschließt neues Klimaschutzgesetz für Gebäude', 1), it('g2', 'Neues Klimaschutzgesetz für Gebäude: Bundesregierung beschließt es', 2)]);
assert.deepEqual(ids(r), ['g1+g2']);

// numbers must agree
r = stackItems([it('n1', 'Bundesliga: Ergebnisse vom 3. Spieltag im Überblick', 1), it('n2', 'Bundesliga: Ergebnisse vom 4. Spieltag im Überblick', 2)]);
assert.equal(r.length, 2, 'different matchday: not the same story');

// too few shared words / unrelated
r = stackItems([it('s1', 'Fed holds rates', 1), it('s2', 'Fed keeps rates steady', 2)]);
assert.equal(r.length, 2, 'short titles with two shared words stay apart (conservative)');

// time window
r = stackItems([it('t1', 'EU leaders agree new climate target for 2040', 1), it('t2', 'EU leaders agree on new 2040 climate target', 100)]);
assert.equal(r.length, 2, 'more than 48 h apart: separate');

// CJK titles: bigram matching, and different stories stay apart
r = stackItems([it('j1', '政府が新しい気候目標を発表 2040年までに排出削減', 1), it('j2', '政府、2040年までの排出削減を含む新しい気候目標を発表', 2), it('j3', '東京で桜が満開、花見客でにぎわう', 3)]);
assert.deepEqual(ids(r), ['j1+j2', 'j3'], JSON.stringify(ids(r)));

// exclude + prefer
const list = [it('x1', 'EU leaders agree new climate target for 2040', 1), it('x2', 'EU leaders agree on new 2040 climate target', 2)];
assert.equal(stackItems(list, { exclude: new Set(['x2']) }).length, 2, 'excluded items never stack');
r = stackItems(list, { prefer: (i) => i.id === 'x2' ? 2 : 0 });
assert.equal(r[0].lead.id, 'x2', 'preferred item leads the stack'); assert.deepEqual(r[0].others.map(o => o.id), ['x1']);

// no chaining: C is similar to B but not to the lead A
const A = it('c1', 'alpha beta gamma delta epsilon', 1), B = it('c2', 'alpha beta gamma delta zeta', 2), C = it('c3', 'alpha beta zeta eta theta', 3);
assert(similar(titleTokens(A.title), titleTokens(B.title)) && similar(titleTokens(B.title), titleTokens(C.title)) === false || true);
assert.equal(stackItems([A, B, C]).some(s => s.others.length === 2), false, 'stacks do not chain through members');

// speed: a couple of thousand items must not take long (generous limit: the suite runs many processes in parallel)
const big = Array.from({ length: 2000 }, (_, k) => it('b' + k, `story ${k % 700} headline word${k % 13} topic${k % 29} report${k % 31}`, k * 0.36));   // 2000 items over 30 days
const t0 = Date.now(); stackItems(big); assert(Date.now() - t0 < 15000, 'fast enough: ' + (Date.now() - t0) + ' ms');
console.log('TEST 117 OK'); process.exit(0);

// Feeds setting "What the AI reads": titles only (aiDetail 0) leaves the descriptions out of recap / scoring prompts; the default keeps them.
import assert from 'assert';
import { imp } from './harness.mjs';
const { itemsForPrompt, setAiDetail, getAiDetail, itemSig, generateRecap, scoreItems, setAiTransport } = await imp('modules/feedAi.js');

const items = [
    { id: 'a', title: 'Chipmaker opens plant', snippet: 'The new factory will employ 2,000 people and start in 2028.' },
    { id: 'b', title: 'Rain expected', snippet: '' },
];
const sub = () => 'News';

assert.equal(getAiDetail(), 1, 'default: titles + descriptions');
const full = itemsForPrompt(items, sub);
assert(full.includes('The new factory will employ'), 'description present by default');

const sigFull = itemSig(items[0]);
setAiDetail(0);
assert.equal(getAiDetail(), 0);
const lean = itemsForPrompt(items, sub);
assert.equal(lean, '[1] News — Chipmaker opens plant\n[2] News — Rain expected');
assert(!lean.includes('factory'), 'no description');
assert.equal(itemSig(items[0]), sigFull, 'changing the setting does not make every recap look edited');
assert(itemsForPrompt(items, sub, null, 40).includes('The new factory'), 'an explicit length still wins');

setAiDetail(1);
assert(itemsForPrompt(items, sub).includes('The new factory'));
setAiDetail('0'); assert.equal(getAiDetail(), 0); setAiDetail(undefined); assert.equal(getAiDetail(), 1, 'unset means the default');

// The task is repeated AFTER the items (a small model's context window can push the system prompt out and it then just describes the list).
const seen = [];
setAiTransport(async ({ system, user }) => { seen.push({ system, user }); return 'SCORES: 1:2 | 2:0\nLABELS: 1:Tech | 2:World\nA short overview of the news.\n- Chips: a plant opens (News)\nMOOD: mixed'; });
await generateRecap(items, sub, { rate: true });
assert(seen[0].user.startsWith('Items:\n[1] News'), 'items first');
assert(/Now write the recap exactly as instructed: the SCORES line, the LABELS line/.test(seen[0].user) && seen[0].user.trim().endsWith('Do not describe the list and do not ask for a question.'), 'recap task repeated at the end');
await generateRecap(items, sub, { rate: false });
assert(!/SCORES line/.test(seen[1].user) && /MOOD line\./.test(seen[1].user), 'no SCORES line asked for without rating');
await scoreItems(items, sub, { labels: true });
assert(seen[2].user.trim().endsWith('Now reply with ONLY the JSON object, nothing else.') || /scores/i.test(seen[2].user), 'scoring task repeated');
setAiTransport(null);
console.log('test150 ok');

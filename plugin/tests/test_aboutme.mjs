// Prompt builder: optional lens + free tags; old builders keep their shape; template presets are untouched.
import assert from 'assert';
import { readFileSync } from 'fs';
const pb = await import(new URL('../src/modules/promptBuilder.js', import.meta.url));
assert.deepEqual(pb.normalizeBuilder({ tone: 'casual' }), { tone: 'casual', length: 'medium', focus: ['facts', 'numbers'], extra: '' }, 'old builders keep their exact shape');
assert.equal(pb.normalizeBuilder({ lens: 'nope' }).lens, undefined);
assert.deepEqual(pb.normalizeTags(['  UX   designer ', 'ux designer', '', '- Stoic', 'a\nb', 5]), ['UX designer', 'Stoic', 'a b', '5']);
assert.equal(pb.normalizeTags(Array.from({ length: 20 }, (_, i) => 't' + i)).length, pb.MAX_TAGS);
assert.ok(pb.normalizeTags(['x'.repeat(100)])[0].length <= pb.MAX_TAG_LENGTH);
const p = pb.buildArticlePrompt({ lens: 'stoic', about: ['UX designer', 'book lover'] });
assert.ok(p.includes('Stoic lens') && p.includes('About me: UX designer, book lover.'));
assert.ok(!pb.buildArticlePrompt({}).includes('About me'));
assert.ok(!pb.buildFeedStyle({ lens: 'stoic', about: ['x'] }).includes('About me'), 'feed style is unaffected');
const presets = JSON.parse(readFileSync(new URL('../src/prompts.json', import.meta.url)));
assert.equal(presets.length, 7, 'the existing presets are still there');
console.log('ok');

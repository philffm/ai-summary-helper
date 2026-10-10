// Recap text arrives as markdown: headings and bullets survive parsing (also inside a code fence) and render as DOM, bold included, nothing as raw "###" / "**".
import assert from 'assert';
import { setup, imp } from './harness.mjs';
const { w } = setup({}); globalThis.document = w.document; globalThis.window = w;
const { parseRecap } = await imp('modules/feedAi.js');
const { renderAnswer, renderInline } = await imp('modules/qaView.js');

const structured = [
  '```markdown',
  'Dies ist eine Liste von Nachrichtenartikeln.',
  '### Wirtschaft & Finanzen',
  '- **Goldmarkt:** Morgan Stanley bleibt positiv (1)',
  '- **Technologie:** Chip-Startups sammeln Geld ein (217, 231)',
  '### Politik',
  '- Neue Zölle (220)',
  'MOOD: mixed',
  '```'
].join('\n');
const r = parseRecap(structured);
assert.equal(r.mood, 'neu');
assert(!/```/.test(r.overview), 'code fence lines are dropped');
assert.deepEqual(r.themes, [], 'a structured briefing keeps its bullets under their headings');
assert(/### Wirtschaft & Finanzen\n- \*\*Goldmarkt/.test(r.overview), 'headings and bullets stay on their own lines');

const box = w.document.createElement('div');
renderAnswer(box, r.overview);
assert.equal(box.querySelectorAll('.md-h').length, 2, 'two headings');
assert.equal(box.querySelectorAll('li').length, 3, 'three bullets');
assert.equal(box.querySelectorAll('strong').length, 2, 'bold rendered');
assert(!/###|\*\*/.test(box.textContent), 'no markdown left on screen');

// headings glued into one line (a model writing its outline inline), with a horizontal rule and a chat-style closing question
const glued = parseRecap('Hier ist eine thematische Zusammenfassung: ### Wirtschaft & Finanzen ### Politik & Internationale Beziehungen ### Kriminalität & Recht --- Möchten Sie eine Zusammenfassung?\n\nGoldmarkt: Morgan Stanley bleibt positiv (1)\nFinanzinstrumente: TIPS-Ladder (216)');
const gl = glued.overview.split('\n');
assert.equal(gl.filter(l => /^### /.test(l)).length, 3, 'every glued heading is on its own line again');
assert.equal(gl[0], 'Hier ist eine thematische Zusammenfassung:', 'the sentence before them stays a paragraph');
assert(!gl.some(l => /^-{3,}$/.test(l) || /---/.test(l)), 'horizontal rule dropped');
const gbox = w.document.createElement('div'); renderAnswer(gbox, glued.overview);
assert.equal(gbox.querySelectorAll('.md-h').length, 3);
assert(!/###/.test(gbox.textContent), 'no ### on screen');

// plain recap: overview sentences + bullet themes as before
const plain = parseRecap('Ein Überblick. Noch ein Satz.\n- Erstens\n- Zweitens\nMOOD: positive');
assert.equal(plain.overview, 'Ein Überblick. Noch ein Satz.');
assert.deepEqual(plain.themes, ['Erstens', 'Zweitens']);
assert.equal(plain.mood, 'pos');

// a theme bullet may carry bold
const li = w.document.createElement('li');
renderInline(li, '**Gold:** stabil');
assert.equal(li.querySelector('strong').textContent, 'Gold:');
console.log('TEST 126 OK'); process.exit(0);

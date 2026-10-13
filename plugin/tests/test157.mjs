// Briefing text for streaming display and read-aloud: rating/mood lines and markdown marks are left out, also half-written ones.
import assert from 'assert';
import { setup, imp } from './harness.mjs';
setup({});
const { briefingText, recapSpeechText } = await imp('modules/recapSpeech.js');
const raw = 'SCORES: 1:3 | 2:-2\nLABELS: 1:Tech | 2:Politics\nMarkets were calm. **Tech** led.\n- Reuters: rates hold\n- [BBC](https://x.y): storm\nMOOD: mixed';
assert.equal(briefingText(raw), 'Markets were calm. Tech led.\nReuters: rates hold\nBBC: storm');
assert.equal(briefingText('Hello world.\nMO'), 'Hello world.', 'half-written MOOD line is hidden');
assert.equal(briefingText('Hello world.\nSCOR'), 'Hello world.');
assert.equal(briefingText('Hello\nMorning news'), 'Hello\nMorning news', 'real text starting like a key stays');
assert.equal(briefingText(''), '');
assert.equal(recapSpeechText({ overview: 'A.', themes: ['b', 'c'] }), 'A.\nb\nc');
console.log('TEST 157 OK');

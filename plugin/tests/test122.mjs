// Onboarding mask: Continue stays inactive until a provider is set up; that card turns green with "✓ Set up"; Continue dismisses the mask for good.
import assert from 'assert'; import fs from 'fs';
import { setup, imp, tick } from './harness.mjs';
const { w, store } = setup({}); const d = w.document;
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
chrome.runtime.getURL = (p) => p;
chrome.tabs = { query: async () => [], sendMessage() {}, onActivated: { addListener() {} }, onUpdated: { addListener() {} } };
globalThis.fetch = w.fetch = async (u) => {
  const f = process.env.AISH_SRC + '/' + String(u);
  if (String(u) === 'services.json' && fs.existsSync(f)) { const t = fs.readFileSync(f, 'utf8'); return { ok: true, json: async () => JSON.parse(t), text: async () => t }; }
  return { ok: true, json: async () => [], text: async () => '' };
};
const MS = await imp('modules/mainScreen.js');
MS.initMainScreen({ showScreen() {} });
await tick(150);
const box = d.getElementById('mainScreenOnboarding');
const skip = d.getElementById('onboardingSkipBtn');
const fire = (changes) => (globalThis.__chL || []).forEach((f) => f(changes, 'local'));
const done = () => [...d.querySelectorAll('.onboarding-option.is-configured')].map((n) => n.id);
assert.equal(box.style.display, 'flex', 'shown for a fresh install');
assert.deepEqual(done(), [], 'nothing marked yet');
assert(skip.disabled && skip.classList.contains('button-primary'), 'Continue is inactive while nothing is configured');
skip.click(); await tick(20);
assert.equal(store.onboardingDismissed, undefined, 'an inactive button dismisses nothing');

// Ollama set up → its card is green with a check, the button says Continue, the mask stays
store.connectionMode = 'local'; store.activeService = 'ollama'; store['config:services'] = { ollama: { model: 'llama3.2' } };
fire({ connectionMode: { newValue: 'local' }, activeService: { newValue: 'ollama' } }); await tick(100);
assert.equal(box.style.display, 'flex', 'mask stays open so the user can continue');
assert.deepEqual(done(), ['onboardingOllamaBtn'], 'Ollama card marked');
assert(/✓/.test(d.querySelector('#onboardingOllamaBtn .onboarding-done').textContent), 'check mark label');
assert(!skip.disabled, 'Continue is active once something is configured');

// Own key instead → that card
store.activeService = 'openai'; store['config:services'] = { openai: { apiKey: 'sk-test' } };
fire({ activeService: { newValue: 'openai' } }); await tick(100);
assert.deepEqual(done(), ['onboardingCustomApiBtn'], 'own key card marked, Ollama unmarked');

// Several set up at once → several green cards; the stored key sits behind the cloud default, Continue switches to a working provider
store.connectionMode = 'cloud'; delete store['account:token'];
store['config:services'] = { openai: { apiKey: 'sk-test' }, ollama: { customModel: [{ id: 'qwen3:8b', provider: 'ollama' }] } };
fire({ connectionMode: { newValue: 'cloud' } }); await tick(100);
assert.deepEqual(done().sort(), ['onboardingCustomApiBtn', 'onboardingOllamaBtn'], 'own key and Ollama both green');
store['account:token'] = 'tok'; fire({ 'account:token': { newValue: 'tok' } }); await tick(100);
assert.deepEqual(done().sort(), ['onboardingCustomApiBtn', 'onboardingOllamaBtn', 'onboardingOptCloud'], 'all three green when signed in too');
delete store['account:token']; fire({ 'account:token': { oldValue: 'tok' } }); await tick(100);
skip.click(); await tick(60);
assert.equal(store.connectionMode, 'local', 'Continue leaves the unusable cloud default');
assert.equal(store.activeService, 'ollama', 'and picks the configured Ollama model');
store.onboardingDismissed = undefined; delete store.onboardingDismissed;

// Continue → dismissed for good
skip.click(); await tick(20);
assert.equal(store.onboardingDismissed, true, 'dismissal stored');
fire({ onboardingDismissed: { newValue: true } }); await tick(80);
assert.equal(box.style.display, 'none', 'mask gone, input bar usable');
console.log('TEST 122 OK'); process.exit(0);

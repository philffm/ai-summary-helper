// Onboarding: cloud, own key and Ollama are three equal choices; the no-account ones open the model settings with their tab selected. About links the privacy policy.
import assert from 'assert';
import fs from 'fs';
import { setup, imp, tick } from './harness.mjs';
const { w } = setup({}); const d = w.document;
const css = fs.readFileSync(process.env.AISH_SRC + '/styles.css', 'utf8');
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
chrome.runtime.getURL = (p) => 'chrome-extension://abc/' + p;
chrome.tabs = { query: async () => [], sendMessage() {}, onActivated: { addListener() {} }, onUpdated: { addListener() {} } };
globalThis.fetch = w.fetch = async () => ({ ok: true, json: async () => [], text: async () => '' });
const MS = await imp('modules/mainScreen.js');
const shown = [];
MS.initMainScreen({ showScreen: (s) => shown.push(s) });
await tick(150);

const box = d.getElementById('mainScreenOnboarding');
assert.equal(box.style.display, 'flex', 'shown for a fresh install');
assert(/\.onboarding-container\s*\{[^}]*padding-top:\s*calc\(var\(--header-h\)\s*\+\s*8px\)/s.test(css), 'onboarding content clears the fixed header');
assert(/\.onboarding-container\s*\{[^}]*padding-bottom:\s*calc\(var\(--nav-clearance\)/s.test(css), 'last button clears the bottom nav');
assert(/\.onboarding-auth-box\s+\.auth-message:empty\s*\{\s*display:\s*none/.test(css), 'empty login message takes no room');
assert(!d.getElementById('onboardingHeading'), 'no heading, the short intro is enough');
assert(d.getElementById('onboardingIntro').textContent.length < 70, 'short intro');
const cards = [...d.querySelectorAll('#onboardingOptions > .onboarding-option')];
assert.equal(cards.length, 3, 'three options');
assert(/Free cloud models/.test(d.getElementById('onboardingTitle').textContent) || d.getElementById('onboardingTitle'), 'cloud card keeps its sign-in form');
assert(d.getElementById('onboardingSendCodeBtn') && cards[0].contains(d.getElementById('onboardingEmail')));
assert(/own API key/i.test(cards[1].textContent) && /No account/.test(cards[1].textContent));
assert(/Ollama/.test(cards[2].textContent) && /No account/.test(cards[2].textContent));
assert(/Ctrl \+ Shift \+ E|⌘ \+ Shift \+ E/.test(d.getElementById('onboardingTip').textContent), 'shortcut tip');

// Ollama card → settings, Ollama tab selected
d.getElementById('onboardingOllamaBtn').click();
for (let k = 0; k < 60 && !d.getElementById('modeOllama').checked; k++) await tick(50);
assert.deepEqual(shown.slice(-1), ['settings']);
assert.equal(d.getElementById('modeOllama').checked, true, 'Ollama tab selected');
// Own key card → Own key tab
d.getElementById('onboardingCustomApiBtn').click();
for (let k = 0; k < 60 && !d.getElementById('modeLocal').checked; k++) await tick(50);
assert.equal(d.getElementById('modeLocal').checked, true, 'Own key tab selected');

// About: privacy policy, changelog, security policy
const link = d.getElementById('aboutPrivacyLink');
assert(link && /byphil\.eu\/privacy\.html/.test(link.href));
const about = d.getElementById('settingsPanel-about');
assert(about.querySelector('a[href$="CHANGELOG.md"]') && about.querySelector('a[href$="SECURITY.md"]'));
assert(!/_b0lank/.test(about.innerHTML), 'no broken link target');
console.log('TEST 102 OK'); process.exit(0);

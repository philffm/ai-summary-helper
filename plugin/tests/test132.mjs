// Shared search clear (modules/searchField.js): ✕ shows with text, empties the box through a normal input event,
// follows programmatic value changes, is wired on every static search box, and is never added twice.
import { setup, imp, tick } from './harness.mjs'; import assert from 'assert';
const { w } = setup({});
const d = w.document;
const sf = await imp('../src/modules/searchField.js');
sf.initSearchFields(d);
for (const id of ['searchInput', 'feedSearch', 'settingsSearch', 'languageSearch']) {
  const input = d.getElementById(id);
  assert(input, id);
  const wrap = input.closest('.search-wrap'); assert(wrap, id + ' is wrapped');
  const btn = wrap.querySelector('.search-clear'); assert(btn, id + ' has a ✕');
  assert(btn.hidden, id + ' ✕ hidden while empty');
  let fired = 0; input.addEventListener('input', () => fired++);
  input.value = 'abc'; input.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert(!btn.hidden && input.classList.contains('has-clear'), id + ' ✕ shown with text');
  btn.click();
  assert.equal(input.value, '', id + ' emptied'); assert(btn.hidden, id + ' ✕ hidden again'); assert(fired >= 2, id + ' listeners got an input event');
  input.value = 'xyz'; assert(!btn.hidden, id + ' ✕ follows a programmatic value');
  input.value = ''; assert(btn.hidden, id + ' ✕ follows a programmatic reset');
}
assert.equal(d.querySelectorAll('#searchInputWrap .search-clear').length, 1, 'History keeps its single ✕');
assert.equal(sf.attachSearchClear(d.getElementById('feedSearch')), null, 'second attach is a no-op');
// built in JS, inside a container (source picker / shortcuts filter)
const box = d.createElement('div'); d.body.append(box);
const inp = d.createElement('input'); inp.type = 'search'; box.append(inp);
sf.attachSearchClear(inp);
assert(inp.closest('.search-wrap') && box.querySelectorAll('.search-clear').length === 1);
console.log('TEST 132 OK');

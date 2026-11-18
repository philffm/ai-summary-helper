// The browser of make-place.mjs syncs again with the place and reports what it holds; with "edit" it first changes things.
//   node koreader/tests/browser-step.mjs <browser.json> <placeDir> report|edit
import fs from 'fs';
import { makeDevice, SK, noteRecKey } from './browser-device.mjs';
const [stateFile, place, mode] = process.argv.slice(2);
const dev = await makeDevice(stateFile);
const r1 = await dev.sync(place);
const anns = () => dev.data.get(SK.annotations) || [];
if (mode === 'edit') {
  // the comment on the reader's highlight is edited, the user highlight h-3 is deleted
  const ko = anns().find((a) => a.source === 'koreader');
  const id = 'c_' + ko.id, rec = dev.data.get(noteRecKey(id));
  await dev.area.set({ [noteRecKey(id)]: { ...rec, text: 'Edited in the browser.', updated: new Date().toISOString() } });
  await dev.area.set({ [SK.annotations]: anns().filter((a) => a.id !== 'h-3') });
  await dev.st.markDeleted('hl', ['h-3']); await dev.idle();
  await dev.sync(place);
}
dev.save();
const notes = {};
for (const [k, v] of dev.data) if (k.startsWith('note:rec:') || k.startsWith(noteRecKey(''))) notes[v.id] = { text: v.text, highlightId: v.highlightId, kind: v.kind };
const idx = dev.data.get(SK.articlesIndex) || [];
console.log(JSON.stringify({ pulled: r1.pulled, annotations: anns(), notes, readAt: Object.fromEntries(idx.map((a) => [a.id, a.readAt || null])) }));

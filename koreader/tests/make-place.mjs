// Makes an encrypted AISH sync place with the extension's own sync engine, for the plugin's interop test:
//   node koreader/tests/make-place.mjs <outDir>
// Writes <outDir>/snap1 (a library: 3 articles, highlights, a comment, a note, a collection, a feed stub) and <outDir>/snap2
// (the same place after changes in the browser: one article deleted, a highlight added, a note edited, an article retitled).
// Passphrase: "orbit lemon tunnel paper river cloud", 1000 key rounds (the real places use 600,000).
// <outDir>/browser.json is the browser's storage afterwards (browser-step.mjs syncs it again).
import fs from 'fs'; import path from 'path';
import { makeDevice, SK, articleRecKey, collRecKey, noteRecKey } from './browser-device.mjs';

const out = path.resolve(process.argv[2] || 'place-out'), place = path.join(out, 'live');
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const dev = await makeDevice(null);
await dev.createPlace(place);
const { data, area, st, idle } = dev;
const sync = () => dev.sync(place);
const snap = (name) => fs.cpSync(place, path.join(out, name), { recursive: true });

const sleep = '<p>Sleep is <em>not</em> a pause for the brain.</p><p>During slow-wave sleep, the brain replays the day’s experiences, which strengthens the connections between neurons.</p><p>Short naps of about twenty minutes improve recall.</p>';
await area.set({
  [SK.articlesIndex]: [
    { id: 'k-a1', url: 'https://science.example/sleep?utm_source=x', title: 'Why we sleep: what the new studies show', timestamp: '2026-11-02T08:00:00.000Z', tags: ['science'], summary: '<ul><li>Sleep consolidates memory.</li></ul>' },
    { id: 'k-a2', url: 'https://news.example/four-day-week', title: 'Is the four-day week working?', timestamp: '2026-11-05T08:00:00.000Z', tags: ['work'], summary: '<p>Trials kept output stable.</p>' },
    { id: 'k-a3', url: 'https://blog.example/only-summary', title: 'Only a summary here', timestamp: '2026-11-06T08:00:00.000Z', tags: [], summary: '<p>Just the gist.</p>' },
    { id: 'k-stub', url: 'https://feed.example/item', title: 'Feed stub', timestamp: '2026-11-07T08:00:00.000Z', tags: [], feedStub: true },
  ],
  [articleRecKey('k-a1')]: { content: sleep, summary: '<ul><li>Sleep consolidates memory.</li></ul>' },
  [articleRecKey('k-a2')]: { content: '<p>Two years of trials are in. Most firms kept the model.</p>', summary: '<p>Trials kept output stable.</p>' },
  [articleRecKey('k-a3')]: { summary: '<p>Just the gist.</p>' },
  [SK.annotations]: [
    { id: 'h-1', url: 'https://science.example/sleep', text: 'the brain replays the day’s experiences', type: 'user', timestamp: '2026-11-02T09:00:00.000Z', quote: { exact: 'the brain replays the day’s experiences', prefix: 'During slow-wave sleep, ', suffix: ', which strengthens' }, v: 2 },
    { id: 'h-2', url: 'https://science.example/sleep', text: 'Short naps of about twenty minutes improve recall.', type: 'ghost', timestamp: '2026-11-02T09:00:00.000Z' },
  ],
  [SK.collIndex]: [{ id: 'c-1', name: 'Exam prep', n: 2 }], [collRecKey('c-1')]: { id: 'c-1', name: 'Exam prep', sources: [{ articleId: 'k-a1', addedAt: '2026-11-03' }, { articleId: 'k-a2', addedAt: '2026-11-03' }], updated: 1 },
  [SK.notesIndex]: [{ id: 'c_h-1', kind: 'comment', created: '2026-11-02T10:00:00.000Z', updated: '2026-11-02T10:00:00.000Z', hl: 'h-1' }, { id: 'n-1', kind: 'note', created: '2026-11-02T11:00:00.000Z', updated: '2026-11-02T11:00:00.000Z' }],
  [noteRecKey('c_h-1')]: { id: 'c_h-1', kind: 'comment', text: 'Matches chapter 3 of the textbook.', tags: [], url: 'https://science.example/sleep', highlightId: 'h-1', quote: 'the brain replays the day’s experiences', created: '2026-11-02T10:00:00.000Z', updated: '2026-11-02T10:00:00.000Z' },
  [noteRecKey('n-1')]: { id: 'n-1', kind: 'note', text: 'Read again before the exam.', tags: ['exam'], url: 'https://science.example/sleep', title: 'Why we sleep', created: '2026-11-02T11:00:00.000Z', updated: '2026-11-02T11:00:00.000Z' },
});
let r = await sync(); console.log('snap1 pushed', r.pushed);
snap('snap1');

// the browser changes things: k-a2 deleted, a new highlight on k-a1, the note edited, k-a3 retitled
const idx = data.get(SK.articlesIndex).filter((e) => e.id !== 'k-a2').map((e) => e.id === 'k-a3' ? { ...e, title: 'Only a summary here (renamed)' } : e);
await area.set({ [SK.articlesIndex]: idx }); await area.remove(articleRecKey('k-a2')); await st.markDeleted('article', ['k-a2']); await idle();
await area.set({ [SK.annotations]: [...data.get(SK.annotations), { id: 'h-3', url: 'https://science.example/sleep', text: 'Sleep is not a pause for the brain.', type: 'user', timestamp: '2026-11-08T09:00:00.000Z' }] });
await area.set({ [noteRecKey('n-1')]: { ...data.get(noteRecKey('n-1')), text: 'Read again before the exam on Friday.', updated: '2026-11-08T11:00:00.000Z' } });
r = await sync(); console.log('snap2 pushed', r.pushed);
snap('snap2');
dev.save(path.join(out, 'browser.json'));   // the browser goes on in browser-step.mjs
console.log('PLACE OK ' + out);

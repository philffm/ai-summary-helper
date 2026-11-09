import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
export const SRC = process.env.AISH_SRC + '';
// the background's highlight writer, so page-script tests see what the extension would store ({ action: 'hl:apply' })
const HL = await Promise.all(['modules/highlightStore.js', 'modules/highlightMessages.js', 'modules/pageKey.js'].map((rel) => import(pathToFileURL(path.join(SRC, rel)).href)));
export function setup(fixtures) {
  const dom = new JSDOM(fs.readFileSync(SRC + '/popup.html', 'utf8'), { url: 'chrome-extension://abc/popup.html', pretendToBeVisual: true });
  const w = dom.window;
  for (const k of ['window','document','DOMParser','Blob','CustomEvent','Event','KeyboardEvent','HTMLElement','Node','NodeFilter','Range','Text','Element']) { try { globalThis[k] = k==='window'? w : w[k]; } catch(e){} }
  Object.defineProperty(globalThis,'navigator',{value:w.navigator,configurable:true});
  w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {};
  const store = {};
  const sent = [];
  const get = (keys, cb) => {
    let out = {};
    if (keys == null) out = { ...store };
    else if (typeof keys === 'string') { if (keys in store) out[keys] = store[keys]; }
    else if (Array.isArray(keys)) keys.forEach(k => { if (k in store) out[k] = store[k]; });
    else Object.entries(keys).forEach(([k, d]) => { out[k] = k in store ? store[k] : d; });
    out = JSON.parse(JSON.stringify(out));
    if (cb) { cb(out); return; } return Promise.resolve(out);
  };
  const set = (obj, cb) => { Object.entries(obj).forEach(([k, v]) => { store[k] = JSON.parse(JSON.stringify(v)); }); if (cb) cb(); return Promise.resolve(); };
  const remove = (keys, cb) => { [].concat(keys).forEach(k => delete store[k]); if (cb) cb(); return Promise.resolve(); };
  const area = { get, set, remove };
  globalThis.chrome = {
    storage: { local: area, sync: area, session: area, onChanged: { addListener(f) { (globalThis.__chL = globalThis.__chL || []).push(f); } } },
    runtime: {
      lastError: null,
      onMessage: { addListener(f) { (globalThis.__msgL = globalThis.__msgL || []).push(f); } },
      sendMessage(msg, cb) {
        sent.push(msg);
        let res;
        if (msg.action === 'fetchFeedText') {
          const f = fixtures[msg.url];
          res = typeof f === 'function' ? f(msg) : f ? { ok: true, status: 200, text: f, url: msg.url } : { ok: false, error: 'HTTP 404' };
        } else if (msg.action === 'hl:apply') {
          const ops = HL[1].cleanOps(msg.ops, HL[2].pageKeyForUrl(w.location.href));
          res = ops ? HL[0].createHighlightStore({ storage: area }).apply(ops).then((r) => ({ ok: true, ...r })) : { ok: false, error: 'bad-ops' };
        } else if (msg.action === 'aiComplete') { res = globalThis.__ai ? globalThis.__ai(msg) : { ok: false, error: 'no ai' }; } else res = { success: true, mode: 'extension' };
        if (cb) Promise.resolve(res).then(value => setTimeout(() => cb(value), 0));
      }
    }
  };
  return { dom, store, sent, w };
}
export const imp = (rel) => import(pathToFileURL(path.join(SRC, rel)).href + '?t=' + Math.random());
export const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

/**
 * Enters History's selection mode the way users do: the ⋯ menu of the first card that offers "Select" (the card ends up
 * ticked, like after a long-press). Returns that card.
 */
export async function enterSelection(d) {
  for (const card of d.querySelectorAll('#articleList .article-card')) {
    const btn = card.querySelector('.card-menu-btn'); if (!btn) continue;
    btn.click(); await tick(15);
    const item = [...d.querySelectorAll('.card-menu-item')].find(b => !b.hidden && /Select\s*$/.test(b.textContent));
    if (item) { item.click(); await tick(15); return card; }
    btn.click(); await tick(10);   // this card has no Select entry (not sendable): close its menu, try the next
  }
  throw new Error('no card offers Select');
}

/** Answers every confirm sheet (confirmSheet.js) that opens: st.answer true → confirm, false → Cancel. st.asked counts them. */
export function answerSheets(w, answer = true) {
  const st = { answer, asked: 0 };
  const obs = new w.MutationObserver(() => {
    for (const s of w.document.querySelectorAll('.confirm-sheet:not([data-answered])')) {
      s.dataset.answered = '1'; st.asked++;
      setTimeout(() => { const b = s.querySelector(st.answer ? '.button-danger, .button-primary' : '.button-secondary'); if (b) b.click(); }, 0);
    }
  });
  obs.observe(w.document.body, { childList: true });
  return st;
}
/** Runs the deletes still waiting for their Undo window (the app's own confirmSheet.js instance). */
export async function flushUndo() {
  const m = await import(pathToFileURL(path.join(SRC, 'modules/confirmSheet.js')).href);
  await m.flushUndo();
}
/** Presses Undo on the newest toast. */
export function pressUndo(d) { const b = [...d.querySelectorAll('#toastStack .toast-action')].at(-1); if (!b) throw new Error('no Undo toast'); b.click(); }

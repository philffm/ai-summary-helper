import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
export const SRC = process.env.AISH_SRC + '';
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
          res = f ? { ok: true, text: f, url: msg.url } : { ok: false, error: 'HTTP 404' };
        } else if (msg.action === 'aiComplete') { res = globalThis.__ai ? globalThis.__ai(msg) : { ok: false, error: 'no ai' }; } else res = { success: true, mode: 'extension' };
        if (cb) setTimeout(() => cb(res), 0);
      }
    }
  };
  return { dom, store, sent, w };
}
export const imp = (rel) => import(pathToFileURL(path.join(SRC, rel)).href + '?t=' + Math.random());
export const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

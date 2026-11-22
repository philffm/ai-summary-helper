// modules/sendSplit.js — "Send" the way the extension prioritises it, shared by the article detail (history/detail.js) and the
// read mode page (readerPage.js): one split button whose main part sends to the LAST USED target (first use: the delivery
// preference, Kindle or LocalSend) and whose ▾ lists every target with its devices ("Last used", "Default"), then the system
// share sheet, Copy link and Manage targets. A send is held back for a few seconds so it can still be taken back.
import { SK } from './storageKeys.js';
import StorageManager from './storageManager.js';
import { T } from './feedI18n.js';
import { createInboxManager } from './inboxManager.js';

export const SEND_UNDO_SECONDS = 10;
const SEND_DEVICE_MAX = 3;   // devices shown per send type; the rest sits behind "+N more"

/**
 * actions: () => Promise<{ sendToKindle, dispatchToLocalSend, sendToPhone, shareArticle }>   (the page binds their ui)
 * prefs:   () => { sendTarget, delivery }                      the live preference object of the caller
 * ui:      () => { showToast, showScreen } | null              null: sends go out at once, without the undo window
 * repaint: () => void                                          after the last-used target changed
 */
export function createSendTargets({ actions, prefs, ui = () => null, repaint = () => {} }) {
  const TARGETS = {
    kindle: { icon: 'book-open', short: () => T('Kindle'), label: () => T('Send to Kindle'), run: async (a) => (await actions()).sendToKindle(a) },
    localsend: { icon: 'share-2', short: () => T('LocalSend'), label: () => T('Send via LocalSend'), run: async (a) => (await actions()).dispatchToLocalSend(a) },
    phone: { icon: 'smartphone', short: () => T('Phone'), label: () => T('Send to phone'), run: async (a) => (await actions()).sendToPhone(a) },
    share: { icon: 'send', short: () => T('Share'), label: () => T('Share…'), run: async (a) => (await actions()).shareArticle(a) },
  };
  const ok = (id, a) => id !== 'phone' || !!(a && a.id && a.url && !a.feedStub);
  /** The target the main button sends to for this article. */
  const current = (a) => (TARGETS[prefs().sendTarget] && ok(prefs().sendTarget, a) ? prefs().sendTarget : 'kindle');

  const pending = new Set();
  /** Holds a send back for a few seconds so it can still be taken back. Leaving the page sends it right away (nothing is lost). */
  function sendWithUndo(label, run) {
    const u = ui();
    if (!u) return run();
    let left = SEND_UNDO_SECONDS, done = false, tick = null, toast = null;
    const text = () => T('Sending to {name} in {n} s', { name: label, n: left });
    const finish = (go) => { if (done) return; done = true; clearInterval(tick); pending.delete(flush); if (toast) toast.dismiss(); if (go) return run(); u.showToast(T('Cancelled: not sent')); };
    const flush = () => finish(true);
    toast = u.showToast(text(), (SEND_UNDO_SECONDS + 1) * 1000, { label: T('Undo'), onClick: () => finish(false) });
    pending.add(flush);
    tick = setInterval(() => { left -= 1; if (left <= 0) flush(); else if (toast) toast.setText(text()); }, 1000);
  }
  try { window.addEventListener('pagehide', () => { [...pending].forEach((f) => f()); }); } catch (_) { /* no window */ }

  async function run(id, a) {
    const def = TARGETS[id]; if (!def) return;
    prefs().sendTarget = id;
    try { chrome.storage.sync.set({ lastSendTarget: id }); } catch (_) { /* remembered for this session only */ }
    repaint();
    if (id === 'share') return def.run(a);   // the system share sheet has its own cancel
    let name = def.short();
    try { const cfg = await StorageManager.getSettings(); const dev = StorageManager.getActiveDevice(cfg, id); if (dev && dev.label) name = `${def.short()} · ${dev.label}`; } catch (_) { /* generic name */ }
    sendWithUndo(name, () => def.run(a));
  }

  /** The ▾ menu for article `a`, opened at `btn`. */
  async function openMenu(btn, a, expanded = '') {
    if (!a) return;
    const { openItems } = await import('./cardMenu.js');
    let phone = null, cfg = {};
    try { phone = (await createInboxManager().status()).paired; } catch (_) { /* unknown → plain row */ }
    try { cfg = await StorageManager.getSettings(); } catch (_) { /* no devices known → plain rows */ }
    const items = [];
    for (const id of ['kindle', 'localsend', 'phone'].filter((t) => ok(t, a))) {
      const def = TARGETS[id];
      const devices = id === 'phone' ? [] : (Array.isArray(cfg[SK.devices]) ? cfg[SK.devices].filter((d) => d.type === id) : []);
      const last = id === prefs().sendTarget;
      if (!devices.length) {
        items.push({
          icon: def.icon, label: def.label(), active: last,
          sub: last ? T('Last used') : (id === 'phone' && phone === false ? T('Not paired · pair now') : ''),
          tag: id === prefs().delivery ? T('Default') : (id === 'phone' && phone ? T('Paired') : ''),
          run: () => run(id, a),
        });
        continue;
      }
      const activeId = (StorageManager.getActiveDevice(cfg, id) || {}).id;
      const shown = expanded === id ? devices : devices.slice(0, SEND_DEVICE_MAX);
      for (const d of shown) {
        const isActive = d.id === activeId;
        items.push({
          icon: def.icon, label: `${def.short()} · ${d.label || d.id}`, active: last && isActive,
          sub: last && isActive ? T('Last used') : '',
          tag: id === prefs().delivery && isActive ? T('Default') : '',
          run: async () => { try { await StorageManager.setActiveDevice(id, d.id); } catch (_) { /* send to the current device */ } return run(id, a); },
        });
      }
      if (devices.length > shown.length) {
        items.push({ icon: 'ellipsis', label: T('{n} more…', { n: devices.length - shown.length }), sub: def.short(), run: () => setTimeout(() => openMenu(btn, a, id), 0) });
      }
    }
    items.push({ icon: 'send', label: T('Share…'), sub: T('System share: apps, AirDrop, mail'), sep: true, run: () => run('share', a) });
    items.push({ icon: 'copy', label: T('Copy link'), run: async () => { try { await navigator.clipboard.writeText(a.url || ''); const u = ui(); if (u) u.showToast(T('Link copied')); } catch (_) { /* ignore */ } } });
    items.push({ icon: 'settings', label: T('Manage targets…'), sep: true, run: () => { const u = ui(); if (u) u.showScreen('settings'); import('./settingsNav.js').then((m) => m.openSettingsPanel('send')).catch(() => {}); } });
    openItems(btn, items);
  }

  return { TARGETS, ok, current, run, openMenu };
}

/** { sendTarget, delivery } from the saved settings: the last used target, else the delivery preference. */
export async function loadSendPrefs() {
  const cfg = await StorageManager.getSettings();
  const delivery = cfg.deliveryPreference === 'localsend' ? 'localsend' : 'kindle';
  return { delivery, sendTarget: ['kindle', 'localsend', 'phone', 'share'].includes(cfg.lastSendTarget) ? cfg.lastSendTarget : delivery };
}

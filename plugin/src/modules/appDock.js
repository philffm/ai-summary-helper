// appDock.js — "Open app": the extension's own UI (popup.html?surface=float) beside the page, in a column the user can resize.
// Used by the reading view and the home page. Wide windows put it beside the page (the page makes room); narrow ones float it over.
// createAppDock({ button, getWidth(), saveWidth(px) }) → { toggle, close, isOpen }
import { T } from './feedI18n.js';
import { bp } from './breakpoints.js';

const DOCK_MIN = 320, DOCK_DEFAULT = 420;
const dockMax = () => Math.max(DOCK_MIN, Math.min(760, Math.round(window.innerWidth * 0.6)));
export const clampDock = (w) => Math.min(dockMax(), Math.max(DOCK_MIN, Math.round(Number(w) || DOCK_DEFAULT)));

export function createAppDock({ button, getWidth = () => DOCK_DEFAULT, saveWidth = () => {}, labels = null, root = document.documentElement, doc = document }) {
  let frame = null, grip = null;
  const width = () => parseInt(root.style.getPropertyValue('--dock-w'), 10);   // we set it inline ourselves
  const setWidth = (w) => {
    root.style.setProperty('--dock-w', clampDock(w) + 'px');
    if (grip) { grip.setAttribute('aria-valuenow', String(clampDock(w))); grip.setAttribute('aria-valuemin', String(DOCK_MIN)); grip.setAttribute('aria-valuemax', String(dockMax())); }
  };
  // the button says what a press does: "Open app" / "Close app" (labels = { open, close }; the text sits in .dock-label or .rp-label)
  const setState = (isOpen) => {
    if (!button) return;
    button.setAttribute('aria-pressed', String(isOpen)); setIcon(isOpen ? 'panel-right-close' : 'panel-right-open');
    if (!labels) return;
    const text = isOpen ? labels.close : labels.open, full = isOpen ? labels.closeFull || labels.close : labels.openFull || labels.open;
    const l = button.querySelector('.dock-label, .rp-label'); if (l) l.textContent = text;
    button.setAttribute('aria-label', full); button.title = full;
  };
  const setIcon = (name) => { const u = button && button.querySelector('use'); if (u) u.setAttribute('href', '#i-' + name); };
  const edge = doc.createElement('button');
  edge.type = 'button'; edge.className = 'app-dock-edge'; edge.setAttribute('aria-label', T('Open app'));
  edge.innerHTML = '<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-panel-right-open"/></svg>';
  doc.body.appendChild(edge);

  function close() {
    const f = frame; frame = null;
    if (f) { f.classList.remove('dock-in'); setTimeout(() => { f.remove(); if (!frame) root.classList.remove('dock-docked'); }, 320); }   // slides out first (the CSS transition is shorter)
    if (grip) { grip.remove(); grip = null; }
    root.classList.remove('dock-open');
    setState(false);
    edge.hidden = false;
  }
  function makeGrip() {
    const g = doc.createElement('div');
    g.className = 'app-dock-grip'; g.setAttribute('role', 'separator'); g.setAttribute('aria-orientation', 'vertical'); g.tabIndex = 0;
    g.setAttribute('aria-label', T('Resize the app panel'));
    g.addEventListener('pointerdown', (e) => {
      e.preventDefault(); g.setPointerCapture(e.pointerId); root.classList.add('dock-resizing');   // the frame must not swallow the drag
      const move = (ev) => setWidth(window.innerWidth - ev.clientX);
      const up = () => { g.removeEventListener('pointermove', move); g.removeEventListener('pointerup', up); g.removeEventListener('pointercancel', up); root.classList.remove('dock-resizing'); saveWidth(clampDock(width())); };
      g.addEventListener('pointermove', move); g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up);
    });
    g.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowLeft' ? 24 : e.key === 'ArrowRight' ? -24 : 0; if (!d) return;
      e.preventDefault(); setWidth(width() + d); saveWidth(clampDock(width()));
    });
    return g;
  }
  const layout = () => {   // wide enough: beside the page (with a grip); narrow: over it
    if (!frame) return;
    const wide = window.innerWidth >= bp('split');
    root.classList.toggle('dock-docked', wide);
    if (wide && !grip) { grip = makeGrip(); doc.body.appendChild(grip); setWidth(getWidth()); }
    if (!wide && grip) { grip.remove(); grip = null; }
    if (wide) setWidth(width() || getWidth());
  };
  const urlFor = (screen) => chrome.runtime.getURL('popup.html') + '?surface=float' + (screen ? '&t=' + Date.now() + '#' + screen : '');
  /** Shows the app, optionally on one screen ('feeds', 'history', 'notes', 'settings'). Already open: switches the screen. */
  function open(screen) {
    if (frame) { if (screen) frame.src = urlFor(screen); return; }
    frame = doc.createElement('iframe');
    frame.className = 'app-dock'; frame.title = T('Open app');
    frame.src = urlFor(screen);
    doc.body.appendChild(frame);
    setState(true);
    edge.hidden = true;
    root.classList.add('dock-open');
    setWidth(getWidth()); layout();
    const raf = (doc.defaultView && doc.defaultView.requestAnimationFrame && doc.defaultView.requestAnimationFrame.bind(doc.defaultView)) || ((f) => setTimeout(f, 16));
    raf(() => raf(() => { if (frame) frame.classList.add('dock-in'); }));   // after the first paint, so it slides
  }
  function toggle() { if (frame) close(); else open(); }
  if (button) button.addEventListener('click', toggle);
  edge.addEventListener('click', toggle);
  window.addEventListener('resize', layout);
  window.addEventListener('message', (e) => {
    if (frame && e.source === frame.contentWindow && e.origin === location.origin && e.data && e.data.aishFloat === 'close') close();
  });
  return { toggle, open, close, isOpen: () => !!frame };
}

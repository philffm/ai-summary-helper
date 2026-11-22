// articleAsk.js — ask a saved article a question. One module for every place that offers it (the "Ask" tab of the article view,
// the reading view): prompt and parsing come from conversation.js, the answers are drawn by qaView.js, the model call is feedAi.aiComplete.
// Answers are kept as `turns` on the article (StorageManager.saveConversation); a pinned turn becomes part of the summary and the exports.
import { T } from './feedI18n.js';
import { buildPrompt, parseAnswer, newTurn, answerPreview } from './conversation.js';
import { turnEl } from './qaView.js';

const defaultAsk = async (system, user, signal, onProgress) => {
  const { aiComplete } = await import('./feedAi.js');   // the AI client loads with the first question
  return aiComplete(system, user, null, signal, onProgress, { partial: true, feature: 'qa' });
};

/**
 * mount: the element to fill. article: { id, title }. content / summary: HTML strings (the model gets them as plain text).
 * turns: the article's conversation array (changed in place). save(turns): stores it. onChange(): after a turn was added or pinned.
 * ask(system, user, signal, onProgress) → raw reply; replaceable for tests.
 */
export function createArticleAsk({ mount, article, content, summary, turns, save, onChange = () => {}, ask = defaultAsk, doc = document }) {
  const mk = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const thread = mk('div', 'ask-thread'), starters = mk('div', 'ask-starters'), status = mk('p', 'ask-status'); status.setAttribute('role', 'status'); status.hidden = true;
  const form = mk('form', 'ask-form');
  const input = mk('input'); input.type = 'text'; input.maxLength = 400; input.placeholder = T('Ask about this article…'); input.setAttribute('aria-label', input.placeholder);
  const go = mk('button', 'button-primary', T('Ask')); go.type = 'submit';
  form.append(input, go);
  mount.replaceChildren(thread, starters, status, form);

  let ctrl = null, pool = [];
  const persist = async () => { try { await save(turns); } catch (_) { /* kept in memory; the next save retries */ } };
  const onPin = async () => { await persist(); onChange(); };
  const paint = () => {
    thread.replaceChildren(...turns.map((t) => turnEl(t, { onPin, onSource: (quote, chip) => { chip.classList.toggle('chat-src--open'); chip.textContent = chip.classList.contains('chat-src--open') ? '¶ ' + quote : '¶ ' + (quote.length > 38 ? quote.slice(0, 37) + '…' : quote); } })));
    const ideas = pool.length ? pool : (turns.length ? [] : [T('What are the key points?'), T('Who is this for, and what does it assume?'), T('What is missing or one-sided?')]);
    starters.replaceChildren(...ideas.slice(0, 3).map((q) => { const b = mk('button', 'button-secondary btn-sm ask-chip', q); b.type = 'button'; b.addEventListener('click', () => submit(q)); return b; }));
  };
  const setBusy = (on) => { input.disabled = on; go.textContent = on ? T('Stop') : T('Ask'); go.type = on ? 'button' : 'submit'; };
  go.addEventListener('click', () => { if (ctrl) ctrl.abort(); });

  async function submit(question) {
    const q = String(question || '').trim(); if (!q || ctrl) return;
    input.value = ''; status.hidden = true; ctrl = new AbortController(); setBusy(true);
    const live = mk('div', 'chat-turn-group'); live.append(mk('div', 'chat-q', q)); const liveA = mk('div', 'chat-a'); const liveBody = mk('div', 'chat-a-body', T('Thinking…')); liveA.append(liveBody); live.append(liveA); thread.append(live);
    let partial = '';
    try {
      const { system, user } = buildPrompt({ title: article.title, content, summary, turns, question: q });
      const raw = await ask(system, user, ctrl.signal, (m) => { const t = m && m.text ? answerPreview(m.text) : ''; if (t) { partial = t; liveBody.textContent = t; } });
      const parsed = parseAnswer(raw, content);
      turns.push(newTurn(turns, { q, a: parsed.a || T('No answer.'), sources: parsed.sources }));
      pool = (parsed.questions || []).filter(Boolean);
      await persist(); onChange();
    } catch (e) {
      if (e && (e.name === 'AbortError' || e.cancelled)) {   // stopped: keep what was written, as an unpinned turn
        if (partial) { turns.push({ ...newTurn(turns, { q, a: partial, sources: [] }), pinned: false }); await persist(); onChange(); }
      } else { status.textContent = T('Could not get an answer: {why}', { why: String((e && e.message) || e) }); status.hidden = false; input.value = q; }
    } finally { ctrl = null; setBusy(false); paint(); input.focus(); }
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(input.value); });
  paint();
  return { submit, focus: () => input.focus(), destroy: () => { if (ctrl) ctrl.abort(); } };
}

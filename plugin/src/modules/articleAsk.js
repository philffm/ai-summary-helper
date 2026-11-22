// articleAsk.js — ask a saved article a question. One module for every place that offers it (the "Ask" tab of the article view,
// the reading view): prompt and parsing come from conversation.js, the answers are drawn by qaView.js, the model call is feedAi.aiComplete.
// Answers are kept as `turns` on the article (StorageManager.saveConversation); a pinned turn becomes part of the summary and the exports.
import { T } from './feedI18n.js';
import { buildPrompt, parseAnswer, newTurn, answerPreview, joinContinuation } from './conversation.js';
import { iconEl } from './icons.js';
import { turnEl } from './qaView.js';

const defaultAsk = async (system, user, signal, onProgress) => {
  const { aiComplete } = await import('./feedAi.js');   // the AI client loads with the first question
  return aiComplete(system, user, null, signal, onProgress, { partial: true, feature: 'qa' });
};

/**
 * mount: the element to fill. article: { id, title }. content / summary: HTML strings (the model gets them as plain text).
 * turns: the article's conversation array (changed in place). save(turns, pool, quick): stores it. onChange(): after a turn was added or pinned.
 * pool: suggested follow-up questions; quick: { question: short answer } for those that already came with an answer.
 * A suggestion with a ready answer (⚡) is answered at once, without a model call; the others are sent to the current model.
 * An instant answer has a "Dig deeper" button that asks the model to continue it.
 * ask(system, user, signal, onProgress) → raw reply; replaceable for tests.
 */
export function createArticleAsk({ mount, article, content, summary, turns, pool: initialPool = [], quick: initialQuick = {}, save, onChange = () => {}, ask = defaultAsk, doc = document }) {
  const mk = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const thread = mk('div', 'ask-thread'), starters = mk('div', 'ask-starters'), status = mk('p', 'ask-status'); status.setAttribute('role', 'status'); status.hidden = true;
  const form = mk('form', 'ask-form');
  const input = mk('input'); input.type = 'text'; input.maxLength = 400; input.placeholder = T('Ask about this article…'); input.setAttribute('aria-label', input.placeholder);
  const go = mk('button', 'button-primary', T('Ask')); go.type = 'submit';
  form.append(input, go);
  mount.replaceChildren(thread, starters, status, form);

  let ctrl = null, pool = (initialPool || []).filter((q) => typeof q === 'string' && q.trim()), quick = { ...(initialQuick || {}) };
  const asked = () => new Set(turns.map((t) => t.q.trim().toLowerCase()));
  const persist = async () => { try { await save(turns, pool, quick); } catch (_) { /* kept in memory; the next save retries */ } };
  const onPin = async () => { await persist(); onChange(); };
  const paint = () => {
    const nodes = turns.map((t) => {
      const el = turnEl(t, { onPin, onSource: (quote, chip) => { chip.classList.toggle('chat-src--open'); chip.textContent = chip.classList.contains('chat-src--open') ? '¶ ' + quote : '¶ ' + (quote.length > 38 ? quote.slice(0, 37) + '…' : quote); } });
      if (t.quick) {   // answered from the stored short answer: the model can take it further
        const dig = mk('button', 'button-secondary btn-sm ask-dig', T('Dig deeper')); dig.type = 'button';
        dig.addEventListener('click', () => submit(t.q, { dig: t }));
        const foot = el.querySelector('.chat-a-foot'); if (foot) foot.append(dig);
      }
      return el;
    });
    thread.replaceChildren(...nodes);
    const seen = asked();
    const open = pool.filter((q) => !seen.has(q.trim().toLowerCase()));
    const instant = open.filter((q) => typeof quick[q] === 'string' && quick[q]), later = open.filter((q) => !instant.includes(q));
    const ideas = (instant.length || later.length) ? [...instant, ...later] : (turns.length ? [] : [T('What are the key points?'), T('Who is this for, and what does it assume?'), T('What is missing or one-sided?')]);
    starters.replaceChildren(...ideas.slice(0, 4).map((q) => {
      const isInstant = instant.includes(q);
      const b = mk('button', 'button-secondary btn-sm ask-chip' + (isInstant ? ' ask-chip--instant' : ''));
      b.type = 'button';
      if (isInstant) b.append(iconEl('zap', 'icon--sm'));
      b.append(doc.createTextNode(q));
      b.title = isInstant ? T('Answer is ready: shown at once') : T('Asks the model');
      b.addEventListener('click', () => submit(q));
      return b;
    }));
  };
  const setBusy = (on) => { input.disabled = on; go.textContent = on ? T('Stop') : T('Ask'); go.type = on ? 'button' : 'submit'; };
  go.addEventListener('click', () => { if (ctrl) ctrl.abort(); });

  const forget = (q) => { pool = pool.filter((x) => x !== q); delete quick[q]; };
  async function submit(question, { dig = null } = {}) {
    const q = String(question || '').trim(); if (!q || ctrl) return;
    // a suggestion that came with its answer: no model call
    if (!dig && typeof quick[q] === 'string' && quick[q] && !asked().has(q.toLowerCase())) {
      turns.push({ ...newTurn(turns, { q, a: quick[q], sources: [] }), quick: true });
      forget(q); await persist(); onChange(); paint(); return;
    }
    input.value = ''; status.hidden = true; ctrl = new AbortController(); setBusy(true);
    const live = mk('div', 'chat-turn-group'); live.append(mk('div', 'chat-q', q)); const liveA = mk('div', 'chat-a'); const liveBody = mk('div', 'chat-a-body', dig ? dig.a : T('Thinking…')); liveA.append(liveBody); live.append(liveA);
    if (dig) { const old = thread.querySelector(`[data-turn="${dig.id}"]`); if (old) old.replaceWith(live); else thread.append(live); } else thread.append(live);
    let partial = '';
    try {
      const earlier = dig ? turns.filter((t) => t !== dig) : turns;
      const { system, user } = buildPrompt({ title: article.title, content, summary, turns: earlier, question: q, draft: dig ? dig.a : '' });
      const raw = await ask(system, user, ctrl.signal, (m) => { const t = m && m.text ? answerPreview(m.text) : ''; if (t) { partial = t; liveBody.textContent = dig ? joinContinuation(dig.a, t) : t; } });
      const parsed = parseAnswer(raw, content);
      if (dig) { dig.a = joinContinuation(dig.a, parsed.a) || dig.a; dig.sources = parsed.sources; delete dig.quick; }
      else turns.push(newTurn(turns, { q, a: parsed.a || T('No answer.'), sources: parsed.sources }));
      forget(q);
      pool = [...(parsed.questions || []).filter(Boolean), ...pool]; quick = { ...quick, ...(parsed.quick || {}) };
      await persist(); onChange();
    } catch (e) {
      if (e && (e.name === 'AbortError' || e.cancelled)) {   // stopped: keep what was written
        if (partial && dig) { dig.a = joinContinuation(dig.a, partial); delete dig.quick; await persist(); onChange(); }
        else if (partial) { turns.push({ ...newTurn(turns, { q, a: partial, sources: [] }), pinned: false }); forget(q); await persist(); onChange(); }
      } else { status.textContent = T('Could not get an answer: {why}', { why: String((e && e.message) || e) }); status.hidden = false; if (!dig) input.value = q; }
    } finally { ctrl = null; setBusy(false); paint(); input.focus(); }
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(input.value); });
  paint();
  return { submit, focus: () => input.focus(), destroy: () => { if (ctrl) ctrl.abort(); } };
}

// content/markdown.js — turning model output into safe HTML. Pure text/DOMParser work, so the background worker can use it too.

/**
 * Sanitize AI-generated HTML against an explicit allowlist of tags.
 *
 * The summary HTML originates from an LLM API response (or a user-supplied
 * custom endpoint) and is inserted into the visited page's DOM via
 * innerHTML. Without sanitization, a malicious/compromised endpoint — or a
 * prompt-injection where page content coerces the model into echoing
 * attacker-supplied markup — could inject arbitrary script/event-handler
 * markup into the page. This strips every tag and attribute not on the
 * allowlist, keeping only the tags the system prompt actually asks for
 * (plus the heading/list tags markdownToHtml itself emits).
 *
 * @param {string} html raw HTML to sanitize
 * @returns {string} sanitized HTML containing only allowlisted tags, no attributes
 */
export function sanitizeHtml(html) {
  // Tags markdownToHtml emits plus the ones the system prompt requests.
  const ALLOWED_TAGS = new Set(['h1', 'h2', 'h3', 'p', 'ul', 'li', 'strong', 'em', 'br']);
  // No attributes are needed for any of these tags; strip them all.
  const ALLOWED_ATTRS = new Set();

  if (typeof document === 'undefined') {
    // Non-DOM context (e.g. tests): fall back to a conservative regex strip.
    // (also the background worker, which finishes summaries of closed pages): allowed tags are re-emitted WITHOUT attributes.
    return String(html)
      .replace(/<(script|style|template|noscript)[\s\S]*?<\/\1>/gi, '')
      .replace(/<[^>]*>/g, (tag) => {
        const m = tag.match(/^<(\/?)\s*([a-zA-Z0-9]+)/);
        const name = m && m[2].toLowerCase();
        return name && ALLOWED_TAGS.has(name) ? '<' + m[1] + name + '>' : '';
      });
  }

  // Parse into an INERT document: nothing in it loads, runs or fires handlers (an <img onerror> set through
  // innerHTML on an element of the live page can execute while the sanitizer is still working).
  const container = new DOMParser().parseFromString(`<body>${String(html)}</body>`, 'text/html').body;

  // Post-order: sanitize a node's subtree BEFORE keeping or unwrapping it. Unwrapping promotes the children into
  // the parent at an index the (descending) loop never revisits, so an unsanitized walk would let
  // <div><p onclick=…> / <div><img onerror=…> escape the allowlist (the model is asked to wrap its reply in a <div>).
  const walk = (node) => {
    for (let i = node.children.length - 1; i >= 0; i--) {
      const child = node.children[i];
      const tag = child.tagName ? child.tagName.toLowerCase() : '';
      walk(child);
      if (tag && ALLOWED_TAGS.has(tag)) {
        for (let a = child.attributes.length - 1; a >= 0; a--) {
          const attr = child.attributes[a].name;
          if (!ALLOWED_ATTRS.has(attr.toLowerCase())) child.removeAttribute(attr);
        }
      } else {
        const parent = child.parentNode;
        if (tag === 'script' || tag === 'style' || tag === 'template' || tag === 'noscript') { parent.removeChild(child); continue; }
        while (child.firstChild) parent.insertBefore(child.firstChild, child);
        parent.removeChild(child);
      }
    }
  };

  walk(container);
  return container.innerHTML;
}

/**
 * Convert simple markdown to HTML, then sanitize the result against an
 * allowlist so it is safe to insert into the page via innerHTML.
 */
/**
 * Drop model reasoning that leaked into the answer: <think>…</think> blocks and a leading
 * "Thinking Process: …" preamble (everything before the first <div>/<h2>/<p>). While streaming, a preamble whose
 * HTML has not started yet yields '' so it never flashes on the page.
 */
export function stripReasoning(text) {
  let t = String(text == null ? '' : text);
  t = t.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').replace(/<think(?:ing)?>[\s\S]*$/i, '');
  if (/^\s*(?:```[a-z]*\s*)?(?:\*\*)?(?:thinking(?: process)?|reasoning|analysis)(?:\*\*)?\s*:/i.test(t)) {
    const m = t.search(/<(?:div|h2|p)\b/i);
    t = m === -1 ? '' : t.slice(m);
  }
  // Some models (Gemini Flash especially) write out their plan instead of / before the answer:
  // "* Content: …  * Style Requirements: …  Output ONLY `<div>` …". Drop that; HTML in backticks is not the answer.
  const lead = t.trimStart();
  if (lead && lead[0] !== '<' && !/^```/.test(lead)) {
    const PLAN = /(?:^|\n)\s*(?:[*•-]|\d+\.)\s+\**[A-Za-z][\w \/-]{1,30}\**\s*:/;   // "* Format: …", "* Style Requirements: …"
    const at = t.search(/(?<!`)<(?:div|h2)\b/i);
    if (at > 0 && PLAN.test(t.slice(0, at))) t = t.slice(at);
    else if (at === -1 && PLAN.test(t) && /`<(?:div|h2|p)>`/.test(t)) t = '';
  }
  return t;
}

export function markdownToHtml(text) {
  const html = stripReasoning(text)
    .replace(/^```(?:html)?\n?/gi, '').replace(/\n?```$/g, '') // Strip code blocks
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/^\* (.*$)/gim, '<ul><li>$1</li></ul>').replace(/<\/ul>\n<ul>/g, '') // Basic lists
    .replace(/\n/g, '<br>'); // Handle line breaks
  return sanitizeHtml(html);
}

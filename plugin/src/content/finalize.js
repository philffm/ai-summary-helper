import { ttsLang, langBase } from '../modules/languages.js';
import { applyScholarly, paperIndexFields } from './paper.js';
import { ensureGeneralTag, normalizeGhostQuotes, extractSummaryTitle, saveToLocalStorage } from './core.js';
import { markdownToHtml, stripReasoning } from './markdown.js';
// content/finalize.js
// Everything that happens AFTER the model has finished writing: pull the metadata comments out of the raw text,
// build the HTML, tags, language tags, title. It needs no page DOM, so it runs in the content script (normal case)
// and in the background worker (when the tab navigated away while the model was still writing).

/** Incremental parser for the streamed API response: {summary, thinking} so far. */
export function createStreamParser(service) {
  let buffer = '', summary = '', thinking = '';
  const line1 = (line) => {
    line = line.trim();
    if (!line || line === 'data: [DONE]') return;
    try {
      const json = JSON.parse(line.startsWith('data: ') ? line.substring(6) : line);
      let piece = '';
      if (service === 'gemini') piece = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
      else if (service === 'ollama') { piece = json.message?.content || json.response || ''; if (!piece && json.message?.thinking) thinking += json.message.thinking; }
      else piece = json.choices?.[0]?.delta?.content || json.message?.content || json.response || '';
      if (piece) summary += piece;
    } catch (_) { /* partial JSON */ }
  };
  return {
    push(chunk) { buffer += chunk; const lines = buffer.split('\n'); buffer = lines.pop(); lines.forEach(line1); },
    end() { if (buffer) { line1(buffer); buffer = ''; } },
    get summary() { return summary; },
    get thinking() { return thinking; }
  };
}

/** Language of the source text: detected on the device (no network), else the page's <html lang>; '' when unknown. */
export function detectContentLang(text, htmlLang) {
  const fallback = langBase(htmlLang || '');
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v || fallback); } };
    try {
      const api = (typeof browser !== 'undefined' && browser.i18n && browser.i18n.detectLanguage) ? browser : chrome;
      const handle = (r) => { const l = r && r.languages && r.languages[0]; done(l && (r.isReliable !== false || l.percentage >= 60) ? langBase(l.language) : ''); };
      const p = api.i18n.detectLanguage(String(text || '').slice(0, 1500), handle);
      if (p && p.then) p.then(handle).catch(() => done(''));
    } catch (_) { done(''); }
  });
}

/**
 * @param {object} o  raw, thinking, contentText, pageTitle (title for tag matching), selectedLanguage, htmlLang,
 *   pageMeta (base metadata, may be {}), ghostMax, fixedTitle ('' = derive), attachedTitle (string when a PDF was attached, else null)
 * @returns {Promise<{error:string}|{cleanHtml,tags,ghostQuotes,moodScore,questions,pageMeta,title}>}
 */
export async function finalizeSummary(o) {
  let summary = stripReasoning(o.raw || '');
  if (!summary.trim() && (o.thinking || '').trim()) summary = stripReasoning(o.thinking);
  if (!summary.trim()) return { error: 'The model wrote its own notes instead of a summary. Try again or pick another model.' };

  let tags = [];
  const tagMatch = summary.match(/<!--\s*TAGS?\s*:\s*([\s\S]*?)\s*-->/i);
  if (tagMatch) {
    const seen = new Set();
    tags = tagMatch[1].replace(/^\s*\[|\]\s*$/g, '').split(/[,;\n]+/)
      .map(t => t.trim().replace(/^["'#]+|["']+$/g, '')).filter(Boolean)
      .filter(t => { const key = t.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
  }
  tags = await ensureGeneralTag(tags, o.contentText || '', o.pageTitle || '');
  // Language tags: "🌐 de" for the text the page is written in, plus "🌐 en" when the summary is in another language.
  const sumLang = langBase(ttsLang(o.selectedLanguage));
  const srcLang = await detectContentLang(o.contentText || '', o.htmlLang || '');
  {
    const have = new Set(tags.map(t => t.toLowerCase()));
    [srcLang, sumLang !== srcLang ? sumLang : ''].filter(Boolean).forEach((l) => { const t = '🌐 ' + l; if (!have.has(t.toLowerCase())) tags.push(t); });
  }
  let ghostQuotes = [];
  const ghostMatch = summary.match(/<!--\s*GHOST_HIGHLIGHTS:\s*([\s\S]*?)\s*-->/i);
  if (ghostMatch) {
    try { ghostQuotes = JSON.parse(ghostMatch[1].trim().replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim()); }
    catch (e) { console.warn('[AI Summary Helper] Failed to parse ghost quotes:', e); }
  }
  ghostQuotes = normalizeGhostQuotes(ghostQuotes, o.ghostMax);
  // Mood (-1..1) the model rated for the whole article; anything unparsable or out of range is ignored.
  let moodScore;
  const moodMatch = summary.match(/<!--\s*MOOD:\s*(-?\d*\.?\d+)\s*-->/i);
  if (moodMatch) { const v = parseFloat(moodMatch[1]); if (isFinite(v) && v >= -1 && v <= 1) moodScore = Math.round(v * 100) / 100; }

  let pageMeta = { ...(o.pageMeta || {}), ...(srcLang ? { contentLang: srcLang } : {}), summaryLang: sumLang };   // read aloud picks voices from these
  // The model's verdict on "is this a paper?" (works for PDFs and pages without metadata); merged with the page signals.
  try {
    const sm = summary.match(/<!--\s*SCHOLARLY:\s*([\s\S]*?)\s*(?:-->|$)/i);
    if (sm) { const merged = applyScholarly(pageMeta.paper || null, sm[1]); if (merged) pageMeta.paper = merged; else delete pageMeta.paper; }
  } catch (_) { /* optional */ }

  // Suggested follow-up questions: parsing is forgiving (a missing "-->" or non-JSON list still yields the quoted questions).
  let questions = [];
  const qMatch = summary.match(/<!--\s*QUESTIONS:\s*([\s\S]*?)\s*(?:-->|$)/i);
  if (qMatch) {
    const body = qMatch[1].trim().replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
    let arr = null;
    try { arr = JSON.parse(body); } catch (e) { arr = [...body.matchAll(/["“]([^"”\n]{4,120})["”]/g)].map(x => x[1]); }
    if (Array.isArray(arr)) questions = arr.map(x => String(x || '').trim()).filter(x => x.length >= 4 && x.length <= 120).slice(0, 3);
  }

  const cleanRawText = summary
    .replace(/<!--\s*GHOST_HIGHLIGHTS:\s*([\s\S]*?)\s*-->/gi, '')
    .replace(/<!--\s*TAGS:\s*[^>]+\s*-->/gi, '')
    .replace(/<!--\s*MOOD:[^>]*-->/gi, '')
    .replace(/<!--\s*SCHOLARLY:[\s\S]*?(?:-->|$)/gi, '')
    .replace(/<!--\s*QUESTIONS:[\s\S]*?(?:-->|$)/gi, '')
    .trim();
  const cleanHtml = markdownToHtml(cleanRawText);
  // document.title is often empty (PDFs especially): fall back to the summary's own <h2>.
  const title = o.attachedTitle !== null && o.attachedTitle !== undefined
    ? (extractSummaryTitle(cleanHtml) || o.attachedTitle || 'Untitled')
    : (o.fixedTitle || extractSummaryTitle(cleanHtml) || 'Untitled');
  return { cleanHtml, tags, ghostQuotes, moodScore, questions, pageMeta, title };
}

/** Same as the in-page path: store the finished summary. `ctx` is what the page handed to the background when the run started. */
export function saveFinished(ctx, f, contentHtml) {
  const extra = { ...(ctx.feedUrl && ctx.feedUrl !== ctx.sourceUrl ? { feedUrl: ctx.feedUrl } : {}), ...paperIndexFields(f.pageMeta && f.pageMeta.paper) };
  return saveToLocalStorage(contentHtml, f.cleanHtml, ctx.sourceUrl, f.title, '', f.tags, ctx.modelIdentifier, ctx.summaryLength, f.moodScore, extra, f.pageMeta);
}

/** Background: a run whose page went away is finished here. */
export async function finishDetached(ctx, raw, thinking) {
  const f = await finalizeSummary({
    raw, thinking, contentText: ctx.contentText, pageTitle: ctx.pageTitle, selectedLanguage: ctx.selectedLanguage,
    htmlLang: ctx.htmlLang, pageMeta: ctx.pageMeta, ghostMax: ctx.ghostMax, fixedTitle: ctx.fixedTitle, attachedTitle: ctx.attachedTitle
  });
  if (f.error) return { error: f.error };
  const article = await saveFinished(ctx, f, ctx.contentHtml || '');
  return { ...f, article };
}

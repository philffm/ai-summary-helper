// ankiExport.js — flashcards from a graph topic, as a text file Anki imports (File ▸ Import). Everything is local; nothing is generated here.
//
// A card is a question you asked and the answer you kept:
//   • the answers you PINNED under an article (the follow-up conversation stored with it), and
//   • the questions you asked on the topic page (answers over the saved summaries of the whole topic).
// A briefing without a question is not a card. Highlights are not cards either: a quote without a question teaches little.
// The file uses Anki's import directives (deck, note type, tags, a stable id per card), so importing it again updates the cards
// instead of duplicating them.
import { T } from './feedI18n.js';
import { articleRecKey } from './storageKeys.js';
import { safeFileName } from './articleFormat.js';

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Plain text → the HTML Anki shows: escaped, line breaks kept. Answers may contain Markdown; it stays readable as plain text. */
export const toHtml = (s) => esc(String(s || '').trim()).replace(/\r?\n/g, '<br>');
const tagOf = (s) => String(s || '').trim().replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_:-]/gu, '').slice(0, 40);
const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return 'aish' + (h >>> 0).toString(36); };
/** One field of the tab-separated file: tabs become spaces; a field with a quote is wrapped and its quotes doubled (what Anki expects). */
const field = (s) => { const v = String(s).replace(/\t/g, ' ').replace(/\r?\n/g, ' '); return /"/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };

const sourceLine = (a) => (a && (a.title || a.url)
    ? `<br><br><small>${T('Source')}: ${esc(a.title || a.url)}${a.url ? ' · ' + esc(a.url) : ''}</small>` : '');

/** Cards from one article's follow-up conversation: its pinned turns. */
export function cardsFromTurns(article, turns) {
    return (turns || []).filter(t => t && t.pinned && String(t.q || '').trim() && String(t.a || '').trim()).map(t => ({
        id: hash('turn|' + (article.id || article.url || '') + '|' + String(t.q).trim()),
        front: toHtml(t.q), back: toHtml(t.a) + sourceLine(article)
    }));
}

/** Cards from what was asked on the topic page: [{ question, text, articles }]. Answers cite sources as [n]; those articles are listed. */
export function cardsFromResults(results, topic) {
    return (results || []).filter(r => r && String(r.question || '').trim() && String(r.text || '').trim()).map(r => {
        const arts = (r.articles || []).filter(a => a && (a.title || a.url));
        const sources = arts.length ? `<br><br><small>${T('Sources')}: ${arts.map((a, i) => `${i + 1}. ${esc(a.title || a.url)}`).join('; ')}</small>` : '';
        return { id: hash('ask|' + topic + '|' + String(r.question).trim()), front: toHtml(r.question), back: toHtml(r.text) + sources };
    });
}

/** The import file. Columns: id, front, back, tags. */
export function ankiFile({ deck, tags = [], cards }) {
    const tagStr = ['aish', ...tags].map(tagOf).filter(Boolean).join(' ');
    const head = ['#separator:tab', '#html:true', '#guid column:1', '#notetype:Basic', '#deck:' + String(deck || 'AI Summary Helper').replace(/[\t\r\n]+/g, ' '), '#tags column:4'];
    const seen = new Set();
    const rows = cards.filter(c => !seen.has(c.id) && seen.add(c.id)).map(c => [c.id, field(c.front), field(c.back), tagStr].join('\t'));
    return head.concat(rows).join('\n') + '\n';
}

/** Reads the pinned turns of the given articles from storage and adds the topic page's questions. Returns the cards. */
export async function collectCards({ articles, results, topic }) {
    const get = (k) => new Promise(resolve => chrome.storage.local.get(k, resolve));
    const list = (articles || []).filter(a => a && a.id && !a.feedStub);
    const cards = [];
    for (let i = 0; i < list.length; i += 25) {
        const chunk = list.slice(i, i + 25);
        const recs = await get(chunk.map(a => articleRecKey(a.id)));
        for (const a of chunk) { const rec = recs[articleRecKey(a.id)]; if (rec && Array.isArray(rec.conversation)) cards.push(...cardsFromTurns(a, rec.conversation)); }
    }
    cards.push(...cardsFromResults(results, topic));
    return cards;
}

/** Builds the file and saves it. Resolves with the number of cards (0 = nothing was saved). */
export async function exportAnki({ articles, results, topic }) {
    const cards = await collectCards({ articles, results, topic });
    if (!cards.length) return 0;
    const text = ankiFile({ deck: 'AI Summary Helper::' + topic, tags: [topic], cards });
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `anki_${safeFileName(topic).replace(/\s+/g, '_').toLowerCase()}_${new Date().toISOString().split('T')[0].replace(/-/g, '')}_${cards.length}cards.txt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return cards.length;
}

// Local MCP (modules/mcp/): tool handlers against a fixture library, scope enforcement, exclude tag, save_url validation + rate limit, and the client's wire-level tool list matching tools.js 1:1.
import assert from 'assert';
import { SK, articleRecKey, collRecKey } from '../src/modules/storageKeys.js';
import { pageKeyForUrl } from '../src/modules/pageKey.js';
import { TOOLS, TOOL_SCOPE, requireScope, ToolError, htmlToPlainText } from '../src/modules/mcp/tools.js';
import { toolDefinitions, toolList } from '../src/modules/mcp/client.js';

const now = Date.UTC(2026, 9, 26); // 2026-10-26, matches "today" elsewhere in this session

function fixture() {
    const store = {
        [SK.articlesIndex]: [
            { id: 'a1', title: 'EU AI Act enforcement begins', url: 'https://example.com/eu-ai-act', timestamp: Date.UTC(2026, 8, 10), tags: ['eu', 'ai-act'], summary: 'The EU AI Act enforcement regime starts rolling out across member states.' },
            { id: 'a2', title: 'Ad tracking after the cookie phase-out', url: 'https://example.com/ad-tracking', timestamp: Date.UTC(2026, 8, 20), tags: ['ads', 'privacy'], summary: 'Advertisers pivot to first-party data for ad tracking.' },
            { id: 'a3', title: 'My private note', url: 'https://example.com/secret', timestamp: Date.UTC(2026, 8, 22), tags: ['private'], summary: 'Nothing to see here.' },
            { id: 'a4', title: 'Saved for the weekend', url: 'https://example.com/weekend-read', timestamp: now - 2 * 86400000, isDecision: true, decisionTimeframe: 'tomorrow', decisionReason: 'quick read', decisionSavedAt: new Date(now - 2 * 86400000).toISOString(), tags: [] },
        ],
        [articleRecKey('a1')]: { content: 'Full text of the AI Act article. '.repeat(50) },
        [SK.annotations]: [
            { url: pageKeyForUrl('https://example.com/eu-ai-act'), text: 'Key clause on enforcement.', type: 'user', timestamp: Date.UTC(2026, 8, 11) },
            { url: pageKeyForUrl('https://example.com/secret'), text: 'Should never surface.', type: 'user', timestamp: Date.UTC(2026, 8, 23) },
        ],
        [SK.collIndex]: [{ id: 'c1', name: 'Ad tracking', question: 'How is tracking changing?', n: 1, updated: '2026-10-01' }],
        [collRecKey('c1')]: { name: 'Ad tracking', question: 'How is tracking changing?', sources: [{ articleId: 'a2', addedAt: '2026-09-20' }] },
        [SK.feedSubs]: [{ id: 's1', title: 'Privacy Weekly' }],
        [SK.feedItems]: [{ id: 'i1', feedId: 's1', title: 'New tracking rules proposed', link: 'https://example.com/feed/1', published: Date.UTC(2026, 9, 25), read: false, snippet: 'Regulators propose new limits.' }],
        [SK.inboxPending]: [],
    };
    const storage = { get: async (keys) => {
        const out = {};
        const list = keys == null ? Object.keys(store) : (typeof keys === 'string' ? [keys] : (Array.isArray(keys) ? keys : Object.keys(keys)));
        for (const k of list) out[k] = k in store ? store[k] : (typeof keys === 'object' && !Array.isArray(keys) ? keys[k] : undefined);
        return out;
    } };
    const setStorage = async (obj) => { Object.assign(store, obj); };
    return { store, storage, setStorage };
}

// search_library: ranks by relevance, respects the exclude tag
{
    const { storage } = fixture();
    const results = await TOOLS.search_library({ query: 'ad tracking' }, { storage, excludeTag: 'private' });
    assert(results.length >= 1, 'got results');
    assert.equal(results[0].aish_id, 'a2', 'ad-tracking article ranks first for "ad tracking"');
    assert(results.every((r) => r.aish_id !== 'a3'), 'excluded (private-tagged) article never appears');
    assert(results[0].url && results[0].site === 'example.com' && typeof results[0].snippet === 'string');
}

// get_article: summary + highlights by default, matched via pageKeyForUrl not an articleId field on the highlight
{
    const { storage } = fixture();
    const article = await TOOLS.get_article({ id: 'a1' }, { storage, excludeTag: 'private' });
    assert.equal(article.id, 'a1');
    assert.equal(article.highlights.length, 1);
    assert.equal(article.highlights[0].text, 'Key clause on enforcement.');
    assert(article.summary && article.summary.md, 'summary included by default');
    assert(!article.fulltext, 'fulltext not included unless asked for');
}
{
    const { storage } = fixture();
    const article = await TOOLS.get_article({ id: 'a1', include: ['fulltext'] }, { storage, excludeTag: 'private' });
    assert(article.fulltext && article.fulltext.length > 0);
    assert(!article.summary, 'summary left out when not in include[]');
}
{
    const { storage } = fixture();
    await assert.rejects(() => TOOLS.get_article({ id: 'a3' }, { storage, excludeTag: 'private' }), ToolError, 'excluded article is not_found, not just filtered from lists');
}

// list_highlights: excludes the private article's highlight
{
    const { storage } = fixture();
    const hl = await TOOLS.list_highlights({}, { storage, excludeTag: 'private' });
    assert.equal(hl.length, 1);
    assert.equal(hl[0].aish_id, 'a1');
}

// list_due: 'tomorrow' timeframe is due within 7 days, computed from decisionSavedAt + delay
{
    const { storage } = fixture();
    const due = await TOOLS.list_due({ within_days: 7 }, { storage, excludeTag: 'private' });
    assert.equal(due.length, 1);
    assert.equal(due[0].aish_id, 'a4');
    assert.equal(due[0].timeframe, 'tomorrow');
}

// list_collections / get_collection
{
    const { storage } = fixture();
    const cols = await TOOLS.list_collections({}, { storage });
    assert.equal(cols.length, 1);
    const coll = await TOOLS.get_collection({ id: 'c1' }, { storage, excludeTag: 'private' });
    assert.equal(coll.sources.length, 1);
    assert.equal(coll.sources[0].aish_id, 'a2');
}

// list_feed_items
{
    const { storage } = fixture();
    const items = await TOOLS.list_feed_items({}, { storage });
    assert.equal(items.length, 1);
    assert.equal(items[0].feed, 'Privacy Weekly');
}

// save_url: validates input and marks the item as added by an AI app
{
    const { storage, setStorage, store } = fixture();
    await assert.rejects(() => TOOLS.save_url({ url: 'ftp://nope' }, { storage, setStorage }), ToolError);
    const res = await TOOLS.save_url({ url: 'https://example.com/new', note: 'from the agent' }, { storage, setStorage, now });
    assert.deepEqual(res, { ok: true, where: 'inbox' });
    assert.equal(store[SK.inboxPending].length, 1);
    assert.equal(store[SK.inboxPending][0].platform, 'mcp');
    assert.equal(store[SK.inboxPending][0].description, 'from the agent');
}

// save_url: rate limited after 30 AI-app saves in the last hour
{
    const { storage, setStorage, store } = fixture();
    store[SK.inboxPending] = Array.from({ length: 30 }, (_, i) => ({ id: 'p' + i, url: 'https://example.com/' + i, platform: 'mcp', receivedAt: new Date(now - 1000).toISOString() }));
    await assert.rejects(() => TOOLS.save_url({ url: 'https://example.com/one-too-many' }, { storage, setStorage, now }), (e) => e.code === 'rate_limited');
}

// requireScope: the extension enforces scope, not the relay (PRD S5) — every tool needs a scope, save_url needs write, get_article(fulltext) needs its own scope
{
    assert.throws(() => requireScope('save_url', {}, { library: true }), ToolError);
    assert.doesNotThrow(() => requireScope('save_url', {}, { write: true }));
    assert.throws(() => requireScope('get_article', { include: ['fulltext'] }, { library: true }), (e) => e.code === 'scope_denied');
    assert.doesNotThrow(() => requireScope('get_article', { include: ['fulltext'] }, { library: true, fulltext: true }));
    assert.equal(Object.keys(TOOL_SCOPE).length, Object.keys(TOOLS).length, 'every tool has a declared scope');
}

// client.js's wire-level tool list must match tools.js exactly (one source of truth per tool, two shapes: logic vs. schema)
{
    assert.deepEqual(toolList().sort(), Object.keys(TOOLS).sort());
    assert.deepEqual(Object.keys(toolDefinitions()).sort(), Object.keys(TOOLS).sort());
}

// fulltext is plain text, not raw page HTML (no tags, no inline data: images eating the app's context)
{
    const t = htmlToPlainText('<div><p>Hello &amp; <b>world</b></p><img src="data:image/jpeg;base64,AAAA"><script>x()</script></div>');
    assert.equal(t, 'Hello & world');
}

// feed topic filter matches whole words only ("AI" must not match "MAILAND")
{
    const { storage, store } = fixture();
    store[SK.feedItems].push({ id: 'i2', feedId: 's1', title: 'MAILAND (dpa-AFX) Eni plant Sonderdividende', link: 'https://example.com/feed/2', published: Date.UTC(2026, 9, 25), read: false });
    store[SK.feedItems].push({ id: 'i3', feedId: 's1', title: 'Can AI predict cancer survival?', link: 'https://example.com/feed/3', published: Date.UTC(2026, 9, 25), read: false });
    const items = await TOOLS.list_feed_items({ topic: 'AI' }, { storage });
    assert.deepEqual(items.map((i) => i.url), ['https://example.com/feed/3']);
}

// library_stats: counts only, exclude tag respected, year filter, no article text in the output
{
    const { storage } = fixture();
    const s = await TOOLS.library_stats({ year: 2026 }, { storage, excludeTag: 'private', now });
    assert.equal(s.articles.total, 3, 'a1, a2, a4 (a3 is private)');
    assert.deepEqual(s.articles.perMonth, { '2026-09': 2, '2026-10': 1 });
    assert.equal(s.highlights.total, 1, 'the private article\'s highlight is not counted');
    assert.equal(s.highlights.mostHighlighted[0].aish_id, 'a1');
    assert(s.topTags.some((t) => t.tag === 'privacy') && !s.topTags.some((t) => t.tag === 'private'));
    assert.equal(s.collections, 1);
    assert(!JSON.stringify(s).includes('Nothing to see here'), 'no summaries or text, only counts');
    const none = await TOOLS.library_stats({ year: 2020 }, { storage, excludeTag: 'private', now });
    assert.equal(none.articles.total, 0);
}

console.log('TEST 178 OK');
process.exit(0);

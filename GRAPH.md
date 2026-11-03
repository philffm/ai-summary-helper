# The archive graph

How the graph in the History tab decides what to show, why it opens as topic clusters, and what is still open.
Code: `plugin/src/modules/archiveGraph.js` (drawing, interaction), `plugin/src/modules/graphStructure.js` (the structure, pure functions),
`plugin/src/modules/graphClusters.js` and `graphBrief.js` (the topic page and briefings), `plugin/src/modules/graphSimilarity.js` and `graphSimilarityCache.js` (content similarity, background run, cache).
Tests: `plugin/tests/test128.mjs` (gaps, time window, views), `plugin/tests/test217.mjs` (clusters, bridges, focus, path, source type, maturity), `plugin/tests/test218.mjs` (similarity and its incremental cache).

## Why it opens as clusters

With a few hundred saved articles, "every article and every tag as a node, every link drawn, every title written out" is a hairball.
A graph is readable when it shows **structure first and detail on demand**, the way a digital garden does: a handful of named islands,
small unlabeled dots, links only when asked for. So the graph now has two layouts:

| Layout | When | What you see |
| --- | --- | --- |
| **Topics** (overview) | default from 25 articles on, and whenever there are at least two clusters | One soft area and one label per cluster, one small dot per article, no links, no titles. Click a cluster to focus it. |
| **Detail** | default below 25 articles, or one tap on "Detail" | The node-and-link picture as before (tags as hubs, links, similar-content links). Article titles show on hover, on focus and for search matches, not all at once. |

The choice is remembered for the open graph (`container.__graphLayout`); the switch is the "Topics | Detail" control next to the filter chips.

## Where the clusters come from (all local)

No AI, no network, no extra storage. Clusters are worked out from the tags every time the graph is drawn (`topicClusters()` in `graphStructure.js`):

1. **Tag co-occurrence.** Two tags are related when they sit on the same articles. The strength is the cosine of their article sets
   (`shared / sqrt(a * b)`), so a very common tag does not pull everything together. Weak pairs (< 0.18) are dropped.
2. **Label propagation** over that tag graph (fixed order, ties by id, so the same archive always gives the same clusters; input order does not matter).
3. **One giant cluster is split once** (more than 55 % of the articles and 12+ tags) with a stricter threshold.
4. **At most 9 clusters**, each with at least 3 articles. Everything smaller is folded into "Everything else".
5. **Name:** the most used tag in the cluster (shown in the UI language, one node per topic across spellings, see `topicConcepts.js`).
6. **An article belongs to the cluster most of its tags are in.** An article that is only attached by a similar-content link follows the article it is similar to.

Tags are the only input, so better tags mean better clusters. Tag intelligence (`tagIntelligence.js`) and the topic lexicon feed into that already.

## What the picture says

| Cue | Meaning |
| --- | --- |
| Colour | the cluster (topic) the article sits in |
| Ring: solid dark / dashed / dotted | paper / video / PDF (`sourceType()`: paper detection and your override, then the URL; plain articles have no ring) |
| Fill: faint → solid | how far you got: saved only → opened or noted → opened, summarised and annotated (`maturityOf()`; your highlights and notes are read from storage after the first paint) |
| Larger dot | a **bridge**: its tags reach two or more clusters (`bridgeArticles()`) |
| Faded, red ring (Detail) | not opened for 30+ days (Overview only fades it: the ring would colour half the picture) |

The legend at the bottom right lists the ring styles that are actually present.

## What you can do

- **Focus.** Click a cluster (Topics) or an article (either layout) and the rest steps back. Clusters also zoom in. The bar at the top says what is in focus, offers **Open topic** (the topic page: briefing, questions, never-opened list, Markdown export) and resets. Esc or a tap on the background resets too.
- **Path.** Turn on "Path", pick two items: the shortest chain of shared tags and similar-content links is highlighted and read out ("3 steps: A → tag → B"). "Not connected" is an answer too.
- **Gaps.** Topics with one or two saved articles you have not opened for 30 days. Each has a **Brief me on this** button that opens the topic page for it.
- **Anki cards.** The topic page's "🃏 Anki cards" saves a text file Anki imports (File ▸ Import): one card per **question you asked** and **answer you kept**, namely the answers pinned under the articles of the topic and the questions asked on the topic page. A briefing without a question is not a card, and highlights are not either (a quote without a question teaches little). Nothing is generated at export and nothing leaves the device. Cards carry a stable id, so importing again updates them. With no questions yet it says so instead of saving an empty file.
- **Replay.** In the 🕐 Time panel, "▶ Replay" lets the window grow from the first month to the last (about 15 seconds for any archive), so you watch the archive and its topics build up. Touching a slider, Pause or Reset stops it. With reduced motion there is no animation: the button becomes "Next month →" and steps by hand. Start and end are announced.
- **Color by.** One chip cycles what the dot colours mean, without a redraw: **Topic** (the cluster, default), **Age** (when it was saved; by rank, so a few big import days do not wash out the scale; purple = old, yellow = recent) or **Mood** (the AI's score for the article, orange = negative, blue = positive, grey = not scored; offered only when some articles have a score, and scores are only set on demand). The legend shows the scale. Both scales avoid red/green.
- **Unread.** A chip with the count ("Unread · 200"). Everything marked read (`readAt`: the Inbox / Read tabs and the 🆕 badge use the same) steps back, and in Topics every cluster label shows how many of its articles are still unread ("trade · 34"). A class toggle, no redraw.
- **Obsidian hub note.** The topic page's "⬇ Markdown" export (and the one on briefings) now adds `Hub – <topic>.md`: a map of content that links every exported article note with `[[wikilinks]]`, grouped as worked on / in progress / saved only, unread ones marked 🆕, with the tags inside the topic and a link to the briefing note. The article notes already carried `[[Related]]` links; the hub is what makes the topic one island in Obsidian's own graph too.
- **MCP: `related_articles`.** AI apps paired with the local relay can ask for the saved articles closest to one article (same similarity as the graph, from its cache where current, otherwise from title, tags and summary). Scope "Your library", exclude tag respected (an excluded article is "not found"), metadata and snippet only. The cluster list and a path tool are not built.
- **Save image.** Downloads the current picture as an SVG on your device (colours resolved, no stylesheet needed). Nothing is uploaded.
- Existing: search dims or filters, time window, 🎓 Research filter, list view (the screen-reader twin: press `L`), long-press / ⇧ / ⌘ to select topics for a briefing.

Accessibility: cluster labels are buttons (Enter / Space), every state change is announced in the live region, reduced-motion turns the zoom transition off, and the list view stays the equivalent of the graph.

## How articles are matched with each other

Two separate things:

- **Clusters, bridges, focus and path start from tag links.** Titles and text play no part there.
- **Content similarity** (`graphSimilarity.js`, `graphSimilarityCache.js`) finds each article's closest neighbours from its text and adds them as dashed links (best 2 per article, score ≥ 0.25). It also decides where an article with no usable tag goes: it follows its closest neighbour into that topic.

What the similarity is built from:

| Stage | Input | Where it runs | Cost |
| --- | --- | --- | --- |
| **Quick** | title (×3), tags (×3), summary (×1), from the lean index entry | on open, in slices of 100 articles | a few hundred ms for 1,500 articles, once per new or changed article |
| **Deep** | the saved text (first 30,000 characters) added to the same vector | in the background, 25 texts per storage read, idle time between batches, checkpoint every 100 articles | reading the texts from storage is the real cost, tokenising is cheap |

The picture is drawn at once from the tags. When a better result is ready it is swapped in only if you have not touched the graph yet; otherwise a chip says "Better connections ready" and redraws on tap. While the deep stage runs a quiet chip shows its progress.

Good to know:

- **The search index (`localSearch.js`) never saw the saved text.** It runs on the lean `articlesIndex` (title, tags, summary), and the text lives in one record per article. That is why the graph has its own similarity instead of reusing it. `localSearch.js` also only knows `a–z` words (umlauts and non-Latin scripts fall apart there); `graphSimilarity.js` uses Unicode words, and Han/Kana runs become character pairs.
- **Stop words are dropped by frequency, not by list:** a term in more than 25 % of the articles says nothing, in any language.
- **Each article keeps only its 100 strongest terms** (40 are compared). That is what makes comparing the whole archive fast and the cache small.
- **The cache** is one storage key (`graph:sim`): vectors, fingerprints and the neighbours with the signature they belong to. An article is only worked on again when its fingerprint changes (title, tags, summary length, text length); deleted articles leave the cache. It is derived data: deleted with the history, never part of a backup. With nothing changed, opening the graph reads it once and writes nothing.
- A pair of articles is never compared by an AI and nothing leaves the device.

## Performance

Measured in Node on 1,500 synthetic articles (average text 19 KB, 28 MB in total; a real archive is usually lighter). This is a server CPU, not a phone, and the storage reads were not measured, so treat the numbers as proportions:

| Step | Time |
| --- | --- |
| Search index as it is today (title, tags, summary), rebuilt on every archive change | ~300 ms |
| … plus the first 4,000 characters of the text | ~850 ms |
| Tokenising the **full** text of all 1,500 articles | ~1,200 ms |
| Neighbours for all articles, full vectors, inverted index | ~11,000 ms |
| Neighbours for all articles, naive pairwise | ~55,000 ms |
| **Neighbours for all articles, 40 strongest terms per article** | **~180 ms** |

So the expensive part is not the text but comparing everything with everything; cutting each article down to its strongest terms makes that about 60× cheaper. Synthetic text cannot tell how good the neighbours are; that needs a look at a real archive.

## Prioritisation by user group

Groups are the personas the site already uses. MoSCoW is a judgement from the code and landing pages, not user research; check it against store reviews and feedback.

| Group | Goal with the graph | Must | Should | Could | Won't (now) |
| --- | --- | --- | --- | --- | --- |
| **Hoarder** | Make old saves come back | Topics overview ✅, focus ✅, gaps as action ✅ | cluster names ✅, maturity ✅, Obsidian hub note ✅ | time replay ✅ | 3D |
| **Researcher** | Compare sources, see gaps in the literature | source type ✅, path between papers ✅ | bridge articles ✅ | co-citation links | external databases |
| **Feeds** | See what keeps recurring | clusters per topic ✅ | mood colour ✅ | trend pulse | graph from the live feed |
| **Video** | Learning paths across videos and articles | video ring ✅ | jump to the transcript moment | playlist clusters | – |
| **Privacy** | Be sure nothing leaves the device | local only ✅ (all of the above runs on the device) | save as image ✅ | – | cloud sync |
| **E-reader** | Pick what goes to the device | topic page export ✅ (existing) | "unread only" filter ✅ | – | device sync |
| **Education** | Make understanding visible | maturity ✅, questions per topic ✅ (existing) | flashcards from a topic ✅ (Anki file) | share with a teacher | accounts |
| **MCP** | Give AI apps the archive as context | – | related items as a tool ✅ (`related_articles`); topic list / subgraph | – | write access |

✅ = in this version. Everything without a mark is not built.

## Not done

- **MCP tools** for the topic list and for the path between two articles (`related_articles` exists).
- **Flashcards inside the extension** (spaced repetition, a review screen). The Anki file is the cheap start; a review screen of our own would be a separate product.
- **AI names for clusters.** Names come from the tags on purpose (local, free, stable). An opt-in AI title is possible later.
- **Translations** of the new strings: they fall back to English until `node scripts/feed-i18n.mjs extract` / `merge` has run (release gate).

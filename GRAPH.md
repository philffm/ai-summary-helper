# The archive graph

How the graph in the History tab decides what to show, why it opens as topic clusters, and what is still open.
Code: `plugin/src/modules/archiveGraph.js` (drawing, interaction), `plugin/src/modules/graphStructure.js` (the structure, pure functions),
`plugin/src/modules/graphClusters.js` and `graphBrief.js` (the topic page and briefings), `plugin/src/modules/localSearch.js` (content similarity).
Tests: `plugin/tests/test128.mjs` (gaps, time window, views), `plugin/tests/test217.mjs` (clusters, bridges, focus, path, source type, maturity).

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
- **Save image.** Downloads the current picture as an SVG on your device (colours resolved, no stylesheet needed). Nothing is uploaded.
- Existing: search dims or filters, time window, 🎓 Research filter, list view (the screen-reader twin: press `L`), long-press / ⇧ / ⌘ to select topics for a briefing.

Accessibility: cluster labels are buttons (Enter / Space), every state change is announced in the live region, reduced-motion turns the zoom transition off, and the list view stays the equivalent of the graph.

## How articles are matched with each other

Two separate things, and only one of them looks at the text:

- **Clusters, bridges, focus and path use tag links.** Titles and text play no part.
- **Content similarity** (`localSearch.js`, TF-IDF with cosine) weights `title ×4`, `tags ×3`, `description ×2`, `summary ×1` and the **first 4,000 characters** of the content `×1`. It is built once per archive change and shared with search and "similar articles". It is not the full article.
- In the graph, similarity is **only a fallback**: an article that has no usable tag gets one dashed link to its most similar article (score ≥ 0.15). Articles with tags are never compared with each other by content.

Open: use similarity for every article (see "Not done").

## Prioritisation by user group

Groups are the personas the site already uses. MoSCoW is a judgement from the code and landing pages, not user research; check it against store reviews and feedback.

| Group | Goal with the graph | Must | Should | Could | Won't (now) |
| --- | --- | --- | --- | --- | --- |
| **Hoarder** | Make old saves come back | Topics overview ✅, focus ✅, gaps as action ✅ | cluster names ✅, maturity ✅ | time replay | 3D |
| **Researcher** | Compare sources, see gaps in the literature | source type ✅, path between papers ✅ | bridge articles ✅ | co-citation links | external databases |
| **Feeds** | See what keeps recurring | clusters per topic ✅ | mood colour | trend pulse | graph from the live feed |
| **Video** | Learning paths across videos and articles | video ring ✅ | jump to the transcript moment | playlist clusters | – |
| **Privacy** | Be sure nothing leaves the device | local only ✅ (all of the above runs on the device) | save as image ✅ | – | cloud sync |
| **E-reader** | Pick what goes to the device | topic page export ✅ (existing) | "unread only" filter | – | device sync |
| **Education** | Make understanding visible | maturity ✅, questions per topic ✅ (existing) | flashcards from a topic | share with a teacher | accounts |
| **MCP** | Give AI apps the archive as context | – | subgraph / related items as a tool (`mcp/`) | – | write access |

✅ = in this version. Everything without a mark is not built.

## Not done

- **Content similarity between all articles** (kNN links and a vote on the cluster). Needs a decision on the text cap and on cost: the index is built over the whole archive on every change.
- **Obsidian export with `[[wikilinks]]`** for a cluster (the topic page already exports Markdown).
- **MCP tool** for a subgraph or related items (separate package in `mcp/`).
- **Mood colour**, **time replay**, **flashcards from a topic**, **"unread only" filter**.
- **AI names for clusters.** Names come from the tags on purpose (local, free, stable). An opt-in AI title is possible later.
- **Translations** of the new strings: they fall back to English until `node scripts/feed-i18n.mjs extract` / `merge` has run (release gate).

# The archive graph

How the graph in the History tab decides what to show, why it opens as topic clusters, and what is still open.
Code: `plugin/src/modules/archiveGraph.js` (drawing, interaction), `plugin/src/modules/graphStructure.js` (the structure, pure functions),
`plugin/src/modules/graphClusters.js` and `graphBrief.js` (the topic page and briefings), `plugin/src/modules/graphSimilarity.js` and `graphSimilarityCache.js` (content similarity, background run, cache).
Tests: `test128` (gaps, time window, views), `test217` (clusters, bridges, focus, path, source type, maturity), `test218` (similarity and its incremental cache), `test219` (hub note), `test220` (MCP `related_articles`), `test221` (replay), `test222` (Anki file), `test223` (subtopics), `test224` (every background worker bundle is a valid script), `test225` (language marks), `test226` (articles saved at the same time), `test227` (Topics layout in a real d3), `test228` (tags at the source: category, English names, no attached tags), `test229` (naming tags from the graph: only tag words, local first, preview, stop), `test230` (broader topics), `test231` (names stay literal: a real preview as regression case, translations kept, codes skipped, undo), all in `plugin/tests/`.

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

### Layout: circle packing

Topics uses `d3.pack`: clusters, their subtopics and the articles are nested circles, sized by how many articles they hold and packed without overlap. A big cluster is a big island made of named smaller islands; nothing piles up. The dots shrink as the archive grows (so they never overlap), the cluster and subtopic areas are exactly the enclosing circles, and a resize packs again. A subtopic's name is shown once its area is big enough on screen (about 22 px radius); zooming in brings the rest. The graph sits in the space between the chips on top and the controls at the bottom.

### Where the tags come from (and why that matters for the graph)

The graph is only as good as the tags. They are made when an article is summarised:

1. **The summary prompt** (`content.js`, wording in `modules/topicCategories.js`: `TAG_INSTRUCTION`, `TAG_EXAMPLE`) asks the model to end its reply with a comment like
   `<!-- TAGS: category: Politics, KI-Regulierung = AI regulation, EU-Recht = EU law -->`:
   first **one category** from a fixed list (Technology, Business, Science, Health, Politics, Environment, Society, Lifestyle), then **2–4 specific tags** in the language of the summary, each with its **English name**. This costs no extra request: it is part of the summary.
2. **`parseTagLine()`** (`topicCategories.js`) reads that comment: the category (only if it is on the list; "General" is none), the tags (deduped, a category given as a plain tag counts as the category) and `tagEn` (tag → English name). Older replies ("eins, zwei") still read, as plain tags.
3. **`ensureGeneralTag()`** (`content/core.js`) builds the final list: the category first (the model's choice; only if it named none, the category whose words occur most in the text, `categoryFromText()`; if nothing matches, no category), then the specific tags, at most 7.
   It no longer attaches the library's most used tags by word match. That made the most used tags spread to ever more articles (any article mentioning "AI" got "AI"), which is how one tag ended up on most of the archive. And there is no "General" any more.
4. **Saving** (`content/finalize.js` `withTagEn()`, used by the normal path in `content.js` and by `finishDetached` in the background): `tagEn` is stored on the article's index entry, only when the model gave English names.
5. **Learning** (`learnTagPairs()` in `topicConcepts.js`, called by `articleManager.js` when the History loads): every tag becomes a known spelling of its English name in the topic lexicon. "KI-Regulierung", "AI regulation" and "Régulation de l'IA" then share one `conceptKey`, so search, charts and the graph see one topic. This happens in the History page, not in the content script, so no page writes the lexicon while another one does. Language marks are never learned (see below).
6. **In the graph**, the fixed categories (and the old "General") are passed as `categories` to `topicClusters()`: they are treated like archive-wide umbrella tags. They never form a cluster, never name one and never name a subtopic; the specific tags do that.

Only new summaries get English names. For the tags already in the archive there is **"🏷 n tags without a name"** in the graph (`graphTagNaming.js`):

- **Which tags:** `tagsToName()`: every tag of the archive that is neither a built-in topic nor learned yet, most used first. Categories, "General" and language marks are left out.
- **Where it goes:** `namingRoute()`: if summaries run on a local connection, that one; otherwise Ollama when it has been set up (the same rule the feeds' library run uses); otherwise the connection used for summaries. The page says which, before anything is sent.
- **What is sent:** only the tag words, numbered (`nameTags()` in `feedAi.js`, the same prompt as Settings › "Name my tags"). No titles, no article text.
- **Preview first:** "Try 40 tags" asks for one batch and shows each tag with its English name (and the word in the UI language). Nothing is learned yet. "Save these only" or "Save and name the other n" learns them (`applyTagNames()`), then names the rest in batches of 40, saving after each batch, so "Stop" keeps what is done.
- **Afterwards** the graph is drawn again: tags that now share an English name are one topic.
- Nothing on the articles changes; only the topic lexicon (part of the settings: backed up and deleted with them) learns.

`learnTagNames()` is now `nameTags()` (ask, learn nothing) + `applyTagNames()` (learn); its behaviour for the existing callers is unchanged.

#### Broader topics

A name merges the same topic across languages ("KI in der Medizin" = "AI in medicine"), but a specific tag used on one or two articles still has almost nothing to connect to: in the graph, tags are tied only by the articles they share. So the same naming request also asks, per tag, for **up to two broader topics** ("AI in medicine (broader: Artificial intelligence, Medicine)"), preferably from the archive's own most used topics (`broaderVocabOf()`), so they meet tags that exist.

- **Stored apart:** in the lexicon entry under `'>'` (`lexiconBroader()` in `topicConcepts.js`), never as a tag and never as a spelling: the tag is not merged with its broader topics, counts in charts and search stay as they are. Fixed categories, language marks and the topic itself are dropped; at most two. An empty answer is stored as `[]` (asked), so a tag is not sent again for it. Built-in topics need none.
- **Named tags too:** tags that already had a name but were never asked for broader topics are included (`tagsToBroaden()`); for them only the broader topics are saved (`applyBroader()`), their name stays ("(name kept)" in the preview).
- **In the graph** (`addBroaderTies()` in `graphStructure.js`): a weak tie between a specific tag and the tag that is its broader topic (0.35), and between tags that share a broader topic (0.25), never lowering a stronger co-occurrence. A broader topic shared by more than 25 tags ties none of them to each other, so a broad term does not glue a crowd together. Umbrella tags and categories are left out before, so they take no part either.
- **Result:** a rare, specific tag lands in the cluster of what it belongs to (`test230`: six one-off tags each, with no article in common, join their topic; without the broader topics they stay apart).

**The name stays the tag itself.** Shown a list of topics, a model tends to answer with them: "Germany" → "geopolitics", "habits" → "personal growth", "Food policy" → "policy" (seen in a real preview with a local model). Learning that would merge many specific tags into a few broad ones, a clump again. So the prompt asks for the tag translated literally and uses the list for the broader topics only, and `keepLiteral()` (`feedAi.js`) checks every answer. A name counts as a broader word when it drops words of the tag, when it is a built-in broad topic the tag is not, or, for a tag whose articles are summarised in English (`englishTagsOf()`: the last language mark), when it is anything but the tag itself (a small spelling change and an abbreviation written out, "AI" → "artificial intelligence", are fine). Then the name stays literal ("germany", "content pollution": hashtag-style tags are written as words, `humanizeTag()`) and the model's word becomes a broader topic. A translation ("KI-Regulierung" → "AI regulation", "Soziologie" → "sociology") is left alone. Codes and colour values (`7f8c8d`) are never sent (`isJunkTag()`), "3:-" in a reply means "no topic", and catch-alls ("uncategorized") are no broader topics. The preview shows names and broader topics exactly as they will be saved, and after saving, **Undo** puts the lexicon back as it was before (while the page is open).

A broader topic that is itself an archive-wide umbrella tag (on 35 %+ of all articles) ties nothing, because umbrella tags take no part in forming topics. Then the specific tags with the same broader topic still find each other (as long as there are at most 25 of them).

Bundling note: `topicCategories.js` has no imports and unique top-level names, because the content-script bundler puts every module into one scope (a second `clean` broke the bundle once; `test224` now checks the content and finalize bundles too).

### Language marks are not topics

The language tags (`🌐 de`: the page's language, plus `🌐 en` when the summary is in another one) are marks, not topics. They are not in the graph at all: no tag node, no link, no cluster, no gap, no criterion for subtopics or for similarity, not in the preview card's tag chips, not in the hub note's topics and not a reason for two notes to be "related" in the Markdown export, and `related_articles` does not count them as shared tags (a German article about chips belongs with the other chip articles, not with the German ones). They are never sent to the AI to be "named", and nothing can be learned for them: `isLanguageTag()` in `topicConcepts.js` guards the lexicon, `unknownTags()` and the graph. A lexicon an older run polluted (where "🌐 de" had become a spelling of Germany) is cleaned when it is loaded.

### Archive-wide umbrella tags

A tag on 35 % or more of **all** articles (in an archive of 30+) says "this archive is about X" ("Technik" on three of four saves), not which part of it. It would tie every topic together into one blob, so it stays out of the co-occurrence graph; its articles are placed by their other tags and it is never a cluster name. (A tag on most of *one cluster* is handled separately, see subtopics below.)

### How many articles can Topics show?

All of them. The 300-node cap (`NODE_CAP`) belongs to Detail, where a force simulation and every link have to be computed and drawn. Topics draws no links and does not simulate its positions (the packing decides, the forces only settle the dots), so it shows every tag and every article, also those whose tags are rare and those with no tag at all (they sit in "everything else" and the text sorts them). `OVERVIEW_NODE_CAP` (6,000) is only a safety. Measured in Chromium with synthetic archives: 600 articles paint in about 0.2 s, 1,500 in 0.4 s, 3,000 in 0.9 s, with one stall of about that length while the first picture is built and a few dozen slow frames while the dots settle (Detail with 1,500 had more of them than Topics). The titles of the dots are moved every few frames only, and links are not touched at all. Past a few thousand articles the first picture will take over a second; the structure could then be cached.

### Why the dots might not sit in their circles (a bug we had)

In Topics the tags are not drawn, but they are still nodes of the simulation. Once Topics showed every tag, hundreds of rare tags sat as solid discs in the middle of their clusters and pushed the article dots out of their circles (a hole in the middle, dots scattered outside). Tag nodes no longer collide with anything in Topics. `test227` draws 600 articles with many rare tags and some without any, lets the layout settle and checks that every dot sits at its place in the packing (without the fix, 148 of 600 are far off).

### Function words

Words like "the", "die", "und", "les", "los" are no terms (`graphSimilarity.js`, six languages beyond English). Without them a group of German articles is "typical" for "die" and "und" and gets named after them. Words that no list knows are still dropped by frequency. Text grouping works within a language: a German and an English article about the same topic share no words, so they are only joined by tags (which the topic lexicon already unifies across languages), not by text.

### What stops a clump

Four things work together, in this order: archive-wide umbrella tags are ignored when topics are formed; a cluster of 12+ articles is divided by tags, shared typical terms and similar content; a division only counts when at least 55 % of all ties lie inside the groups (a clump cut at random scores about 1/k); and when that fails for a cluster of 40+ articles whose saved text is known, **the text divides it** (spherical k-means on each article's strongest terms, started from the articles furthest apart, so the result never depends on a random draw; up to 6 groups). A cluster whose articles say the same thing is left alone.

Every article is its own node even when several were saved in the same millisecond (an import, "save all tabs"): the node id is made from the saved time, and two articles used to become one node, with wrong counts in the labels and dots piled on one spot (found with a test archive of 420 articles that shared 70 timestamps).

### Subtopics (a second level)

A big cluster is looked at once more (`subdivide()` in `graphStructure.js`, 12+ articles), because one tag can hide several areas: papers that all sit under "science" but are about genetics, astronomy and materials.

1. **Umbrella tags drop out.** A tag on 60 % or more of the cluster's articles describes the cluster, not a part of it, and would glue everything together.
2. **Articles are tied to each other** by the tags they still share (cosine of their tag sets), by the typical terms they share (from the background run: terms that set some articles apart, not words half the cluster has) and by similar content (the similarity links, counted less between articles that both have tags of their own: the tags are what you said, similarity is for the articles that said little). So it also works when the papers carry nothing but the umbrella tag or only rare tags, once the background run has read them.
3. **Label propagation** over those ties, then **tight groups that are almost as tied to each other as they are inside are merged**, best pair first (articles with the same two tags form tight groups, neighbours share one tag, and together they are one subtopic).
4. **At most 6 subtopics** of 4+ articles; the rest is "Other". If one group would hold more than 80 % of the cluster (or only one group is left), the cluster is **not** split: no structure, no subtopics.
5. **Names:** the words (explicit tags, the strongest terms of every article from the similarity cache, words of the titles) that a group has clearly more often than chance would give a group of its size, by z-score ≥ 3.5 (hundreds of words are tried, so a lower bar would let background words in by luck). The most surely over-represented words come first; tags get a small bonus. Three passes: first words in a quarter of the group's articles, then in 8 %, then in 4 %, so a big varied group (where no word is in a quarter of its articles) still gets a name. The cluster's own name and its umbrella tags never name a part of it, siblings get different names (no "(2)"). If the words offer nothing, the name is the source the articles mostly come from ("blog.example") or when they were saved ("Mar – May 2026"); only then "Group 1". Same input, same names.

In Topics the subtopics are always there: each cluster that has them is drawn as its subtopic areas, each with a name and its count; clicking the cluster zooms in, clicking a subtopic focuses it ("Science › crispr · dna"). The topic page's Markdown export then carries a `## Subtopics` section in the hub note.

Good to know: when the tags already tell the areas apart, the top level separates them itself and there is nothing left to split. Subtopics matter where the top level glues areas together.

Tags are the main input, so better tags mean better clusters. Tag intelligence (`tagIntelligence.js`) and the topic lexicon feed into that already.

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
- **Subtopics.** Always drawn inside their cluster (see above); click one to focus it.
- **Unread.** A chip with the count ("Unread · 200"). Everything marked read (`readAt`: the Inbox / Read tabs and the 🆕 badge use the same) steps back, and in Topics every cluster label shows how many of its articles are still unread ("trade · 34"). A class toggle, no redraw.
- **Obsidian hub note.** The topic page's "⬇ Markdown" export (and the one on briefings) now adds `Hub – <topic>.md`: a map of content that links every exported article note with `[[wikilinks]]`, grouped as worked on / in progress / saved only, unread ones marked 🆕, with the tags inside the topic and a link to the briefing note. The article notes already carried `[[Related]]` links; the hub is what makes the topic one island in Obsidian's own graph too.
- **MCP: `related_articles`.** AI apps paired with the local relay can ask for the saved articles closest to one article (same similarity as the graph, from its cache where current, otherwise from title, tags and summary). Scope "Your library", exclude tag respected (an excluded article is "not found"), metadata and snippet only. The cluster list and a path tool are not built.
- **Save image.** Downloads the current picture as an SVG on your device (colours resolved, no stylesheet needed). Nothing is uploaded.
- Existing: search dims or filters, time window, 🎓 Research filter, list view (the screen-reader twin: press `L`), long-press / ⇧ / ⌘ to select topics for a briefing.

Accessibility: cluster labels are buttons (Enter / Space), every state change is announced in the live region, reduced-motion turns the zoom transition off, and the list view stays the equivalent of the graph.

## Does it clump, whatever the topic?

The rules know no topics, only numbers (shares of articles, counts, similarity); a test renames the tags (other words, other script) and checks that the structure stays the same, and that no topic word appears in the logic. What the layout guarantees is that nothing piles up: circles never overlap. What it cannot guarantee is structure where there is **no signal**. Measured on 600 synthetic articles (largest circle = the biggest single group drawn, as a share of all articles; `scratchpad` stress script, not part of the test suite):

| Archive | Tags only | Tags + text (background run done) |
| --- | --- | --- |
| 7 real areas, umbrella tag on 85 %, 25 % cross-tagged | 18 % | 12 % |
| Two umbrella tags (90 % and 60 %) + 8 areas | 15 % | 10 % |
| Zipf-distributed tags (a few common, many rare) | 33 % | 15 % |
| Umbrella on everything + 20 random sub-tags | 28 % | 10 % |
| Random tags, no structure at all | 49 % | 10 % |
| **Only one tag on everything** | **100 %** | 14 % |
| **No tags at all** | **100 %** | 13 % |

So: with tags or with text there is structure to find; with neither (every article tagged the same and no text read yet, or no tags and no text) nothing can separate the articles, and they stay one circle. (Synthetic text with clearly separate vocabularies is the best case; real articles overlap more, so expect less clean groups.) The text signal needs the background run (deep stage) to have read the saved articles. The "Everything else" cluster is split like any other.

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

// Recorded content for the in-site demo. Nothing here calls a model: the mock background replays it with realistic timing.
// Quotes in `sources` must appear verbatim in `article.paragraphs`, exactly like the real thing checks them.
window.AISH_DEMO = {
  tab: { id: 1, url: 'https://example.com/the-quiet-comeback-of-the-long-read', title: 'The quiet comeback of the long read', active: true, windowId: 1 },
  article: {
    title: 'The quiet comeback of the long read', byline: 'By Jo Marlowe · 7 min read',
    paragraphs: [
      'For a decade the web optimised for the glance: a headline, a thumbnail, a number of shares. The longest pieces were quietly dropped from the menu, and everyone agreed that attention spans had simply shrunk.',
      'The data now says something different. Publishers report that their longest articles gain the most time on page, and newsletters built on a single long essay keep outgrowing the feeds that were supposed to replace them. Editors say that readers are tired of skimming. They want the full argument back, with the context that a headline strips away.',
      'The obstacle is no longer interest but time. Nobody can read everything worth reading, so a new habit is spreading: read a short summary first, then decide. Summaries decide what earns a full read, and the pieces that survive that triage are read more carefully than before.',
      'That changes what good writing looks like. A long piece now has to justify its length twice: once to the summary, and once to the reader who decides to stay.'
    ]
  },
  summary: {
    stream: 'Long-form reading is making a quiet comeback. After a decade of headlines and feeds, readers want context, not more volume. The longest articles now gain the most time on page. The catch is time: nobody can read everything, so short summaries decide what earns a full read.',
    html: '<h3>Key points</h3><ul><li><strong>Long-form is growing again.</strong> The longest articles now gain the most time on page.</li><li><strong>Readers want context</strong>, not more headlines.</li><li><strong>Time is the bottleneck.</strong> Summaries decide what earns a full read.</li></ul><p>Attention is scarce, so triage has become part of reading.</p>',
    tags: ['reading', 'media'],
    questions: ['Why is long-form growing again?', 'What changes for writers?']
  },
  library: [
    { title: 'Why local-first software keeps coming back', host: 'blog.localfirst.dev', tags: ["software", "privacy", "local-first"], mood: 0.3, words: 2100, daysAgo: 0, hour: 12 },
    { title: 'The energy cost of a single AI query', host: 'energywatch.org', tags: ["ai", "climate", "energy"], mood: -0.2, words: 1500, daysAgo: 1, hour: 8 },
    { title: 'How sleep consolidates memory', host: 'brainjournal.org', tags: ["health", "science", "memory"], mood: 0.4, words: 1800, daysAgo: 1, hour: 13 },
    { title: 'A short history of the RSS feed', host: 'webhistory.net', tags: ["web", "media", "reading"], mood: 0.5, words: 1300, daysAgo: 2, hour: 21 },
    { title: 'What a fair data-sharing law would look like', host: 'policyreview.eu', tags: ["privacy", "policy", "law"], mood: 0.0, words: 2600, daysAgo: 3, hour: 7 },
    { title: 'Small language models are catching up', host: 'ai-weekly.com', tags: ["ai", "llm", "software"], mood: 0.6, words: 1700, daysAgo: 3, hour: 7 },
    { title: 'Heat pumps: the numbers behind the hype', host: 'climatedesk.org', tags: ["climate", "energy", "economics"], mood: 0.2, words: 2200, daysAgo: 4, hour: 22 },
    { title: 'Interface design for slow attention', host: 'designnotes.io', tags: ["design", "reading", "ux"], mood: 0.5, words: 1400, daysAgo: 5, hour: 18 },
    { title: 'Inflation, explained without the jargon', host: 'economist-lite.com', tags: ["economics", "finance"], mood: -0.3, words: 1900, daysAgo: 6, hour: 7 },
    { title: 'Why your notes app never sticks', host: 'knowledgework.io', tags: ["productivity", "notes", "reading"], mood: 0.1, words: 1250, daysAgo: 6, hour: 12 },
    { title: 'The case for boring technology', host: 'engineering.blog', tags: ["software", "engineering"], mood: 0.4, words: 1600, daysAgo: 7, hour: 18 },
    { title: 'Open-source models and the licence problem', host: 'ai-weekly.com', tags: ["ai", "llm", "law"], mood: -0.1, words: 2000, daysAgo: 9, hour: 7 },
    { title: 'Cities that planted trees and cooled down', host: 'climatedesk.org', tags: ["climate", "cities", "health"], mood: 0.7, words: 1350, daysAgo: 10, hour: 18 },
    { title: 'Reading on screens vs. paper, revisited', host: 'brainjournal.org', tags: ["reading", "science", "design"], mood: 0.2, words: 1550, daysAgo: 11, hour: 8 },
    { title: 'How browsers decide what to cache', host: 'webplatform.dev', tags: ["web", "software", "engineering"], mood: 0.0, words: 1900, daysAgo: 12, hour: 7 },
    { title: 'Is attention really shrinking?', host: 'media-lab.org', tags: ["media", "reading", "science"], mood: -0.1, words: 1700, daysAgo: 13, hour: 7 },
    { title: 'Privacy labels: do they work?', host: 'policyreview.eu', tags: ["privacy", "policy", "design"], mood: -0.2, words: 1450, daysAgo: 15, hour: 13 },
    { title: 'A gentle introduction to embeddings', host: 'ai-weekly.com', tags: ["ai", "llm", "notes"], mood: 0.5, words: 2400, daysAgo: 16, hour: 13 },
    { title: 'What the four-day week taught employers', host: 'workfuture.org', tags: ["economics", "productivity", "health"], mood: 0.6, words: 1650, daysAgo: 16, hour: 7 },
    { title: 'Why interest rates matter to renters', host: 'economist-lite.com', tags: ["economics", "finance", "cities"], mood: -0.4, words: 1500, daysAgo: 18, hour: 8 },
    { title: 'The slow web manifesto', host: 'webhistory.net', tags: ["web", "media", "design"], mood: 0.6, words: 1100, daysAgo: 20, hour: 7 },
    { title: 'Grid batteries are finally cheap', host: 'energywatch.org', tags: ["energy", "climate", "economics"], mood: 0.7, words: 1400, daysAgo: 21, hour: 18 },
    { title: 'Writing summaries that people trust', host: 'media-lab.org', tags: ["reading", "ai", "media"], mood: 0.3, words: 1250, daysAgo: 23, hour: 13 },
    { title: 'Zettelkasten for people who hate rules', host: 'knowledgework.io', tags: ["notes", "productivity", "knowledge"], mood: 0.4, words: 1800, daysAgo: 25, hour: 7 },
    { title: 'What counts as personal data in a browser?', host: 'policyreview.eu', tags: ["privacy", "web", "law"], mood: -0.1, words: 2100, daysAgo: 27, hour: 22 },
    { title: 'Local models on a laptop: a field report', host: 'blog.localfirst.dev', tags: ["ai", "llm", "local-first"], mood: 0.5, words: 1950, daysAgo: 29, hour: 18 },
    { title: 'Mapping your reading: ideas that connect', host: 'knowledgework.io', tags: ["knowledge", "notes", "reading"], mood: 0.6, words: 1500, daysAgo: 31, hour: 7 },
  ],
  feeds: {
    subs: [
      { title: "Hacker Noon Weekly", host: "hn-weekly.example", tags: ["tech"] },
      { title: "The Local-First Letter", host: "localfirst.example", tags: ["tech", "privacy"] },
      { title: "Climate Desk", host: "climatedesk.example", tags: ["science"] },
      { title: "Design Notes", host: "designnotes.example", tags: ["design"] },
      { title: "Policy Review", host: "policyreview.example", tags: ["policy"] },
      { title: "Brain Journal", host: "brainjournal.example", tags: ["science", "health"] }
    ],
    items: [
      { feed: 0, title: "A browser that summarises on your own machine", snippet: "Why on-device models are good enough for most reading, and where they still fall short.", hoursAgo: 1 },
      { feed: 1, title: "Sync without a server: CRDTs in plain words", snippet: "A tour of the ideas behind apps that keep working offline and merge later.", hoursAgo: 3 },
      { feed: 2, title: "Heat pumps outsold gas boilers again", snippet: "New figures show the shift is faster than forecast in nine countries.", hoursAgo: 2 },
      { feed: 3, title: "Typography for people who read fast", snippet: "What changes in a layout when most readers skim first and read second.", hoursAgo: 5 },
      { feed: 4, title: "The data-portability rule, one year on", snippet: "Who actually used it, and what companies did to make it harder.", hoursAgo: 8 },
      { feed: 5, title: "Why a nap helps you learn", snippet: "A small trial adds to the evidence that short rests lock in new material.", hoursAgo: 6 },
      { feed: 0, title: "Open weights, closed data", snippet: "The licensing gap between model releases and the datasets behind them.", hoursAgo: 10 },
      { feed: 1, title: "Local-first apps need better onboarding", snippet: "Six patterns that explain why people abandon them in the first week.", hoursAgo: 14 },
      { feed: 2, title: "Cooling cities with trees: what the numbers say", snippet: "Street-level temperatures drop by several degrees where canopy is dense.", hoursAgo: 12 },
      { feed: 3, title: "Dark mode is not just inverted colours", snippet: "Contrast, elevation and the colours that stop working at night.", hoursAgo: 20 },
      { feed: 4, title: "What the new browser tracking rules change", snippet: "A plain summary of the consent requirements taking effect next month.", hoursAgo: 18 },
      { feed: 5, title: "Reading speed and comprehension, revisited", snippet: "Faster is not always worse, but the trade-off depends on the text.", hoursAgo: 26 },
      { feed: 0, title: "A field guide to small language models", snippet: "Which ones run on a laptop, and which tasks they handle well.", hoursAgo: 30 },
      { feed: 2, title: "Batteries are getting cheaper, again", snippet: "Grid-scale storage costs fell another double-digit percent this year.", hoursAgo: 28 },
      { feed: 3, title: "The case for fewer settings", snippet: "Every option is a decision you hand to the user: when that is worth it.", hoursAgo: 36 },
      { feed: 1, title: "Encrypted notes you can actually search", snippet: "Techniques for searching private text without sending it anywhere.", hoursAgo: 40 },
      { feed: 4, title: "Public money, public code", snippet: "A short case for open-source requirements in government contracts.", hoursAgo: 44 },
      { feed: 5, title: "The attention economy of the morning commute", snippet: "What people read on the way to work, and how long they stay.", hoursAgo: 50 }
    ]
  },
  asks: [
    { match: /writer|writing|change/i, text: 'Writers now have to justify length twice: once to the summary that decides whether the piece gets read, and once to the reader who decides to stay.', sources: ['justify its length twice'], questions: ['Why is long-form growing again?'] },
    { match: /./, text: 'Because readers are tired of skimming. After years of headlines they want the full argument back, and the longest articles now gain the most time on page.', sources: ['readers are tired of skimming'], questions: ['What changes for writers?'] }
  ]
};

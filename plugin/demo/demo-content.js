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
  asks: [
    { match: /writer|writing|change/i, text: 'Writers now have to justify length twice: once to the summary that decides whether the piece gets read, and once to the reader who decides to stay.', sources: ['justify its length twice'], questions: ['Why is long-form growing again?'] },
    { match: /./, text: 'Because readers are tired of skimming. After years of headlines they want the full argument back, and the longest articles now gain the most time on page.', sources: ['readers are tired of skimming'], questions: ['What changes for writers?'] }
  ]
};

// Scenarios for the demo: ?scenario=youtube|pdf|paper|research|mood|instant|ghost|mcp|export
//
// The default demo is one article ("The quiet comeback of the long read"). A scenario swaps what the extension "sees" and
// what is already saved, so a video can show a feature the default page cannot (a YouTube lecture, a PDF, a scientific
// paper, a collection of sources, an AI-rated feed ...). English only for now: other languages fall back to this content.
// Loaded after demo-library-i18n.js and before demo-shim.js. Everything here is made up, including the study and its DOI
// (10.5555 is the DOI registry's test prefix).
//
// What a scenario can set on window.AISH_DEMO:
//   tab, article, summary, asks, words   the page the extension is "looking at" and the recorded answers
//   page      how index.html draws the page on the left: { kind: 'youtube' | 'pdf' | 'paper', ... }
//   summaryMeta   the page metadata a summary carries (meta.paper = research mode, see content/paper.js)
//   ghost     quotes the AI marks on the page after a summary (ghost highlights, see content/highlighter.js)
//   seed      extra chrome.storage.local keys (collections, mood history)
//   overview  the recorded answer for a collection's "Create overview"
//   csl       DOI -> CSL record, answered for doi.org lookups
//   tts       true = a fake speech engine, so Instant read has something to show
//   feeds     replaces the demo feeds (items may carry sent / cat = an AI mood score and category)
(function () {
  const D = window.AISH_DEMO;
  const id = new URLSearchParams(location.search).get('scenario');
  if (!D || !id) return;
  const clone = (v) => JSON.parse(JSON.stringify(v));
  // Texts: English here, other languages in demo-scenarios-i18n.js (flat keys). A key without a translation stays English.
  const lang = new URLSearchParams(location.search).get('lang') || 'en';
  const X = (window.AISH_SCENARIO_I18N || {})[lang] || ((window.AISH_DEMO_LANG || {})[lang] || {}).scenarios || {};
  const t = (key, en) => (X[key] !== undefined ? X[key] : en);
  // topic names for the tags these scenarios add (the demo's topic lexicon, see demo-library-i18n.js)
  const extTopics = (((window.AISH_DEMO_LANG || {})[lang] || {}).scenarioTopics) || {};
  D.topicLexicon = { ...(D.topicLexicon || {}), ...Object.fromEntries(Object.entries(window.AISH_SCENARIO_TOPICS || {}).map(([k, v]) => [k, { ...v, ...(extTopics[k] ? { [({ pt: 'pt_BR', zh: 'zh_CN', 'zh-tw': 'zh_TW' })[lang] || lang]: extTopics[k] } : {}) }])) };
  const stream = (html) => html.replace(/<h3>.*?<\/h3>/, '').replace(/<\/li>/g, '. ').replace(/<[^>]+>/g, '').replace(/\.\s*\./g, '.').replace(/\s+/g, ' ').trim();
  const setPage = (tab, article, summary, asks, extra) => {
    D.tab = { id: 1, active: true, windowId: 1, ...tab };
    D.article = article;
    D.summary = { ...summary, stream: summary.stream || stream(summary.html) };
    D.asks = asks.map((a) => ({ ...a, match: a.match || /./ }));
    Object.assign(D, extra || {});
  };
  const addLib = (e) => { D.library.push(e); return 'article_demo_' + (D.library.length - 1); };
  const day = 864e5;

  // ── YouTube: a long lecture, summarized from its captions ─────────────────────────────────────────────────────────
  if (id === 'youtube') {
    setPage(
      { url: 'https://www.youtube.com/watch?v=Zp3aish0Dm1', title: t('yt.title', 'Spaced repetition, explained: how to remember what you learn') },
      {
        title: t('yt.title', 'Spaced repetition, explained: how to remember what you learn'), byline: 'Open Lectures · 1:12:40',
        paragraphs: [
          t('yt.p0', 'Today I want to talk about why we forget, and what the research says we can do about it. The short version is that forgetting is not a bug. It is the brain clearing space.'),
          t('yt.p1', 'Hermann Ebbinghaus measured this in the 1880s. Without review, we lose most of what we learn within a few days, and the loss is steepest in the first hours.'),
          t('yt.p2', 'The fix is spaced repetition: you review something just before you would forget it. Each review pushes the next one further out, from a day to a week to a month.'),
          t('yt.p3', 'Sleep matters just as much. A good night after studying locks the material in, and a short nap can do part of the same job.'),
          t('yt.p4', 'So the practical plan is simple. Study in short sessions, test yourself instead of rereading, and space the reviews across weeks.'),
        ],
      },
      {
        html: t('yt.html', '<h3>Key points</h3><ul><li><strong>Forgetting is normal.</strong> Without review, most new material fades within days.</li><li><strong>Space your reviews.</strong> Revisit things just before you would forget them, then wait longer each time.</li><li><strong>Test yourself</strong> instead of rereading.</li><li><strong>Sleep locks it in.</strong> A good night, or even a nap, helps the material stick.</li></ul><p>A 72-minute lecture, boiled down to a study plan you can start today.</p>'),
        tags: ['learning', 'memory'],
        questions: [t('yt.q0', 'How long should the gaps be?'), t('yt.q1', 'What does he say about sleep?')],
      },
      [
        { match: new RegExp(t('yt.sleepRe', 'sleep|nap'), 'i'), text: t('yt.a0', 'He says sleep matters as much as studying: a good night locks the material in, and even a short nap can do part of the same job.'), sources: [t('yt.a0s', 'A good night after studying locks the material in')], questions: [t('yt.q0', 'How long should the gaps be?'), t('yt.q2', 'What is the practical plan?')] },
        { text: t('yt.a1', 'Review something just before you would forget it, and make each gap longer: from a day to a week to a month.'), sources: [t('yt.a1s', 'you review something just before you would forget it')], questions: [t('yt.q1', 'What does he say about sleep?'), t('yt.q2', 'What is the practical plan?')] },
      ],
      {
        words: 11840,
        page: {
          kind: 'youtube', duration: '1:12:40', channel: 'Open Lectures', meta: t('yt.meta', '48K views · 2 weeks ago'),
          stamps: ['0:00', '6:12', '14:30', '41:05', '1:08:20'],
          transcript: t('yt.tr', 'Transcript'),
        },
      }
    );
  }

  // ── PDF: a long report in the browser's viewer ────────────────────────────────────────────────────────────────────
  if (id === 'pdf') {
    setPage(
      { url: 'https://grid-agency.example/reports/grid-outlook-2026.pdf', title: 'Grid Outlook 2026' },
      {
        title: 'Grid Outlook 2026', byline: t('pdf.byline', 'National Grid Agency · 84 pages'),
        paragraphs: [
          t('pdf.p0', 'Executive summary. Electricity demand is set to grow by 18 percent by 2035, driven mostly by heat pumps and electric vehicles.'),
          t('pdf.p1', 'Storage is the bottleneck. The grid will need about 40 GW of battery capacity by 2035, four times what is installed today.'),
          t('pdf.p2', 'Permitting is the biggest delay. A new transmission line takes an average of six years from application to construction.'),
          t('pdf.p3', 'Upgrading the grid is expected to cost around 210 billion euros over the decade, most of it for distribution networks.'),
        ],
      },
      {
        html: t('pdf.html', '<h3>Key points</h3><ul><li><strong>Demand +18% by 2035</strong>, mostly heat pumps and electric cars.</li><li><strong>Storage is the bottleneck:</strong> about 40 GW of batteries needed, four times today.</li><li><strong>Permitting takes six years</strong> for a new transmission line, the biggest delay.</li><li><strong>Around 210 billion euros</strong> for grid upgrades, mostly distribution networks.</li></ul><p>Eighty-four pages, four decisions.</p>'),
        tags: ['energy', 'policy'],
        questions: [t('pdf.q0', 'Why is permitting so slow?'), t('pdf.q1', 'What does the grid cost?')],
      },
      [{ text: t('pdf.a0', 'A new transmission line takes about six years from application to construction, which the report names as the biggest delay.'), sources: [t('pdf.a0s', 'A new transmission line takes an average of six years')], questions: [t('pdf.q1', 'What does the grid cost?')] }],
      { words: 24310, page: { kind: 'pdf', pages: 84, name: 'grid-outlook-2026.pdf' } }
    );
  }

  // ── Research papers ───────────────────────────────────────────────────────────────────────────────────────────────
  const PAPER_DOI = '10.5555/aish.2026.0412';
  const PAPER_TITLE = 'Afternoon naps improve word learning in adults: a randomized controlled trial';
  const FACTS = {
    design: t('pp.design', 'Randomized controlled trial, two arms (30-minute nap vs. rest), six weeks'),
    sample: t('pp.sample', '212 university students aged 18 to 29'),
    limitations: t('pp.lim', 'Single site; sleep was self-reported in diaries; no follow-up beyond six weeks'),
  };
  if (id === 'paper' || id === 'research') {
    // The research library: papers (Research tab), plus a news piece, a blog post and a general article for the collection.
    const mk = (o) => addLib(o);
    const trial = mk({
      title: PAPER_TITLE, host: 'jls.example', tags: ['sleep', 'memory', 'science'], mood: 0.4, words: 5200, daysAgo: 0, hour: 13,
      summary: t('rs.sum0', '<h3>Key points</h3><ul><li>A 30-minute afternoon nap raised word-learning scores by about a third.</li><li>The effect held after a week.</li></ul>'),
      idx: { paper: 'yes', doi: PAPER_DOI, paperType: 'trial', paperAuthors: 'Okafor, Lindqvist & Raman' },
      rec: {
        meta: { paper: { state: 'yes', doi: PAPER_DOI, type: 'trial', authors: 'Okafor, Lindqvist & Raman', journal: 'Journal of Learning Sciences', year: '2026', facts: FACTS } },
        sourceProfile: { type: 'peer', author: 'Okafor, Lindqvist & Raman', date: '2026', publisher: 'Journal of Learning Sciences', title: PAPER_TITLE, fromDoi: true },
        sourceCheck: { who: 'Three sleep researchers at two universities; funded by a national science foundation.', others: 'Matches the 2024 review.', origin: 'Primary study, data open.', missing: 'Long-term follow-up.' },
      },
    });
    const review = mk({
      title: 'Daytime sleep and memory consolidation: a systematic review and meta-analysis', host: 'smr.example', tags: ['sleep', 'memory', 'science'], mood: 0.3, words: 7800, daysAgo: 4, hour: 9,
      summary: t('rs.sum1', '<h3>Key points</h3><ul><li>Across 41 trials, naps gave a small to medium boost to memory.</li><li>Longer naps helped more, but only up to about 40 minutes.</li></ul>'),
      idx: { paper: 'yes', doi: '10.5555/smr.2024.1180', paperType: 'review', paperAuthors: 'Brandt & Mehta' },
      rec: {
        meta: { paper: { state: 'yes', doi: '10.5555/smr.2024.1180', type: 'review', authors: 'Brandt & Mehta', journal: 'Sleep Medicine Reviews', year: '2024', facts: { design: t('rs.f1d', 'Systematic review and meta-analysis of 41 trials'), sample: t('rs.f1s', '2,380 participants in total'), limitations: t('rs.f1l', 'Many small trials; wide differences in nap length') } } },
        sourceProfile: { type: 'peer', author: 'Brandt & Mehta', date: '2024', publisher: 'Sleep Medicine Reviews', fromDoi: true },
        sourceCheck: { who: 'Two sleep medicine researchers.', others: 'Agrees with the new trial.', origin: 'Secondary: pools other studies.', missing: 'Hardly any trials with children.' },
      },
    });
    const pre = mk({
      title: 'Short naps and vocabulary retention in schoolchildren (preprint)', host: 'osf.example', tags: ['sleep', 'learning', 'science'], mood: 0.2, words: 4100, daysAgo: 9, hour: 18,
      summary: t('rs.sum2', '<h3>Key points</h3><ul><li>Children who napped for 20 minutes remembered slightly more new words.</li><li>The effect was small and the paper is not peer reviewed yet.</li></ul>'),
      idx: { paper: 'yes', doi: '10.5555/osf.2026.77', preprint: true, paperType: 'preprint', paperAuthors: 'Haas et al.' },
      rec: {
        meta: { paper: { state: 'yes', doi: '10.5555/osf.2026.77', type: 'preprint', preprint: true, authors: 'Haas et al.', journal: 'OSF Preprints', year: '2026', facts: { design: t('rs.f2d', 'Cluster trial in six schools'), sample: t('rs.f2s', '640 children aged 8 to 11'), limitations: t('rs.f2l', 'Not peer reviewed; teachers were not blinded') } } },
        sourceProfile: { type: 'preprint', author: 'Haas et al.', date: '2026', publisher: 'OSF Preprints' },
        sourceCheck: { who: 'A university education lab.', others: '', origin: '', missing: '' },
      },
    });
    const news = mk({
      title: t('rs.news', 'Why a nap helps you learn'), host: 'dailyscience.example', tags: ['sleep', 'health', 'science'], mood: 0.6, words: 900, daysAgo: 1, hour: 8,
      summary: t('rs.sum3', '<h3>Key points</h3><ul><li>A new trial adds to the evidence that short rests lock in new material.</li><li>Experts warn that one study is not the last word.</li></ul>'),
      rec: { sourceProfile: { type: 'news', author: 'Marta Voss', date: '2026-10-19', publisher: 'Daily Science' }, sourceCheck: { who: 'A science desk reporter.', others: '', origin: '', missing: '' } },
    });
    const blog = mk({
      title: t('rs.blog', 'Napping is overrated: a sleep coach’s take'), host: 'sleepbetter.example', tags: ['sleep', 'health'], mood: -0.1, words: 1100, daysAgo: 6, hour: 21,
      summary: t('rs.sum4', '<h3>Key points</h3><ul><li>The author argues naps are overrated and a regular bedtime matters more.</li><li>No studies are cited.</li></ul>'),
      rec: { sourceProfile: { type: 'opinion', author: 'J. Rowe', date: '2026-10-14', publisher: 'Sleep Better' } },
    });
    // two more papers so the Research tab and its filters look lived in
    mk({
      title: 'Spaced retrieval practice and exam performance: a randomized trial', host: 'edu-journal.example', tags: ['learning', 'memory', 'science'], mood: 0.5, words: 4800, daysAgo: 12, hour: 10,
      idx: { paper: 'yes', doi: '10.5555/edu.2025.310', paperType: 'trial', paperAuthors: 'Silva & Ng' },
      rec: { meta: { paper: { state: 'yes', doi: '10.5555/edu.2025.310', type: 'trial', authors: 'Silva & Ng', journal: 'Educational Research Letters', year: '2025', facts: { design: t('rs.f3d', 'Randomized trial in two courses'), sample: t('rs.f3s', '318 undergraduates'), limitations: t('rs.f3l', 'Short-answer exams only') } } } },
    });
    mk({
      title: 'Reading on screens versus paper: an updated meta-analysis', host: 'readingstudies.example', tags: ['reading', 'science'], mood: 0.1, words: 6900, daysAgo: 17, hour: 14,
      idx: { paper: 'yes', doi: '10.5555/rs.2025.44', paperType: 'review', paperAuthors: 'Kowalczyk et al.' },
      rec: { meta: { paper: { state: 'yes', doi: '10.5555/rs.2025.44', type: 'review', authors: 'Kowalczyk et al.', journal: 'Reading Studies', year: '2025', facts: { design: t('rs.f4d', 'Meta-analysis of 58 studies'), sample: t('rs.f4s', '171,000 readers'), limitations: t('rs.f4l', 'Most studies use short texts') } } } },
    });

    D.csl = {
      [PAPER_DOI]: {
        type: 'journal-article', title: PAPER_TITLE, DOI: PAPER_DOI,
        author: [{ given: 'Lena', family: 'Okafor' }, { given: 'Mats', family: 'Lindqvist' }, { given: 'Priya', family: 'Raman' }],
        'container-title': 'Journal of Learning Sciences', volume: '38', issue: '2', page: '211-229', publisher: 'Meridian Press', issued: { 'date-parts': [[2026, 3]] },
      },
    };

    // the collection: one question, five sources of different kinds
    const now = new Date().toISOString();
    const ids = [trial, review, pre, news, blog];
    const rec = {
      id: 'c_demo1', name: t('rs.cname', 'Do naps help learning?'), question: t('rs.cq', 'Does a short daytime nap measurably improve how well adults remember new material?'),
      created: now, updated: now, sources: ids.map((a) => ({ articleId: a, addedAt: now })),
    };
    D.seed = {
      'coll:index': [{ id: rec.id, name: rec.name, question: rec.question, n: ids.length, updated: now }],
      'coll:rec:c_demo1': rec,
    };
    D.overview = t('rs.overview', [
      '## Agree',
      '- The trial [1] and the review [2] both find that a daytime nap helps new material stick.',
      '- Even the preprint [3] points the same way for children, with a smaller effect.',
      '## Disagree',
      '- The coach’s post [5] calls naps overrated, but cites no study. [1] and [2] contradict it.',
      '- Size of the effect: [1] reports a medium effect, [3] only a small one that is not peer reviewed yet.',
      '## Missing',
      '- Long-term retention: none of the sources follows learners beyond a few weeks.',
      '- How long a nap should be: only the review [2] compares lengths.',
    ].join('\n'));
  }

  if (id === 'paper') {
    setPage(
      { url: 'https://jls.example/article/' + PAPER_DOI, title: PAPER_TITLE },
      {
        title: PAPER_TITLE, byline: 'Okafor, Lindqvist & Raman · Journal of Learning Sciences · 2026',
        paragraphs: [
          'Abstract. Whether a short daytime nap helps adults learn new words is unclear. We randomly assigned 212 university students to a 30-minute nap or to quiet rest after a vocabulary session.',
          'Students who napped recalled 31 percent more words the next day, and the advantage was still visible after one week.',
          'The effect was largest for students who slept less than seven hours at night. Sleep was self-reported, and we did not follow participants beyond six weeks.',
        ],
      },
      {
        html: t('pp.html', '<h3>Key points</h3><ul><li><strong>A 30-minute nap helped.</strong> Students who napped recalled 31% more new words the next day.</li><li><strong>The effect lasted</strong> at least a week.</li><li><strong>Short sleepers gained most</strong>, those under seven hours a night.</li></ul><p>Randomized trial, 212 students; sleep was self-reported.</p>'),
        tags: ['sleep', 'memory', 'science'],
        questions: [t('pp.q0', 'Who gained the most?'), t('pp.q1', 'What are the limits?')],
      },
      [{ text: t('pp.a0', 'Students who slept less than seven hours at night gained the most from napping. Sleep was self-reported, and nobody was followed beyond six weeks.'), sources: ['The effect was largest for students who slept less than seven hours at night'], questions: [t('pp.q1', 'What are the limits?')] }],
      {
        words: 5200,
        page: { kind: 'paper', journal: 'Journal of Learning Sciences', volume: 'Vol. 38, No. 2 · March 2026', doi: PAPER_DOI, authors: 'Lena Okafor, Mats Lindqvist, Priya Raman' },
        // what content/paper.js finds in the page's citation_* tags and the model's read of it
        summaryMeta: { paper: { state: 'yes', doi: PAPER_DOI, type: 'trial', authors: 'Okafor, Lindqvist & Raman', journal: 'Journal of Learning Sciences', year: '2026', facts: FACTS } },
      }
    );
  }

  // ── Mood: AI-rated feeds ──────────────────────────────────────────────────────────────────────────────────────────
  if (id === 'mood') {
    // one AI score (-1 heavy … +1 good) and category per feed item, in the order of the demo feeds (demo-content.js)
    const rated = [
      [0.7, 'Tech'], [0.1, 'Tech'], [0.8, 'Climate'], [0.3, 'Design'], [-0.5, 'Politics'], [0.6, 'Health'], [-0.3, 'Tech'], [-0.2, 'Tech'], [0.7, 'Climate'],
      [0.2, 'Design'], [-0.6, 'Politics'], [0.0, 'Science'], [0.5, 'Tech'], [0.9, 'Climate'], [0.1, 'Design'], [0.3, 'Tech'], [0.0, 'Politics'], [-0.4, 'Science'],
    ];
    D.feeds = clone(D.feeds);
    D.feeds.items.forEach((it, i) => { const r = rated[i % rated.length]; it.sent = r[0]; it.cat = t('md.cat.' + r[1], r[1]); });
    // heavy news right at the top, so the list shows red cards first and the good-mood filter visibly clears them
    const heavy = (i, title, snippet, hoursAgo, sent) => { Object.assign(D.feeds.items[i], { title, snippet, hoursAgo, sent }); };
    heavy(1, t('md.h1t', 'Data breach exposes four million private notes'), t('md.h1s', 'A sync service left a database open for weeks. Users are only now being told.'), 2, -0.7);
    D.feeds.items[2].hoursAgo = 3;
    heavy(6, t('md.h2t', 'Layoffs hit open-source maintainers hardest'), t('md.h2s', 'Funding cuts leave critical projects with one tired volunteer.'), 4, -0.6);
    // the long-lived daily mood store: ~4 months, a rough patch about three weeks ago, better since
    const seedMood = {};
    const feedIds = D.feeds.subs.length;
    for (let d = 3; d <= 120; d++) {
      const t0 = new Date(); t0.setHours(0, 0, 0, 0); t0.setDate(t0.getDate() - d);
      const wave = Math.sin(d / 5.5) * 0.12 - (d >= 18 && d <= 28 ? 0.17 : 0) + (d < 14 ? 0.12 : 0) - (d > 60 ? 0.05 : 0);
      const day = {};
      for (let f = 0; f < feedIds; f++) {
        const n = 3 + ((d + f) % 3);
        const pos = Math.max(0, Math.min(n, Math.round(n * (0.42 + wave + (f === 2 ? 0.1 : 0) - (f === 4 ? 0.2 : 0)))));
        const neg = Math.max(0, Math.min(n - pos, Math.round(n * (0.26 - wave))));
        day['f' + f] = { t: n, p: pos, u: n - pos - neg, g: neg, c: {} };
      }
      seedMood[t0.getTime()] = day;
    }
    D.moodSeed = seedMood;   // keys are feed ids; the shim maps 'f<i>' to the real ids
  }

  // ── Instant read ──────────────────────────────────────────────────────────────────────────────────────────────────
  if (id === 'instant') {
    D.tts = true;
    // a short summary whose text is exactly what the voice reads (the video speaks the same sentences, see clips.ts readAloud)
    const sents = [t('in.s0', 'Long-form reading is making a quiet comeback.'), t('in.s1', 'Readers want context, not more volume.')];
    D.summary = { ...D.summary, stream: sents.join(' '), html: '<ul>' + sents.map((t) => '<li>' + t + '</li>').join('') + '</ul>' };
  }

  // ── Ghost highlights: the AI marks the key passages on the page ───────────────────────────────────────────────────
  if (id === 'ghost') {
    D.ghost = t('gh.quotes', [
      'Publishers report that their longest articles gain the most time on page',
      'Nobody can read everything worth reading',
      'the pieces that survive that triage are read more carefully than before',
      'A long piece now has to justify its length twice',
    ]);
  }

  // ── AI apps (MCP): the feature is on, an app is connected, and a few calls are in the activity list ───────────────
  if (id === 'mcp') {
    const now = Date.now(), min = 6e4;
    const call = (ago, tool, ms) => ({ at: new Date(now - ago * min).toISOString(), tool, ok: true, ms });
    D.mcp = { connected: true, tools: 9 };
    D.seed = {
      ...(D.seed || {}),
      'mcp:config': { enabled: true, port: 47615, excludeTag: 'private', scopes: { library: true, fulltext: true, feeds: true, write: true } },
      'mcp:secret': 'demo-pairing-code',
      'mcp:log': [call(58, 'library_stats', 31), call(41, 'list_highlights', 58), call(30, 'list_due', 44), call(19, 'list_feed_items', 63), call(12, 'save_url', 90), call(7, 'save_url', 85), call(2, 'search_library', 112)],
    };
  }

  // ── Export: the card menu keeps Obsidian, ODT, Word and PDF (the shim stops the actual download) ──────────────────

  D.scenario = id;
})();

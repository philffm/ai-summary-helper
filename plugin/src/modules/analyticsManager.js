// analyticsManager.js
// Renders a reading analytics / report view for the history screen.
// Shows: reading streak, articles per day chart, top categories, and a word cloud.

function computeStreak(articles) {
    if (!articles.length) return { current: 0, longest: 0 };

    const daySet = new Set(
        articles.map(a => new Date(a.timestamp).toLocaleDateString('en-CA')) // YYYY-MM-DD
    );

    const today = new Date();
    let current = 0;
    for (let i = 0; i < 365; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        if (daySet.has(d.toLocaleDateString('en-CA'))) {
            current++;
        } else if (i > 0) {
            break;
        }
    }

    // Longest streak
    const sorted = Array.from(daySet).sort();
    let longest = 0, run = 0, prev = null;
    for (const day of sorted) {
        if (prev) {
            const diff = (new Date(day) - new Date(prev)) / 86400000;
            run = diff === 1 ? run + 1 : 1;
        } else {
            run = 1;
        }
        if (run > longest) longest = run;
        prev = day;
    }

    return { current, longest };
}

function topCategories(articles, topN = 10) {
    const freq = {};
    articles.forEach(a => {
        (a.tags || []).forEach(tag => {
            // Split camelCase (e.g. UXDesign → UX Design), then normalize to lowercase key
            const split = tag.trim().replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
            const key = split.toLowerCase().replace(/\s+/g, ' ').trim();
            if (key) freq[key] = (freq[key] || 0) + 1;
        });
    });
    // Display as title case
    return Object.entries(freq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, topN)
        .map(([key, count]) => [
            key.replace(/\b\w/g, c => c.toUpperCase()),
            count
        ]);
}

function wordFrequency(articles, topN = 60) {
    const stopWords = new Set([
        'the','a','an','and','or','but','in','on','at','to','for','of','with',
        'is','it','its','be','are','was','were','has','have','had','this','that',
        'from','by','as','we','our','your','their','he','she','they','i','my',
        'you','not','no','so','if','do','did','up','out','all','can','will',
        'would','about','more','also','than','then','into','when','which','who',
        'been','there','how','what','his','her','they','these','those','get',
        'just','new','one','two','use','used','using','each','may','while'
    ]);

    const freq = {};
    articles.forEach(a => {
        const text = [a.title || '', a.summary || '']
            .join(' ')
            .replace(/<[^>]+>/g, ' ')
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ');
        text.split(/\s+/).forEach(w => {
            if (w.length > 3 && !stopWords.has(w)) {
                freq[w] = (freq[w] || 0) + 1;
            }
        });
    });

    return Object.entries(freq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, topN);
}

function articlesByDay(articles) {
    const counts = {};
    articles.forEach(a => {
        const day = new Date(a.timestamp).toLocaleDateString('en-CA');
        counts[day] = (counts[day] || 0) + 1;
    });
    // Last 30 days
    const result = [];
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const key = d.toLocaleDateString('en-CA');
        result.push({ day: key, count: counts[key] || 0 });
    }
    return result;
}

function renderBarChart(days) {
    const max = Math.max(...days.map(d => d.count), 1);
    const bars = days.map(d => {
        const pct = Math.round((d.count / max) * 100);
        const label = d.day.slice(5); // MM-DD
        return `<div class="ar-bar-wrap" title="${d.day}: ${d.count} article${d.count !== 1 ? 's' : ''}">
          <div class="ar-bar" style="height:${pct}%"></div>
          ${d.count > 0 ? `<span class="ar-bar-count">${d.count}</span>` : ''}
        </div>`;
    }).join('');
    return `<div class="ar-chart">${bars}</div>`;
}

function renderWordCloud(words) {
    if (!words.length) return '<p class="ar-empty">Not enough text data yet.</p>';
    const max = words[0][1];
    const items = words.map(([w, c]) => {
        const size = 11 + Math.round((c / max) * 18);
        const opacity = 0.5 + (c / max) * 0.5;
        return `<span class="ar-word" style="font-size:${size}px;opacity:${opacity};">${w}</span>`;
    }).join('');
    return `<div class="ar-wordcloud">${items}</div>`;
}

function countWords(html) {
    return (html || '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
}

// Average adult reading speed (words per minute)
const WPM = 200;

function computeTimeSavings(articles) {
    let totalArticleWords = 0;
    let totalSummaryWords = 0;
    let covered = 0; // articles where we have both content and summary

    articles.forEach(a => {
        const articleW = countWords(a.content || a.html || a.text || '');
        const summaryW = countWords(a.summary || '');
        if (articleW > 0 && summaryW > 0) {
            totalArticleWords += articleW;
            totalSummaryWords += summaryW;
            covered++;
        }
    });

    if (covered === 0) return null;

    const fullMinutes = Math.round(totalArticleWords / WPM);
    const summaryMinutes = Math.round(totalSummaryWords / WPM);
    const savedMinutes = fullMinutes - summaryMinutes;
    const ratio = totalArticleWords > 0
        ? Math.round((1 - totalSummaryWords / totalArticleWords) * 100)
        : 0;

    return { fullMinutes, summaryMinutes, savedMinutes, ratio, covered };
}

function formatMinutes(mins) {
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function initAnalyticsReport(container, articles) {
    if (!container) return;
    container.innerHTML = '';

    if (!articles || articles.length === 0) {
        container.innerHTML = '<div class="ar-empty-state">No articles yet — start summarizing pages to see your analytics! 📖</div>';
        return;
    }

    const streak = computeStreak(articles);
    const cats = topCategories(articles);
    const words = wordFrequency(articles);
    const days = articlesByDay(articles);
    const totalSummaryWords = articles.reduce((sum, a) => sum + countWords(a.summary), 0);
    const timeSavings = computeTimeSavings(articles);

    const catsHtml = cats.length
        ? cats.map(([tag, count]) => {
            const pct = Math.round((count / cats[0][1]) * 100);
            return `<div class="ar-cat-row" data-tag="${tag}" title="Search articles tagged \"${tag}\"" style="cursor:pointer;">
              <span class="ar-cat-label">${tag}</span>
              <div class="ar-cat-bar-track"><div class="ar-cat-bar" style="width:${pct}%"></div></div>
              <span class="ar-cat-count">${count}</span>
            </div>`;
          }).join('')
        : '<p class="ar-empty">No tags found. Add tags to your summaries!</p>';

    const timeSavingsHtml = timeSavings ? `
        <!-- Time savings section -->
        <div class="ar-section">
          <h3 class="ar-section-title">⏱️ Time Saved with AISH</h3>
          <div class="ar-savings-row">
            <div class="ar-savings-block ar-savings-full">
              <span class="ar-savings-value">${formatMinutes(timeSavings.fullMinutes)}</span>
              <span class="ar-savings-label">Full reading</span>
            </div>
            <div class="ar-savings-arrow">→</div>
            <div class="ar-savings-block ar-savings-summary">
              <span class="ar-savings-value">${formatMinutes(timeSavings.summaryMinutes)}</span>
              <span class="ar-savings-label">With summaries</span>
            </div>
            <div class="ar-savings-arrow">=</div>
            <div class="ar-savings-block ar-savings-saved">
              <span class="ar-savings-value">${formatMinutes(timeSavings.savedMinutes)}⚡</span>
              <span class="ar-savings-label">Saved</span>
            </div>
          </div>
          <div class="ar-savings-bar-wrap">
            <div class="ar-savings-bar-fill" style="width:${timeSavings.ratio}%"></div>
          </div>
          <p class="ar-savings-caption">${timeSavings.ratio}% compression across ${timeSavings.covered} article${timeSavings.covered !== 1 ? 's' : ''}</p>
        </div>` : '';

    container.innerHTML = `
      <div class="ar-report">

        <!-- Stats row -->
        <div class="ar-stats-row">
          <div class="ar-stat-card">
            <span class="ar-stat-value">${articles.length}</span>
            <span class="ar-stat-label">Articles</span>
          </div>
          <div class="ar-stat-card ar-streak">
            <span class="ar-stat-value">${streak.current}🔥</span>
            <span class="ar-stat-label">Day Streak</span>
          </div>
          <div class="ar-stat-card">
            <span class="ar-stat-value">${streak.longest}</span>
            <span class="ar-stat-label">Best Streak</span>
          </div>
          <div class="ar-stat-card">
            <span class="ar-stat-value">${(totalSummaryWords / 1000).toFixed(1)}k</span>
            <span class="ar-stat-label">Words Read</span>
          </div>
        </div>

        <!-- Time savings -->
        ${timeSavingsHtml}

        <!-- Activity chart -->
        <div class="ar-section">
          <h3 class="ar-section-title">📅 Activity — Last 30 Days</h3>
          ${renderBarChart(days)}
        </div>

        <!-- Top categories -->
        <div class="ar-section">
          <h3 class="ar-section-title">🏷️ Top Categories</h3>
          <div class="ar-cat-list">${catsHtml}</div>
        </div>

        <!-- Word cloud -->
        <div class="ar-section">
          <h3 class="ar-section-title">☁️ Word Cloud</h3>
          ${renderWordCloud(words)}
        </div>

      </div>
    `;

    // Attach click handlers to category rows after rendering
    container.querySelectorAll('.ar-cat-row[data-tag]').forEach(row => {
        row.addEventListener('click', () => {
            container.dispatchEvent(new CustomEvent('tag-search', {
                bubbles: true,
                detail: { tag: row.dataset.tag }
            }));
        });
    });
}

import { SK } from './storageKeys.js';
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
            // News = Nachrichten = Noticias (built-in or learned): counted as one category
            const key = isKnownTopic(split) ? conceptKey(split) : split.toLowerCase().replace(/\s+/g, ' ').trim();
            if (key) freq[key] = (freq[key] || 0) + 1;
        });
    });
    // Display as title case
    return Object.entries(freq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, topN)
        .map(([key, count]) => [
            labelOfKey(key, uiLocale()) || key.replace(/\b\w/g, c => c.toUpperCase()),
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

export function articlesByDay(articles) {
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

/**
 * Aggregate articles into weekly buckets over the last 12 weeks (84 days),
 * bucketed by 7-day windows ending today. Week index 0 is the current
 * (in-progress) week; higher indices are further back.
 *
 * @param {Array} articles
 * @returns {Array<{ week: number, label: string, count: number }>}
 */
export function articlesByWeek(articles) {
    const counts = {};
    const todayMs = startOfDay(Date.now());
    const today = new Date(todayMs);

    articles.forEach(a => {
        const t = new Date(a.timestamp).getTime();
        if (t > todayMs) return; // future-dated, ignore
        const diffDays = Math.floor((todayMs - t) / 86400000);
        const weekIndex = Math.floor(diffDays / 7); // 0 = current week
        counts[weekIndex] = (counts[weekIndex] || 0) + 1;
    });

    const result = [];
    for (let w = 11; w >= 0; w--) {
        const end = new Date(today);
        end.setDate(today.getDate() - w * 7);
        const start = new Date(end);
        start.setDate(end.getDate() - 6);
        const label = `${start.toLocaleDateString('en-CA').slice(5)}–${end.toLocaleDateString('en-CA').slice(5)}`;
        result.push({ week: w, label, count: counts[w] || 0 });
    }
    return result;
}

/**
 * Decide the default activity view. Once the user has been using the
 * extension for 3+ weeks (their oldest article is at least 21 days old),
 * the weekly view is more meaningful than a 30-day daily view — so week
 * becomes the default. Before that, day view is the default.
 *
 * @param {Array} articles
 * @returns {'day' | 'week'}
 */
function defaultActivityView(articles) {
    let oldest = Infinity;
    articles.forEach(a => {
        const t = new Date(a.timestamp).getTime();
        if (t < oldest) oldest = t;
    });
    if (!Number.isFinite(oldest)) return 'day';
    const ageDays = (Date.now() - oldest) / 86400000;
    return ageDays >= 21 ? 'week' : 'day';
}

import { T, TN, locale, uiLocale } from './feedI18n.js';
import { conceptKey, isKnownTopic, labelOfKey } from './topicConcepts.js';
import { renderTopicsSection } from './topicsChart.js';
import { moodSection } from './moodView.js';
import { moodStoreFor, unscoredIn, scoreArticles } from './historyMood.js';
import StorageManager from './storageManager.js';
import { countWords, escapeHtml } from './textUtils.js';
import { startOfDay } from './dateUtils.js';

/** Localized bar tooltips; `cnt(n)` formats the count with the right noun (articles / items). */
export function chartTips(cnt) {
    const fmtD = (ts) => new Date(ts).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
    return {
        day: (d) => { const [y, m, dd] = d.day.split('-').map(Number); return `${fmtD(new Date(y, m - 1, dd).getTime())}: ${cnt(d.count)}`; },
        week: (d) => { const e = new Date(); e.setHours(0, 0, 0, 0); e.setDate(e.getDate() - d.week * 7); const s = new Date(e); s.setDate(e.getDate() - 6); return `${fmtD(s.getTime())} – ${fmtD(e.getTime())}: ${cnt(d.count)}`; }
    };
}
const artCnt = (n) => TN(n, '{n} article', '{n} articles');

export function renderBarChart(days, tip) {
    const max = Math.max(...days.map(d => d.count), 1);
    const bars = days.map(d => {
        const pct = Math.round((d.count / max) * 100);
        return `<div class="ar-bar-wrap" title="${tip ? tip(d) : `${d.day}: ${d.count} article${d.count !== 1 ? 's' : ''}`}">
          <div class="ar-bar" style="height:${pct}%"></div>
          ${d.count > 0 ? `<span class="ar-bar-count">${d.count}</span>` : ''}
        </div>`;
    }).join('');
    return `<div class="ar-chart">${bars}</div>`;
}

export function renderWeekChart(weeks, tip) {
    const max = Math.max(...weeks.map(d => d.count), 1);
    const bars = weeks.map(d => {
        const pct = Math.round((d.count / max) * 100);
        return `<div class="ar-bar-wrap" title="${tip ? tip(d) : `${d.label}: ${d.count} article${d.count !== 1 ? 's' : ''}`}">
          <div class="ar-bar" style="height:${pct}%"></div>
          ${d.count > 0 ? `<span class="ar-bar-count">${d.count}</span>` : ''}
        </div>`;
    }).join('');
    return `<div class="ar-chart">${bars}</div>`;
}

function renderWordCloud(words) {
    if (!words.length) return `<p class="ar-empty">${T('Not enough text data yet.')}</p>`;
    const max = words[0][1];
    const items = words.map(([w, c]) => {
        const size = 11 + Math.round((c / max) * 18);
        const opacity = 0.5 + (c / max) * 0.5;
        return `<span class="ar-word" style="font-size:${size}px;opacity:${opacity};">${w}</span>`;
    }).join('');
    return `<div class="ar-wordcloud">${items}</div>`;
}

// Average adult reading speed (words per minute)
const WPM = 200;

function computeTimeSavings(articles) {
    let totalArticleWords = 0;
    let totalSummaryWords = 0;
    let covered = 0; // articles where we have both content and summary

    articles.forEach(a => {
        // articlesIndex carries precomputed word counts (not full content —
        // that stays in the article:<id> record, loaded only when an
        // article is opened) with a raw-field fallback for callers that
        // still pass full article objects.
        const articleW = typeof a.contentWordCount === 'number' ? a.contentWordCount : countWords(a.content || a.html || a.text || '');
        const summaryW = typeof a.summaryWordCount === 'number' ? a.summaryWordCount : countWords(a.summary || '');
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
        container.innerHTML = `<div class="ar-empty-state">${T('No articles yet — start summarizing pages to see your analytics! 📖')}</div>`;
        return;
    }

    const tips = chartTips(artCnt);
    const streak = computeStreak(articles);
    const cats = topCategories(articles);
    const words = wordFrequency(articles);
    const days = articlesByDay(articles);
    const weeks = articlesByWeek(articles);
    const totalSummaryWords = articles.reduce((sum, a) => sum + (typeof a.summaryWordCount === 'number' ? a.summaryWordCount : countWords(a.summary)), 0);
    const timeSavings = computeTimeSavings(articles);

    const catsHtml = cats.length
        ? cats.map(([tag, count]) => {
            const pct = Math.round((count / cats[0][1]) * 100);
            return `<div class="ar-cat-row" data-tag="${escapeHtml(tag)}" title="${escapeHtml(T('Search “{term}”', { term: tag }))}">
              <span class="ar-cat-label">${escapeHtml(tag)}</span>
              <div class="ar-cat-bar-track"><div class="ar-cat-bar" style="width:${pct}%"></div></div>
              <span class="ar-cat-count">${count}</span>
            </div>`;
          }).join('')
        : `<p class="ar-empty">${T('No tags found. Add tags to your summaries!')}</p>`;

    const timeSavingsHtml = timeSavings ? `
        <!-- Time savings section -->
        <div class="ar-section">
          <h3 class="ar-section-title">${T('⏱️ Time Saved with AISH')}</h3>
          <div class="ar-savings-row">
            <div class="ar-savings-block ar-savings-full">
              <span class="ar-savings-value">${formatMinutes(timeSavings.fullMinutes)}</span>
              <span class="ar-savings-label">${T('Full reading')}</span>
            </div>
            <div class="ar-savings-arrow">→</div>
            <div class="ar-savings-block ar-savings-summary">
              <span class="ar-savings-value">${formatMinutes(timeSavings.summaryMinutes)}</span>
              <span class="ar-savings-label">${T('With summaries')}</span>
            </div>
            <div class="ar-savings-arrow">=</div>
            <div class="ar-savings-block ar-savings-saved">
              <span class="ar-savings-value">${formatMinutes(timeSavings.savedMinutes)}⚡</span>
              <span class="ar-savings-label">${T('Saved')}</span>
            </div>
          </div>
          <div class="ar-savings-bar-wrap">
            <div class="ar-savings-bar-fill" style="width:${timeSavings.ratio}%"></div>
          </div>
          <p class="ar-savings-caption">${T('{p}% compression across {a}', { p: timeSavings.ratio, a: artCnt(timeSavings.covered) })}</p>
        </div>` : '';

    container.innerHTML = `
      <div class="ar-report">

        <!-- Stats row -->
        <div class="ar-stats-row">
          <div class="ar-stat-card">
            <span class="ar-stat-value">${articles.length}</span>
            <span class="ar-stat-label">${T('Articles')}</span>
          </div>
          <div class="ar-stat-card ar-streak">
            <span class="ar-stat-value">${streak.current}🔥</span>
            <span class="ar-stat-label">${T('Day Streak')}</span>
          </div>
          <div class="ar-stat-card">
            <span class="ar-stat-value">${streak.longest}</span>
            <span class="ar-stat-label">${T('Best Streak')}</span>
          </div>
          <div class="ar-stat-card">
            <span class="ar-stat-value">${(totalSummaryWords / 1000).toFixed(1)}k</span>
            <span class="ar-stat-label">${T('Words Read')}</span>
          </div>
        </div>

        <!-- Time savings -->
        ${timeSavingsHtml}

        <!-- Activity chart -->
        <div class="ar-section">
          <div class="ar-section-head">
            <h3 class="ar-section-title">${T('📅 Activity')}</h3>
            <div class="ar-view-toggle" role="tablist" aria-label="${T('Activity view')}">
              <button type="button" class="ar-view-btn" data-view="day">${T('Day')}</button>
              <button type="button" class="ar-view-btn" data-view="week">${T('Week')}</button>
            </div>
          </div>
          <div class="ar-chart-wrap" data-view="${defaultActivityView(articles)}">
            ${renderBarChart(days, tips.day)}
          </div>
        </div>

        <div id="arMoodMount"></div>

        <!-- Top categories -->
        <div class="ar-section">
          <h3 class="ar-section-title">${T('🏷️ Top Categories')}</h3>
          <div class="ar-cat-list">${catsHtml}</div>
        </div>

        <!-- Word cloud -->
        <div class="ar-section">
          <h3 class="ar-section-title">${T('☁️ Word Cloud')}</h3>
          ${renderWordCloud(words)}
        </div>

      </div>
    `;

    // Topics over time (stacked tag columns), placed right before the top-categories list
    const catSection = container.querySelector('.ar-cat-list')?.closest('.ar-section');
    if (catSection) catSection.before(renderTopicsSection(articles, container));

    // Mood over time (needs AI scores on the articles; same card as Feeds insights)
    const mount = container.querySelector('#arMoodMount');
    if (mount) {
        const rerender = async () => { const arts = await StorageManager.getArticlesIndex({ includeArchived: true }); initAnalyticsReport(container, arts); };
        mount.replaceWith(moodSection({
            moodStore: moodStoreFor(articles),
            unscored: (from, to) => unscoredIn(articles, from, to),
            onScore: async (list) => {
                const btns = [...container.querySelectorAll('.feed-mt .btn-sm')];
                btns.forEach(b => { b.disabled = true; b.textContent = T('Scoring with AI… {a}/{b}', { a: 0, b: list.length }); });
                try { await scoreArticles(list, (a, b) => btns.forEach(x => { x.textContent = T('Scoring with AI… {a}/{b}', { a, b }); })); }
                catch (e) { btns.forEach(b => { b.disabled = false; b.textContent = (e && e.message) || T('AI scoring failed'); }); return; }
                rerender();
            },
            emptyHint: T('No article has a mood yet — let the AI score them.'),
            scoreMax: 120
        }));
    }

    // Attach click handlers to category rows after rendering
    container.querySelectorAll('.ar-cat-row[data-tag]').forEach(row => {
        row.addEventListener('click', () => {
            container.dispatchEvent(new CustomEvent('tag-search', {
                bubbles: true,
                detail: { tag: row.dataset.tag }
            }));
        });
    });

    // ── Activity day/week toggle ───────────────────────────────────────
    // Switch the activity chart between a 30-day daily view and a 12-week
    // weekly view. The active view is persisted so the user's choice sticks
    // across popup opens. The default (when nothing is stored) is decided by
    // defaultActivityView(): week once the archive spans 3+ weeks, day before.
    const chartWrap = container.querySelector('.ar-chart-wrap');
    const toggleBtns = container.querySelectorAll('.ar-view-btn');
    if (chartWrap && toggleBtns.length) {
        const applyView = (view) => {
            chartWrap.dataset.view = view;
            toggleBtns.forEach(b => {
                b.classList.toggle('active', b.dataset.view === view);
                b.setAttribute('aria-selected', b.dataset.view === view ? 'true' : 'false');
            });
            chartWrap.innerHTML = view === 'week' ? renderWeekChart(weeks, tips.week) : renderBarChart(days, tips.day);
        };

        // Restore persisted preference, else use the usage-based default.
        chrome.storage.local.get([SK.activityView], (res) => {
            const saved = res[SK.activityView] === 'day' || res[SK.activityView] === 'week'
                ? res[SK.activityView]
                : defaultActivityView(articles);
            applyView(saved);
        });

        toggleBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const view = btn.dataset.view;
                applyView(view);
                chrome.storage.local.set({ [SK.activityView]: view });
            });
        });
    }
}

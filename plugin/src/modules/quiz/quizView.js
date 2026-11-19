// quiz/quizView.js — the quiz sheet (Figma AISH-040): set up → write questions (checked per article) → play → result → export.
// Opened from the library's selection bar ("🎓 Quiz n") and from a collection ("Create quiz"); popup.html#quiz=<id> reopens a saved
// quiz (the reminder). Nothing leaves the device except the requests to the reader's own model.
import { bindSegKeys } from '../segmented.js';
import { T, TN } from '../feedI18n.js';
import { el } from '../dom.js';
import { trapFocus } from '../sheet.js';
import { QUIZ_MIN_ARTICLES, QUIZ_MAX_ARTICLES, QUIZ_SIZES, createQuiz, quizPlan } from './quizGen.js';
import { saveQuiz, getQuiz, saveResult, remindLater, REMIND_DAYS } from './quizStore.js';

let root = null, trap = null, abort = null;
const settings = { total: 10, mix: 'both', format: 'kahoot', time: 20 };
const title = (a) => (a && (a.title || a.url)) || T('Untitled');
const short = (s, n = 34) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };

function btn(label, cls, onClick) {
    const b = el('button', cls, label); b.type = 'button';
    if (onClick) b.addEventListener('click', onClick);
    return b;
}

function close() {
    if (abort) { abort.abort(); abort = null; }
    if (trap) { trap.release(); trap = null; }
    if (root) { root.remove(); root = null; }
    document.removeEventListener('keydown', onKeys, true);
}

let keyHandler = null;
function onKeys(e) { if (keyHandler && root && !e.defaultPrevented) keyHandler(e); }

/** The sheet with a header (back / title / close) and a body; returns the body. */
function screen(heading, { back } = {}) {
    if (!root) {
        root = el('div', 'quiz');
        root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true');
        root.append(el('div', 'quiz-panel'));
        document.body.append(root);
        trap = trapFocus(root.firstChild, { label: T('Quiz'), onEscape: close });
        document.addEventListener('keydown', onKeys, true);
    }
    keyHandler = null;
    const panel = root.firstChild; panel.textContent = '';
    const head = el('div', 'quiz-head');
    const b = btn('‹', 'quiz-icon', back || close); b.setAttribute('aria-label', back ? T('Back') : T('Close'));
    const h = el('h2', 'quiz-title', heading);
    const x = btn('✕', 'quiz-icon', close); x.setAttribute('aria-label', T('Close'));
    head.append(b, h, x);
    const body = el('div', 'quiz-body');
    panel.append(head, body);
    panel.scrollTop = 0;
    return body;
}

function seg(label, options, value, onPick) {
    const wrap = el('div', 'quiz-field');
    const cap = el('div', 'quiz-cap', label); cap.id = 'quizcap-' + Math.random().toString(36).slice(2, 8);
    const g = el('div', 'a11y-seg a11y-seg--hug quiz-seg'); g.setAttribute('role', 'radiogroup'); bindSegKeys(g); g.setAttribute('aria-labelledby', cap.id);
    options.forEach(([v, text, disabled]) => {
        const b = btn(text, 'quiz-seg-btn' + (v === value ? ' on' : ''), () => { onPick(v); [...g.children].forEach(c => { const on = c === b; c.classList.toggle('on', on); c.setAttribute('aria-checked', String(on)); }); });
        b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(v === value)); b.disabled = !!disabled;
        g.append(b);
    });
    wrap.append(cap, g);
    return wrap;
}

/** Entry: articles = index entries (id, title, …) of the selection or the collection. opts: { name, toast } */
export async function openQuiz(articles, { name = '', toast = () => {} } = {}) {
    const list = (articles || []).filter(a => a && a.id).slice(0, QUIZ_MAX_ARTICLES);
    if (list.length < QUIZ_MIN_ARTICLES) { toast(T('A quiz needs at least 2 articles')); return; }
    viewSetup({ name: name || TN(list.length, '{n} article', '{n} articles'), articles: list, toast });
}

function viewSetup(ctx) {
    const body = screen('🎓 ' + T('Quiz'));
    body.append(el('div', 'quiz-sub', ctx.name));
    const tags = el('div', 'quiz-tags');
    const paintTags = () => {
        tags.textContent = '';
        ctx.articles.forEach((a) => {
            const t = el('span', 'quiz-tag'); t.append(el('span', '', short(title(a), 28)));
            if (ctx.articles.length > QUIZ_MIN_ARTICLES) {
                const x = btn('×', 'quiz-tag-x', () => { ctx.articles = ctx.articles.filter(b => b !== a); paintTags(); paintPlan(); });
                x.setAttribute('aria-label', T('Leave out “{title}”', { title: title(a) })); t.append(x);
            }
            tags.append(t);
        });
    };
    paintTags();
    body.append(tags);
    body.append(seg(T('Questions'), QUIZ_SIZES.map(n => [n, String(n)]), settings.total, (v) => { settings.total = v; paintPlan(); }));
    body.append(seg(T('Mix'), [['article', T('Per article')], ['across', T('Across articles')], ['both', T('Both')]], settings.mix, (v) => { settings.mix = v; paintPlan(); }));
    const plan = el('p', 'quiz-hint');
    const paintPlan = () => {
        const p = quizPlan(settings.total, ctx.articles.length, settings.mix);
        const per = p.per.filter(Boolean).length ? Math.max(...p.per) : 0;
        plan.textContent = settings.mix === 'article' ? T('About {n} questions per article.', { n: per })
            : settings.mix === 'across' ? T('Questions that connect two articles: what both say, where they differ.')
                : T('About {n} per article, plus {m} that connect articles.', { n: per, m: p.across });
        req.textContent = T('Uses your model · {n} requests · stays on this device', { n: ctx.articles.length + (p.across ? 1 : 0) });
    };
    body.append(plan);
    const note = el('div', 'quiz-note');
    note.append(el('span', 'quiz-note-ic', 'ℹ'), el('span', '', T('Questions come from the full text and check understanding. Each one shows the sentence that backs its answer; questions the text does not support are dropped.')));
    body.append(note);
    const go = btn('✨ ' + T('Create quiz'), 'button-primary quiz-wide', () => viewWriting(ctx));
    const req = el('p', 'quiz-meta');
    body.append(el('div', 'quiz-grow'), go, req);
    paintPlan();
    go.focus();
}

async function viewWriting(ctx) {
    const body = screen('🎓 ' + T('Quiz'), { back: () => viewSetup(ctx) });
    body.append(el('h3', 'quiz-h', T('Writing questions…')));
    const bar = el('div', 'quiz-track quiz-track--busy'); bar.append(el('span', 'quiz-fill')); body.append(bar);
    const box = el('div', 'quiz-card quiz-steps'); box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite');
    const rows = ctx.articles.map((a) => {
        const r = el('div', 'quiz-step'); const ic = el('span', 'quiz-step-ic', '·'); const t = el('span', 'quiz-step-t', title(a)); const n = el('span', 'quiz-step-n', T('waiting'));
        r.append(ic, t, n); box.append(r); return { r, ic, n };
    });
    const plan = quizPlan(settings.total, ctx.articles.length, settings.mix);
    let acrossRow = null;
    if (plan.across) {
        const r = el('div', 'quiz-step'); const ic = el('span', 'quiz-step-ic', '·'); const n = el('span', 'quiz-step-n', T('waiting'));
        r.append(ic, el('span', 'quiz-step-t', '🔗 ' + T('Across articles')), n); box.append(r); acrossRow = { r, ic, n };
    }
    body.append(box);
    const cancel = btn(T('Cancel'), 'button-secondary quiz-wide', () => { if (abort) abort.abort(); viewSetup(ctx); });
    body.append(el('div', 'quiz-grow'), cancel);
    const mark = (row, s) => {
        if (s.state === 'writing') { row.ic.textContent = '…'; row.n.textContent = T('writing'); row.r.className = 'quiz-step is-busy'; }
        else if (s.state === 'done') { row.ic.textContent = '✓'; row.n.textContent = TN(s.made || 0, '{n} question', '{n} questions') + (s.dropped ? ' · ' + T('{n} dropped', { n: s.dropped }) : ''); row.r.className = 'quiz-step is-ok'; }
        else { row.ic.textContent = '✕'; row.n.textContent = T('no questions'); row.r.className = 'quiz-step is-bad'; }
    };
    abort = new AbortController();
    try {
        const [{ default: StorageManager }, { aiComplete, languageName }] = await Promise.all([import('../storageManager.js'), import('../feedAi.js')]);
        const full = await Promise.all(ctx.articles.map(a => StorageManager.getArticleFull(a.id).catch(() => a)));
        const lang = await languageName();
        const res = await createQuiz(full, { total: settings.total, mix: settings.mix, lang, aiComplete, signal: abort.signal,
            onArticle: (s) => mark(rows[s.index], s), onAcross: (s) => acrossRow && mark(acrossRow, s) });
        abort = null;
        if (!root) return;
        if (!res.questions.length) {
            bar.remove(); cancel.remove();
            const err = el('div', 'quiz-note quiz-note--bad'); err.setAttribute('role', 'alert');
            err.append(el('span', 'quiz-note-ic', '!'), el('span', '', T('No question had a matching sentence in the articles. Try other articles or another model.')));
            body.append(err, btn(T('Back'), 'button-secondary quiz-wide', () => viewSetup(ctx)));
            return;
        }
        const quiz = {
            id: 'qz' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: ctx.name, created: new Date().toISOString(),
            articles: ctx.articles.map(a => ({ id: a.id, title: title(a), url: a.url || '' })), questions: res.questions, mix: settings.mix,
        };
        await saveQuiz(quiz);
        startRun(quiz, quiz.questions.map(q => q.id), ctx);
    } catch (e) {
        abort = null;
        if (!root || (e && (e.name === 'AbortError' || e.cancelled))) return;
        bar.remove();
        const err = el('div', 'quiz-note quiz-note--bad'); err.setAttribute('role', 'alert');
        err.append(el('span', 'quiz-note-ic', '!'), el('span', '', (e && e.message) || T('AI request failed')));
        body.append(err);
    }
}

/** One run over the given question ids (all, or the ones to repeat). */
function startRun(quiz, ids, ctx = null) {
    const run = { quiz, ids: ids.filter(id => quiz.questions.some(q => q.id === id && !q.reported)), at: 0, answers: {}, ctx };
    if (!run.ids.length) { viewResult(run); return; }
    viewQuestion(run);
}

const qById = (quiz, id) => quiz.questions.find(q => q.id === id);
const artOf = (quiz, id) => (quiz.articles || []).find(a => a.id === id) || { id, title: T('Untitled') };

function readerUrl(articleId, quote) {
    return chrome.runtime.getURL('readerPage.html') + '#id=' + encodeURIComponent(articleId) + (quote ? '&q=' + encodeURIComponent(quote) : '');
}
function openTab(url) { try { if (chrome.tabs && chrome.tabs.create) { chrome.tabs.create({ url }); return; } } catch (_) { /* fall through */ } window.open(url, '_blank', 'noopener'); }

function viewQuestion(run) {
    const q = qById(run.quiz, run.ids[run.at]);
    const n = run.ids.length;
    const body = screen('🎓 ' + T('Question {i} of {n}', { i: run.at + 1, n }));
    const bar = el('div', 'quiz-track'); bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', String(n)); bar.setAttribute('aria-valuenow', String(run.at));
    const f = el('span', 'quiz-fill'); f.style.width = Math.round((run.at / n) * 100) + '%'; bar.append(f); body.append(bar);
    const from = q.kind === 'across'
        ? '🔗 ' + [...new Set(q.sources.map(s => s.articleId))].map(id => short(artOf(run.quiz, id).title, 22)).join(' + ')
        : '📄 ' + short(artOf(run.quiz, q.sources[0].articleId).title, 44);
    body.append(el('span', 'quiz-from' + (q.kind === 'across' ? ' quiz-from--across' : ''), from));
    const h = el('h3', 'quiz-q', q.q); h.id = 'quiz-q'; body.append(h);
    const list = el('div', 'quiz-answers'); list.setAttribute('role', 'group'); list.setAttribute('aria-labelledby', 'quiz-q');
    const buttons = q.options.map((o, i) => {
        const b = btn('', 'quiz-answer', () => answer(i));
        b.append(el('span', 'quiz-letter', 'ABCD'[i]), el('span', 'quiz-answer-t', o));
        b.setAttribute('aria-keyshortcuts', String(i + 1));
        list.append(b); return b;
    });
    body.append(list);
    const notSure = btn(T('Not sure? Show me where it is'), 'quiz-link', () => answer(-1));
    body.append(notSure);
    const fb = el('div', 'quiz-feedback'); fb.setAttribute('aria-live', 'polite'); body.append(fb);
    let done = false;
    function answer(i) {
        if (done) return; done = true;
        run.answers[q.id] = i;
        const right = i === q.correct;
        buttons.forEach((b, k) => {
            b.disabled = true;
            if (k === q.correct) { b.classList.add('is-right'); b.querySelector('.quiz-letter').textContent = '✓'; }
            else if (k === i) { b.classList.add('is-wrong'); b.querySelector('.quiz-letter').textContent = '✕'; }
            else b.classList.add('is-dim');
        });
        notSure.remove();
        fb.append(el('p', 'quiz-verdict ' + (right ? 'is-right' : 'is-wrong'), right ? T('Right.') : i < 0 ? T('Here is the answer.') : T('Not quite. The right answer is {a}.', { a: 'ABCD'[q.correct] })));
        q.sources.forEach((s) => {
            const a = artOf(run.quiz, s.articleId);
            const c = el('div', 'quiz-source');
            c.append(el('div', 'quiz-source-h', T('Where it says so') + ' · ' + short(a.title, 40) + (s.para ? ' · ¶ ' + s.para : '')), el('blockquote', 'quiz-quote', '“' + s.quote + '”'));
            c.append(btn(T('Show in article') + ' ›', 'quiz-link', () => openTab(readerUrl(s.articleId, s.quote))));
            fb.append(c);
        });
        const acts = el('div', 'quiz-row');
        const report = btn('⚑ ' + T('Report question'), 'quiz-link quiz-link--muted', async () => {
            q.reported = true; await saveQuiz(run.quiz);
            report.disabled = true; report.textContent = T('Reported. It is left out from now on.');
        });
        const next = btn(run.at + 1 < n ? T('Next') : T('See result'), 'button-primary', () => { run.at++; if (run.at < n) viewQuestion(run); else finish(run); });
        acts.append(report, el('span', 'quiz-grow'), next);
        fb.append(acts);
        next.focus();
        keyHandler = (e) => { if (e.key === 'Enter' && document.activeElement !== report) { e.preventDefault(); next.click(); } };
    }
    keyHandler = (e) => { const k = Number(e.key); if (k >= 1 && k <= 4 && !e.altKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); answer(k - 1); } };
    buttons[0].focus();
}

async function finish(run) {
    const missed = run.ids.filter(id => run.answers[id] !== qById(run.quiz, id).correct);
    await saveResult(run.quiz, { score: run.ids.length - missed.length, missed });
    viewResult(run, missed);
}

function viewResult(run, missed = []) {
    const quiz = run.quiz, n = run.ids.length;
    const body = screen('🎓 ' + T('Quiz · done'));
    const score = el('div', 'quiz-score');
    score.append(el('strong', 'quiz-score-n', `${n - missed.length} / ${n}`),
        el('span', 'quiz-score-t', missed.length ? T('{n} to repeat. The answers stay on this device.', { n: missed.length }) : T('All right. The answers stay on this device.')));
    body.append(score);
    // by article: a question counts for every article it cites
    const per = new Map();
    run.ids.forEach((id) => {
        const q = qById(quiz, id);
        const key = q.kind === 'across' ? '🔗' : q.sources[0].articleId;
        const r = per.get(key) || { right: 0, all: 0 }; r.all++; if (!missed.includes(id)) r.right++; per.set(key, r);
    });
    const card = el('div', 'quiz-card quiz-by'); card.setAttribute('role', 'list'); card.setAttribute('aria-label', T('By article'));
    for (const [key, r] of per) {
        const row = el('div', 'quiz-by-row'); row.setAttribute('role', 'listitem');
        const name = key === '🔗' ? '🔗 ' + T('Across articles') : artOf(quiz, key).title;
        row.append(el('span', 'quiz-by-t', name), el('span', 'quiz-by-n ' + (r.right === r.all ? 'is-right' : 'is-wrong'), `${r.right} / ${r.all}`));
        if (r.right < r.all && key !== '🔗') row.append(btn(T('Re-read') + ' ›', 'quiz-link', () => openTab(readerUrl(key))));
        card.append(row);
    }
    body.append(card);
    body.append(el('div', 'quiz-grow'));
    if (missed.length) body.append(btn('↻ ' + TN(missed.length, 'Repeat the {n}', 'Repeat the {n}'), 'button-primary quiz-wide', () => startRun(quiz, missed, run.ctx)));
    const row = el('div', 'quiz-row');
    const remind = btn('⏰ ' + T('Remind me in {n} days', { n: REMIND_DAYS }), 'button-secondary', async () => {
        remind.disabled = true;
        const ok = await remindLater(quiz);
        remind.textContent = ok ? T('Reminder set') : T('Reminders are not available here');
    });
    if (!missed.length) remind.hidden = true;
    row.append(remind, btn('⬇ ' + T('Export'), 'button-secondary', () => viewExport(run)));
    body.append(row);
    if (!missed.length) body.append(btn(T('Done'), 'button-primary quiz-wide', close));
}

function viewExport(run) {
    const quiz = run.quiz;
    const body = screen('⬇ ' + T('Export quiz'), { back: () => viewResult(run, (quiz.last && quiz.last.missed) || []) });
    const usable = { ...quiz, questions: quiz.questions.filter(q => !q.reported) };
    body.append(el('div', 'quiz-sub', T('{name} · {n} questions from {m} articles', { name: quiz.name, n: usable.questions.length, m: (quiz.articles || []).length })));
    const formats = [
        ['kahoot', '🟣', 'Kahoot', T('Play live with a class') + ' · .xlsx'],
        ['anki', '🗂', 'Anki', T('Flashcards') + ' · .txt'],
        ['moodle', '🎓', 'Moodle', T('Quiz bank') + ' · GIFT'],
    ];
    const list = el('div', 'quiz-formats'); list.setAttribute('role', 'radiogroup'); list.setAttribute('aria-label', T('Format'));
    const timeWrap = el('div');
    const paint = () => {
        [...list.children].forEach(b => { const on = b.dataset.f === settings.format; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
        timeWrap.hidden = settings.format !== 'kahoot';
        dl.textContent = '⬇ ' + T('Download {file}', { file: fileName() });
        hint.textContent = settings.format === 'kahoot' ? T('In Kahoot: Create → Import → Spreadsheet. Kahoot has no column for sources; they stay here.')
            : settings.format === 'anki' ? T('In Anki: File → Import. Importing again updates the cards.') : T('In Moodle: Question bank → Import → GIFT format.');
    };
    formats.forEach(([f, ic, name, sub]) => {
        const b = btn('', 'quiz-format', () => { settings.format = f; paint(); }); b.dataset.f = f; b.setAttribute('role', 'radio');
        const tx = el('span', 'quiz-format-tx'); tx.append(el('span', 'quiz-format-t', name), el('span', 'quiz-format-s', sub));
        b.append(el('span', 'quiz-format-ic', ic), tx);
        list.append(b);
    });
    body.append(list);
    timeWrap.append(seg(T('Time per question (Kahoot)'), [10, 20, 30, 60].map(s => [s, T('{n} s', { n: s })]), settings.time, (v) => { settings.time = v; }));
    body.append(timeWrap);
    const status = el('div', 'quiz-note'); status.hidden = true; status.setAttribute('role', 'status');
    const hint = el('p', 'quiz-meta');
    const base = String(quiz.name || 'quiz').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'quiz';
    const fileName = () => base + (settings.format === 'kahoot' ? ' - Kahoot.xlsx' : settings.format === 'anki' ? ' - Anki.txt' : ' - Moodle.gift.txt');
    const dl = btn('', 'button-primary quiz-wide', async () => {
        dl.disabled = true;
        try {
            const X = await import('./quizExport.js');
            let blob, cut = 0;
            if (settings.format === 'kahoot') ({ blob, cut } = await X.kahootXlsx(usable, settings.time));
            else blob = new Blob([settings.format === 'anki' ? X.ankiText(usable) : X.moodleGift(usable)], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = fileName(); document.body.append(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 2000);
            status.hidden = false; status.className = 'quiz-note' + (cut ? ' quiz-note--warn' : '');
            status.textContent = cut ? TN(cut, '{n} text was longer than Kahoot allows and was shortened. Check it in Kahoot.', '{n} texts were longer than Kahoot allows and were shortened. Check them in Kahoot.') : T('Saved {file}', { file: fileName() });
        } catch (e) { status.hidden = false; status.className = 'quiz-note quiz-note--bad'; status.textContent = (e && e.message) || T('Export failed'); }
        finally { dl.disabled = false; }
    });
    body.append(status, el('div', 'quiz-grow'), dl, hint);
    paint();
}

/** popup.html#quiz=<id> (the reminder): reopen a saved quiz with the questions to repeat (or all when none were missed). */
export async function openSavedQuiz(id) {
    const quiz = await getQuiz(id);
    if (!quiz) return false;
    const missed = (quiz.last && quiz.last.missed) || [];
    startRun(quiz, missed.length ? missed : quiz.questions.map(q => q.id));
    return true;
}

export const __test = { close, viewResult, startRun };

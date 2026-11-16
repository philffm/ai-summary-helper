// quiz/quizStore.js — saved quizzes (quiz:rec:<id> in storage.local) and the "repeat in 3 days" reminder (an alarm in the worker,
// action quizRemind). The record keeps the questions with their sources, the article ids and titles, and the last result.
import { quizRecKey } from '../storageKeys.js';
import StorageManager from '../storageManager.js';

export const REMIND_DAYS = 3;

export async function saveQuiz(quiz) {
    await StorageManager.setLocal({ [quizRecKey(quiz.id)]: quiz });
    return quiz;
}

export async function getQuiz(id) {
    const k = quizRecKey(id);
    try { return (await StorageManager.getLocal([k]))[k] || null; } catch (_) { return null; }
}

/** Stores the result of a run: score, the ids of the questions answered wrong, when. */
export async function saveResult(quiz, { score, missed }) {
    quiz.last = { score, total: quiz.questions.length, missed, at: new Date().toISOString() };
    return saveQuiz(quiz);
}

/** Asks the worker for a notification in `days` days that opens the quiz with the questions to repeat. */
export async function remindLater(quiz, days = REMIND_DAYS, now = Date.now()) {
    const dueAt = now + days * 864e5;
    quiz.remindAt = new Date(dueAt).toISOString();
    await saveQuiz(quiz);
    return new Promise((resolve) => {
        try { chrome.runtime.sendMessage({ action: 'quizRemind', id: quiz.id, dueAt }, (r) => { void chrome.runtime.lastError; resolve(!!(r && r.ok)); }); }
        catch (_) { resolve(false); }
    });
}

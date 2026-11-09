// settings/danger.js — split out of settingsManager.js (R4 phase 1).
import { confirmDestructive } from '../confirmDialog.js';
import { deleteData, describeData } from '../dataReset.js';
import { T, TN } from '../feedI18n.js';

// ── Section: Danger Zone ─────────────────────────────────────────────
export function initDangerZone() {
    const btnSettings = document.getElementById('deleteSettingsButton');
    const btnHistory = document.getElementById('deleteHistoryButton');
    const btnAll = document.getElementById('deleteAllButton');

    // One dialog for all three buttons: a checklist of what goes, with counts, preselected by the button that opened it.
    const askAndDelete = async ({ title, body, preselect, confirmLabel, button }) => {
        const counts = await describeData().catch(() => ({}));
        const rows = [
            ['articles', '📚 ' + T('Summaries & archive'), counts.articles ? TN(counts.articles, '{n} summary', '{n} summaries') : ''],
            ['highlights', '🖍️ ' + T('Highlights'), counts.highlights ? String(counts.highlights) : ''],
            ['feeds', '📰 ' + T('Feeds'), counts.feeds ? TN(counts.feeds, '{n} feed', '{n} feeds') + ' · ' + TN(counts.feedItems || 0, '{n} item', '{n} items') : ''],
            ['podcasts', '🎙️ ' + T('Podcasts'), counts.podcasts ? String(counts.podcasts) : ''],
            ['keys', '🔑 ' + T('API keys, sign-in & license'), counts.keys ? String(counts.keys) : ''],
            ['send', '📤 ' + T('Kindle & LocalSend targets'), counts.send ? String(counts.send) : ''],
            ['prefs', '⚙️ ' + T('Preferences & prompts'), ''],
        ];
        const list = document.createElement('div');
        list.className = 'delete-list';
        const boxes = {};
        rows.forEach(([id, label, note]) => {
            const row = document.createElement('label');
            row.className = 'delete-row';
            const cb = document.createElement('input');
            cb.type = 'checkbox'; cb.checked = preselect.includes(id); cb.dataset.cat = id;
            const name = document.createElement('span'); name.className = 'delete-name'; name.textContent = label;
            const n = document.createElement('span'); n.className = 'delete-count'; n.textContent = note;
            row.append(cb, name, n);
            list.appendChild(row);
            boxes[id] = cb;
        });
        const chosen = () => Object.keys(boxes).filter((id) => boxes[id].checked);
        const yes = await confirmDestructive({
            title, body, confirmLabel, content: list,
            canConfirm: () => chosen().length > 0,
            extraLabel: T('Export backup first'),
            onExtra: () => { document.getElementById('exportSettingsButton')?.click(); }
        });
        if (!yes) return;
        const ids = chosen();
        if (!ids.length) return;
        const res = await deleteData(ids);
        const restart = res.everything || ids.includes('prefs') || ids.includes('keys');
        if (button) button.textContent = T('Deleted ✓');
        // Reload so nothing deleted is written back from memory (feeds and history screens keep their lists in memory).
        if (restart) chrome.runtime.reload(); else setTimeout(() => location.reload(), 400);
    };

    if (btnSettings) {
        btnSettings.addEventListener('click', () => askAndDelete({
            title: T('Delete settings?'),
            body: T('Resets preferences, prompts, API keys, sign-in and send targets on this device. Summaries, highlights and feeds stay unless you tick them. The extension will reload.'),
            preselect: ['prefs', 'keys', 'send'], confirmLabel: T('Delete settings'), button: btnSettings
        }));
    }
    if (btnHistory) {
        btnHistory.addEventListener('click', () => askAndDelete({
            title: T('Delete history?'),
            body: T('Permanently removes your summaries, the archive and your highlights from this device. Settings and feeds stay unless you tick them. This cannot be undone.'),
            preselect: ['articles', 'highlights'], confirmLabel: T('Delete history'), button: btnHistory
        }));
    }
    if (btnAll) {
        btnAll.addEventListener('click', () => askAndDelete({
            title: T('Delete all data?'),
            body: T('Removes everything this extension stores on this device and starts it fresh. This cannot be undone. Your account on our server is not affected: to have it deleted, contact us (see the privacy policy).'),
            preselect: ['articles', 'highlights', 'feeds', 'podcasts', 'keys', 'send', 'prefs'], confirmLabel: T('Delete all data'), button: btnAll
        }));
    }
}


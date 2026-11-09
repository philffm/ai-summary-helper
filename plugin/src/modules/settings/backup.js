// settings/backup.js — split out of settingsManager.js (R4 phase 1).
import { createHighlightStore } from '../highlightStore.js';
import { confirmSheet } from '../confirmSheet.js';
import { SK } from '../storageKeys.js';
import { filterBackupSecrets, hasBackupSecrets, prepareImportedData } from '../backupUtils.js';
import StorageManager from '../storageManager.js';
import { T } from '../feedI18n.js';
import { setLabel } from '../icons.js';
import { exportHistoryMarkdown } from '../markdownArchive.js';

// ── Section: Backup & Restore ────────────────────────────────────────
export function initBackupRestore() {
    const btnExport = document.getElementById('exportSettingsButton');
    const btnImport = document.getElementById('importSettingsButton');
    const fileInput = document.getElementById('importSettingsFile');
    const btnMd = document.getElementById('exportMarkdownButton');

    // ── Export history as Markdown (Obsidian / Logseq friendly .zip) ──
    if (btnMd) {
        const mdLabel = '📝 ' + T('Export history as Markdown (.zip)');
        btnMd.textContent = mdLabel;
        btnMd.addEventListener('click', async () => {
            btnMd.disabled = true;
            try {
                const n = await exportHistoryMarkdown({ onProgress: (i, total) => { btnMd.textContent = `⏳ ${i}/${total}`; } });
                btnMd.textContent = T('Exported! ✓ ({n} articles)', { n });
            } catch (err) {
                console.error('Markdown export failed:', err);
                btnMd.textContent = T('Failed to export backup.');
            }
            setTimeout(() => { btnMd.textContent = mdLabel; btnMd.disabled = false; }, 2500);
        });
    }

    // ── Export — settings-only or full backup ──
    if (btnExport) {
        // Build a small choice panel, hidden by default
        const choicePanel = document.createElement('div');
        choicePanel.className = 'export-choice';
        choicePanel.hidden = true;
        choicePanel.innerHTML = `
            <p class="export-choice-title">${T('What to export?')}</p>
            <button type="button" id="exportSettingsOnly" class="button-secondary">⚙️ ${T('Settings only')}</button>
            <button type="button" id="exportFullBackup"   class="button-secondary">📚 ${T('Settings + Article History')}</button>
            <label><input type="checkbox" id="includeBackupSecrets"> ${T('Include API keys and sign-in details (anyone with the file can use them)')}</label>
            <p>${T('By default, backups omit API keys, sign-in details, license keys, and install identifiers. Keep exported files private.')}</p>
        `;
        btnExport.parentElement.insertAdjacentElement('afterend', choicePanel);

        btnExport.addEventListener('click', () => {
            choicePanel.hidden = !choicePanel.hidden;
            btnExport.textContent = choicePanel.hidden ? '📤 ' + T('Export') : '📤 ' + T('Export') + ' ▲';
        });

        const doExport = async (includeContent) => {
            choicePanel.hidden = true;
            btnExport.textContent = '📤 ' + T('Export');
            try {
                const includeSecrets = document.getElementById('includeBackupSecrets')?.checked === true;
                if (includeSecrets && !(await confirmSheet({ title: T('Export with secrets?'), text: T('This backup will contain API keys, sign-in details, license keys, and an install identifier. Anyone with the file could use its keys or identify this install. Continue?'), confirmLabel: T('Export'), danger: false }))) return;

                // Fetch cleanly separated sync and local data
                const [syncData, localData] = await Promise.all([
                    new Promise(resolve => chrome.storage.sync.get(null, resolve)),
                    new Promise(resolve => chrome.storage.local.get(null, resolve))
                ]);
                const safeSyncData = filterBackupSecrets(syncData, includeSecrets);
                const safeLocalData = filterBackupSecrets(localData, includeSecrets);

                let backup, filename;
                const date = new Date().toISOString().split('T')[0].replace(/-/g, '');

                if (includeContent) {
                    // articlesIndex is the post-migration shape; the articles
                    // fallback only matters if exporting mid-transition,
                    // before migration has run in this session.
                    const count = (safeLocalData[SK.articlesIndex] || safeLocalData.articles || []).length;
                    backup = {
                        _backup_version: 5,   // 5 = highlights per page (hl:index, hl:page:<pageKey>); 4 = + collections (coll:index, coll:rec:<id>); 3 = registry key names (articles:index, feeds:*, account:* …); v2 (old names) still imports
                        _exported_at: new Date().toISOString(),
                        _article_count: count,
                        _contains_secrets: includeSecrets,
                        settings: safeSyncData,
                        local: safeLocalData
                    };
                    filename = `aish_backup_${date}_${count}articles.json`;
                } else {
                    backup = {
                        _backup_version: 1,
                        _exported_at: new Date().toISOString(),
                        _contains_secrets: includeSecrets,
                        ...safeSyncData
                    };
                    filename = `aish_settings_${date}.json`;
                }

                const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                const origNodes = [...btnExport.childNodes].map(n => n.cloneNode(true));   // nodes, not text: keeps the icon
                setLabel(btnExport, includeContent
                    ? T('Exported! ✓ ({n} articles)', { n: backup._article_count })
                    : T('Exported! ✓'));
                setTimeout(() => btnExport.replaceChildren(...origNodes), 2500);
            } catch (err) {
                console.error('Export failed:', err);
                alert(T('Failed to export backup.'));
            }
        };

        // Wire up once the panel is injected (next tick)
        setTimeout(() => {
            document.getElementById('exportSettingsOnly')?.addEventListener('click', () => doExport(false));
            document.getElementById('exportFullBackup')?.addEventListener('click',   () => doExport(true));
        }, 0);
    }

    // ── Import (settings + article history) ──
    if (btnImport && fileInput) {
        btnImport.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const importedData = JSON.parse(e.target.result);

                    if (typeof importedData !== 'object' || Array.isArray(importedData)) {
                        throw new Error('Invalid format');
                    }

                    const containsSecrets = hasBackupSecrets(importedData);
                    if (containsSecrets && !(await confirmSheet({ title: T('Import secrets?'), text: T('This backup contains API keys, sign-in details, license keys, or an install identifier. Importing will replace matching stored secrets. Continue?'), confirmLabel: T('Import'), danger: false }))) return;
                    const currentData = await StorageManager.getAll();

                    if ([2, 3, 4, 5].includes(importedData._backup_version)) {
                        // FIX: Leverage the new StorageManager routing
                        const settings = importedData.settings;
                        // v2 backups use the pre-registry key names → translate (no-op for v3)
                        const local = importedData.local ? prepareImportedData(importedData.local, currentData) : importedData.local;
                        const preparedSettings = settings ? prepareImportedData(settings, currentData) : settings;
                        if (preparedSettings) await StorageManager.set(preparedSettings);

                        if (local) {
                            if (Array.isArray(local.articles)) {
                                // Old-shape backup (pre-migration) — split it the
                                // same way the startup migration does, don't
                                // write the flat array back verbatim or every
                                // migrated screen will simply never see it again.
                                const { index, records } = StorageManager.splitArticlesArray(local.articles);
                                const { articles: _old, ...rest } = local; // drop the old key from the pass-through write
                                await StorageManager.set({ ...rest, [SK.articlesIndex]: index });

                                // Write per-article records in chunks rather than
                                // one call with hundreds of keys and all their
                                // content at once (same reasoning as the startup
                                // migration's chunked write).
                                const CHUNK_SIZE = 25;
                                const recordKeys = Object.keys(records);
                                for (let i = 0; i < recordKeys.length; i += CHUNK_SIZE) {
                                    const chunk = {};
                                    recordKeys.slice(i, i + CHUNK_SIZE).forEach(k => chunk[k] = records[k]);
                                    await StorageManager.setLocal(chunk);
                                }
                            } else {
                                await StorageManager.set(local); // already new-shape
                            }
                        }

                        // highlights: the restored pages get an index; an old backup's single list (hl:all) is merged into pages by the
                        // migration on the reload below
                        if (local) { try { await createHighlightStore({ storage: chrome.storage.local }).reindex(); } catch (_) { /* rebuilt on next change */ } }

                        const count = (local?.[SK.articlesIndex] || local?.articles || []).length;
                        alert(T('Backup restored successfully!\n{n} articles imported.\n\nThe extension will now reload.', { n: count }));
                    } else {
                        // Legacy v1 backup — settings only
                        // Safe to use StorageManager.set() since it routes automatically
                        await StorageManager.set(prepareImportedData(importedData, currentData));
                        alert(T('Settings imported successfully! The extension will now reload.'));
                    }

                    chrome.runtime.reload();
                } catch (err) {
                    console.error('Import failed:', err);
                    alert(T('Invalid backup file. Please select a valid AI Summary Helper export.'));
                } finally {
                    fileInput.value = '';
                }
            };

            reader.readAsText(file);
        });
    }
}



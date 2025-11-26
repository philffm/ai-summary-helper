// Shortcuts
// Handles keyboard shortcuts (e.g., Cmd+F)

export function initShortcuts({ historyScreenId = 'historyScreen', searchInputId = 'searchInput' } = {}) {
    document.addEventListener('keydown', (event) => {
        if (event.metaKey && event.key === 'f') { // ⌘ + F
            event.preventDefault();
            const historyScreen = document.getElementById(historyScreenId);
            const searchInput = document.getElementById(searchInputId);
            if (historyScreen && searchInput && historyScreen.style.display === 'block') {
                searchInput.focus();
            }
        }
    });
}

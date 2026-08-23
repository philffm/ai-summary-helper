// Shortcuts
// Handles keyboard shortcuts (e.g., Cmd+F)

export function initShortcuts({ historyScreenId = 'historyScreen', searchInputId = 'searchInput' } = {}) {
    document.addEventListener('keydown', (event) => {
        if (event.metaKey && event.key === 'f') { // ⌘ + F
            event.preventDefault();
            const historyScreen = document.getElementById(historyScreenId);
            const searchInput = document.getElementById(searchInputId);
            const historyNav = document.querySelector('.nav-item[data-screen="history"]');
            if (historyScreen && searchInput && historyNav && historyNav.classList.contains('active')) {
                searchInput.focus();
            }
        }
    });
}

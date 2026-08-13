// uiManager.js
class UIManager {
    constructor() {
        this.screenOrder = ['main', 'history', 'apps', 'settings'];
        this._currentScreenIdx = undefined;

        this.screens = {
            main: document.getElementById('mainScreen'),
            settings: document.getElementById('settingsScreen'),
            history: document.getElementById('historyScreen'),
            apps: document.getElementById('appsScreen'),
            podcast: document.getElementById('podcastScreen')
        };
    }

    positionNavBlob(screenName) {
        const blob = document.getElementById('navBlob');
        if (!blob) return;
        const activeItem = document.querySelector(`.nav-item[data-screen="${screenName}"]`);
        if (!activeItem) return;
        const nav = document.getElementById('bottomNav');
        if (!nav) return;

        const navRect = nav.getBoundingClientRect();
        const itemRect = activeItem.getBoundingClientRect();

        const x = itemRect.left - navRect.left;
        const w = itemRect.width;
        blob.style.transform = `translateX(${x}px)`;
        blob.style.width = `${w}px`;
    }

    async showScreen(screenName) {
        const targetIdx = this.screenOrder.indexOf(screenName);

        // Handle screens not in the nav order (e.g. 'podcast')
        if (targetIdx === -1) {
            // Hide nav-order screens so only the external screen is visible
            this.screenOrder.forEach((name) => {
                const el = this.screens[name];
                if (el) {
                    el.style.transition = 'none';
                    el.style.transform = `translateX(100%)`;
                }
            });
            if (this.screens[screenName]) {
                this.screens[screenName].style.display = 'block';
                this.screens[screenName].style.transition = 'none';
                this.screens[screenName].style.transform = 'translateX(0)';
            }
            return;
        }

        // Sync bottom nav active state
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
            item.classList.toggle('active', item.dataset.screen === screenName);
        });
        this.positionNavBlob(screenName);

        // Show the floating Save button only on the settings screen
        const saveFab = document.getElementById('settingsSaveFab');
        if (saveFab) {
            saveFab.style.display = screenName === 'settings' ? 'block' : 'none';
        }

        if (this._currentScreenIdx === undefined) {
            // First show: set initial positions without animation
            const blob = document.getElementById('navBlob');
            if (blob) blob.style.transition = 'none';
            this.screenOrder.forEach((name, i) => {
                const el = this.screens[name];
                if (!el) return;
                el.style.transition = 'none';
                el.style.transform = `translateX(${(i - targetIdx) * 100}%)`;
            });
            this.positionNavBlob(screenName);
            if (blob) {
                // Re-enable transition after next frame
                requestAnimationFrame(() => {
                    if (blob) blob.style.transition = '';
                });
            }
            this._currentScreenIdx = targetIdx;
            if (screenName === 'history') {
                const { loadHistory } = await import('./articleManager.js');
                loadHistory();
            }
            return;
        }

        if (targetIdx === this._currentScreenIdx) return;

        const direction = targetIdx > this._currentScreenIdx ? 1 : -1;

        // Phase 1: Set starting positions (no transition)
        this.screenOrder.forEach((name, i) => {
            const el = this.screens[name];
            if (!el) return;
            el.style.transition = 'none';
            if (i === this._currentScreenIdx) {
                el.style.transform = 'translateX(0)';
            } else if (i === targetIdx) {
                el.style.transform = `translateX(${direction * 100}%)`;
            } else {
                el.style.transform = `translateX(${(i < targetIdx ? -1 : 1) * 100}%)`;
            }
        });

        // Force reflow
        void document.body.offsetHeight;

        // Phase 2: Animate to final positions (with transition)
        this.screenOrder.forEach((name, i) => {
            const el = this.screens[name];
            if (!el) return;
            el.style.transition = 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)';
            if (i === targetIdx) {
                el.style.transform = 'translateX(0)';
            } else {
                el.style.transform = `translateX(${(i < targetIdx ? -1 : 1) * 100}%)`;
            }
        });

        this._currentScreenIdx = targetIdx;

        // Side effects per screen (delayed to let animation play)
        if (screenName === 'history') {
            setTimeout(async () => {
                try {
                    const { loadHistory } = await import('./articleManager.js');
                    loadHistory();
                } catch (e) {
                    // Ignore if extension context was invalidated (popup closed)
                }
            }, 350);
        }
    }

    toggleElementVisibility(element, show) {
        element.style.display = show ? 'block' : 'none';
    }

    showToast(message, duration = 3000) {
        const toast = document.createElement('div');
        toast.className = 'toast-message';
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), duration);
    }

    // Podcast menu entry point
    enterPodcastMenu() {
        if (this.screens.history && document.getElementById('podcastScreen')) {
            this.showScreen('history');
            import('./archiveManager.js').then(mod => {
                mod.showPodcastManagerInHistory();
            });
        } else {
            this.showScreen('podcast');
            const podcastScreen = this.screens.podcast;
            if (podcastScreen) {
                podcastScreen.innerHTML = '';
                import('./podcastManager.js').then(mod => {
                    mod.renderPodcastUI(podcastScreen);
                });
            }
        }
    }
}

export default UIManager;

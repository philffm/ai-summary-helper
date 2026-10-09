// uiManager.js
class UIManager {
    constructor() {
        this.screenOrder = ['feeds', 'main', 'history', 'settings'];
        this._currentScreenIdx = undefined;

        this.screens = {
            main: document.getElementById('mainScreen'),
            settings: document.getElementById('settingsScreen'),
            history: document.getElementById('historyScreen'),
            feeds: document.getElementById('feedsScreen'),
            podcast: document.getElementById('podcastScreen')
        };

        // Safety net: if anything still scrolls the screen container sideways (focus/scrollIntoView on an
        // off-screen screen), snap it back so a neighbouring screen never stays half in view.
        const container = document.querySelector('.screen-container');
        if (container) {
            const reset = () => { if (container.scrollLeft) container.scrollLeft = 0; if (container.scrollTop) container.scrollTop = 0; };
            container.addEventListener('scroll', reset, { passive: true });
        }
    }

    positionNavBlob(screenName) {
        const blob = document.getElementById('navBlob');
        if (!blob) return;
        const activeItem = document.querySelector(`.nav-item[data-screen="${screenName}"]`);
        // Settings lives in the header, not the bottom nav — no tab to highlight.
        blob.style.opacity = activeItem ? '' : '0';
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
        document.body.dataset.screen = screenName;   // CSS: header layout switcher only on feeds/history

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

        // Header gear mirrors the nav's active state for the settings screen
        const settingsBtn = document.getElementById('settingsButton');
        if (settingsBtn) settingsBtn.classList.toggle('active', screenName === 'settings');
        if (screenName !== 'settings') this._lastNavScreen = screenName;

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
            if (screenName === 'feeds') {
                const { onFeedsScreenShown } = await import('./feedManager.js');
                onFeedsScreenShown(this);
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
            // Re-entering Feeds always starts at the top, so the sticky filter bar is in view (no stale scroll / gap).
            if (i === targetIdx && name === 'feeds') el.scrollTop = 0;
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

        if (screenName === 'feeds') {
            setTimeout(async () => {
                try {
                    const { onFeedsScreenShown } = await import('./feedManager.js');
                    onFeedsScreenShown(this);
                } catch (e) {
                    // Ignore if extension context was invalidated (popup closed)
                }
            }, 350);
        }

        // Re-poll account status whenever the user opens the Settings screen,
        // so the "Account Sync" panel reflects the latest subscription state
        // instead of whatever was fetched at popup load.
        if (screenName === 'settings') {
            setTimeout(async () => {
                try {
                    const { refreshAuthStateFromSettings } = await import('./authManager.js');
                    await refreshAuthStateFromSettings();
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
        // Shared stack container so concurrent toasts lay out one below the
        // other via normal flex flow instead of each being independently
        // fixed-positioned at the same spot and overlapping.
        let stack = document.getElementById('toastStack');
        if (!stack) {
            stack = document.createElement('div');
            stack.id = 'toastStack';
            stack.setAttribute('role', 'status'); stack.setAttribute('aria-live', 'polite');   // screen readers announce toasts
            document.body.appendChild(stack);
        }
        const toast = document.createElement('div');
        toast.className = 'toast-message';
        toast.textContent = message;
        stack.appendChild(toast);
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

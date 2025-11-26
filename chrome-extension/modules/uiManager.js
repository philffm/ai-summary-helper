// uiManager.js
class UIManager {
    constructor() {
            this.screens = {
                main: document.getElementById('mainScreen'),
                settings: document.getElementById('settingsScreen'),
                history: document.getElementById('historyScreen'),
                podcast: document.getElementById('podcastScreen') // ⭐ NEW
            };

        this.buttons = {
            history: document.getElementById('historyButton'),
            settings: document.getElementById('toggleScreenButton'),
            back: document.getElementById('backButton'),
            podcast: document.getElementById('podcastButton'),
            apps: document.getElementById('appsButton')
        };
    }

    showScreen(screenName) {
        // Ensure body has no padding or margin
        document.body.style.padding = '0';
        document.body.style.margin = '0';

        // Hide all screens safely
        Object.values(this.screens).forEach(screen => {
            if (screen) screen.style.display = 'none';
        });
        // Show requested screen if exists
        if (this.screens[screenName]) {
            this.screens[screenName].style.display = 'block';
        }

        // Update button visibility based on the current screen
        switch (screenName) {
            case 'main':
                this.buttons.apps.style.display = 'block';
                this.buttons.history.style.display = 'block';
                this.buttons.settings.style.display = 'block';
                this.buttons.back.style.display = 'none';
                this.buttons.podcast.style.display = 'none';
                break;
            case 'settings':
                this.buttons.apps.style.display = 'none';
                this.buttons.history.style.display = 'none';
                this.buttons.settings.style.display = 'none';
                this.buttons.back.style.display = 'block';
                this.buttons.podcast.style.display = 'none';
                break;
            case 'history':
                this.buttons.apps.style.display = 'none';
                this.buttons.history.style.display = 'none';
                this.buttons.settings.style.display = 'none';
                this.buttons.back.style.display = 'block';
                this.buttons.podcast.style.display = 'block';
                break;
            case 'podcast': // ⭐ NEW RULESET
                this.buttons.apps.style.display = 'none';
                this.buttons.history.style.display = 'none';
                this.buttons.settings.style.display = 'none';
                this.buttons.back.style.display = 'block';
                this.buttons.podcast.style.display = 'none'; // avoid recursion
                break;
            default:
                break;
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
}

export default UIManager;

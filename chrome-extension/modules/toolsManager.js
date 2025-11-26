// toolsManager.js
// Handles loading and displaying compatible tools

function loadCompatibleTools(compatibleToolsSection) {
    fetch('compatible-tools.json')
        .then(response => response.json())
        .then(tools => {
            compatibleToolsSection.innerHTML = '';
            tools.forEach(tool => {
                const card = document.createElement('div');
                card.className = 'tool-card';
                // Be tolerant about field names (some files use PascalCase keys)
                const name = tool.name || tool.Name || tool.title || tool.Title || 'Unnamed Tool';
                const description = tool.description || tool.Description || tool.desc || tool.Desc || '';
                const url = tool.url || tool.URL || tool.link || '';
                const linkHtml = url ? `<a class="discover-button" href="${url}" target="_blank">Open</a>` : '';
                card.innerHTML = `<div class="tool-card-content"><div><h3>${name}</h3><p>${description}</p></div>${linkHtml}</div>`;
                compatibleToolsSection.appendChild(card);
            });
        })
        .catch(error => console.error('Error loading compatible tools:', error));
}

function initToolsManager(ui) {
    const compatibleToolsSection = document.getElementById('compatibleToolsList');
    // The visible container that is hidden by CSS is the parent `.compatible-tools`.
    // We'll toggle that container so showing/hiding works correctly.
    const compatibleToolsContainer = document.querySelector('.compatible-tools');
    const appsButton = document.getElementById('appsButton');
    if (compatibleToolsSection) {
        loadCompatibleTools(compatibleToolsSection);
        // Ensure parent container is hidden initially (CSS also sets this) and
        // toggle the parent container when the apps button is clicked.
        if (compatibleToolsContainer) compatibleToolsContainer.style.display = 'none';
        if (appsButton) {
            appsButton.addEventListener('click', () => {
                if (!compatibleToolsContainer) return;
                if (compatibleToolsContainer.style.display === 'none' || compatibleToolsContainer.style.display === '') {
                    compatibleToolsContainer.style.display = 'block';
                } else {
                    compatibleToolsContainer.style.display = 'none';
                }
            });
        }
    }
}

export { loadCompatibleTools, initToolsManager };

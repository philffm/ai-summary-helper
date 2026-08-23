// toolsManager.js
// Handles loading and displaying compatible tools

function loadCompatibleTools(compatibleToolsSection) {
    fetch('compatible-tools.json')
        .then(response => response.json())
        .then(tools => {
            compatibleToolsSection.innerHTML = '';
            if (!tools.length) {
                compatibleToolsSection.innerHTML = '<div class="explanatory-card">No tools available yet.</div>';
                return;
            }
            tools.forEach(tool => {
                const card = document.createElement('div');
                card.className = 'tool-card';
                const name = tool.name || tool.Name || tool.title || tool.Title || 'Unnamed Tool';
                const description = tool.description || tool.Description || tool.desc || tool.Desc || '';
                const url = tool.url || tool.URL || tool.link || '';
                const linkHtml = url
                    ? `<a class="discover-button" href="${url}" target="_blank">Open →</a>`
                    : '';
                card.innerHTML = `
                    <div class="tool-card-content">
                        <div class="tool-card-body">
                            <h3>${name}</h3>
                            <p>${description}</p>
                        </div>
                        ${linkHtml}
                    </div>`;
                compatibleToolsSection.appendChild(card);
            });
        })
        .catch(error => {
            console.error('Error loading compatible tools:', error);
            compatibleToolsSection.innerHTML = '<div class="explanatory-card">Failed to load tools.</div>';
        });
}

function initToolsManager(ui) {
    const compatibleToolsSection = document.getElementById('compatibleToolsList');
    if (compatibleToolsSection) {
        loadCompatibleTools(compatibleToolsSection);
    }
}

export { loadCompatibleTools, initToolsManager };

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
                card.innerHTML = `<h3>${tool.name}</h3><p>${tool.description}</p>`;
                compatibleToolsSection.appendChild(card);
            });
        })
        .catch(error => console.error('Error loading compatible tools:', error));
}

function initToolsManager(ui) {
    const compatibleToolsSection = document.getElementById('compatibleToolsList');
    const appsButton = document.getElementById('appsButton');
    if (compatibleToolsSection) {
        loadCompatibleTools(compatibleToolsSection);
        compatibleToolsSection.style.display = 'none';
        if (appsButton) {
            appsButton.addEventListener('click', () => {
                if (compatibleToolsSection.style.display === 'none' || compatibleToolsSection.style.display === '') {
                    compatibleToolsSection.style.display = 'block';
                } else {
                    compatibleToolsSection.style.display = 'none';
                }
            });
        }
    }
}

export { loadCompatibleTools, initToolsManager };

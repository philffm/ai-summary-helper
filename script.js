let appData; 

// Markdown Link Converter
const convertMarkdownLinks = (text) => text.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

// Map language codes
const languageMap = {
    'en': 'en', 'en-US': 'en', 'en-GB': 'en',
    'es': 'es', 'es-ES': 'es', 'es-MX': 'es',
    'de': 'de', 'de-DE': 'de',
    'fr': 'fr', 'fr-FR': 'fr',
    'it': 'it', 'it-IT': 'it',
    'pt': 'pt', 'pt-PT': 'pt', 'pt-BR': 'pt',
    'nl': 'nl', 'nl-NL': 'nl',
    'ru': 'ru', 'ru-RU': 'ru',
    'ua': 'ua', 'uk-UA': 'ua',
    'pl': 'pl', 'pl-PL': 'pl',
    'sv': 'sv', 'sv-SE': 'sv',
    'da': 'da', 'da-DK': 'da',
    'jp': 'jp', 'ja': 'jp', 'ja-JP': 'jp',
    'cn': 'cn', 'zh': 'cn', 'zh-CN': 'cn', 'zh-Hans-CN': 'cn', 'zh-TW': 'cn',
    'kr': 'kr', 'ko': 'kr', 'ko-KR': 'kr',
    'hi': 'hi', 'hi-IN': 'hi', 'mr': 'hi', 'mr-IN': 'hi',
    'th': 'th', 'th-TH': 'th',
    'id': 'ind-bahasa', 'id-ID': 'ind-bahasa', 'ind-bahasa': 'ind-bahasa',
    'ar': 'ar', 'ar-SA': 'ar',
    'tr': 'tr', 'tr-TR': 'tr',
    'bg': 'bg', 'bg-BG': 'bg',
    'ro': 'ro', 'ro-RO': 'ro'
};

// Fetch and apply content
async function loadContent(lang = 'en') {
    try {
        const mappedLang = languageMap[lang] || 'en';
        const response = await fetch(`lang/${mappedLang}.json`);
        
        if (!response.ok) throw new Error(`Failed to load language file: ${mappedLang}`);
        appData = await response.json();

        // Fallback for aisummary prop
        if (!appData.aisummary) {
            const enResponse = await fetch('lang/en.json');
            if (enResponse.ok) {
                const enData = await enResponse.json();
                appData.aisummary = enData.aisummary;
            }
        }

        // Apply metadata & static texts
        document.getElementById('metaTitle').textContent = appData.title;
        document.getElementById('metaDescription').setAttribute('content', appData.aboutText);
        document.getElementById('title').textContent = appData.title;
        document.getElementById('aboutText').innerHTML = convertMarkdownLinks(appData.aboutText);

        // Apply Feature List
        const featureList = document.getElementById('featureList');
        featureList.innerHTML = appData.featureList.map(item => `
            <div class="feature-card">${convertMarkdownLinks(item)}</div>
        `).join('');
        
        // Re-initialize seamless scroll duplication after DOM update
        setupInfiniteScroll();

        // Standard text replacements
        const mappings = {
            'localizedFeature': 'headline',
            'localizedFeatureText': 'text',
            'proposeFeature': null,
            'proposeFeatureText': null,
            'privacyNote': null,
            'privacyNoteText': null,
            'funMessage': null,
            'aboutCreator': null,
            'creatorText': null,
            'changelog': null,
            'whyHelper': null,
            'getStarted': null,
            'getStartedText': null,
            'feedbackSupport': null,
            'feedbackSupportText': null
        };

        for (const [id, nestedProp] of Object.entries(mappings)) {
            const el = document.getElementById(id);
            if (!el) continue;
            
            const content = nestedProp ? appData[id][nestedProp] : appData[id];
            el[id.includes('Text') ? 'innerHTML' : 'textContent'] = id.includes('Text') ? convertMarkdownLinks(content) : content;
        }

        document.getElementById('changelogList').innerHTML = appData.changelogList.map(item => `<li>${convertMarkdownLinks(item)}</li>`).join('');
        document.getElementById('whyHelperList').innerHTML = appData.whyHelperList.map(item => `<li>${convertMarkdownLinks(item)}</li>`).join('');

    } catch (error) {
        console.error('Error loading content:', error);
    }
}

// Build Language Menu
async function createLanguageButtons() {
    try {
        const response = await fetch('translations.json');
        const translations = await response.json();
        const languageMenu = document.getElementById('languageMenu');

        languageMenu.innerHTML = ''; // Clear previous

        // Always add English first
        const englishButton = document.createElement('button');
        englishButton.textContent = '🇬🇧 English';
        englishButton.onclick = () => {
            changeLanguage('en');
            document.getElementById('languageMenuButton').textContent = '🇬🇧 English';
            languageMenu.classList.remove('show');
        };
        languageMenu.appendChild(englishButton);

        // Add the rest of the languages
        translations.languages.forEach(lang => {
            if (lang.code === 'en') return; // Skip English as we just added it

            const button = document.createElement('button');
            button.textContent = `${lang.emoji} ${lang.name}`;
            button.onclick = () => {
                changeLanguage(lang.code);
                document.getElementById('languageMenuButton').textContent = `${lang.emoji} ${lang.name}`;
                languageMenu.classList.remove('show');
            };
            languageMenu.appendChild(button);
        });
    } catch (error) {
        console.error('Error creating language buttons:', error);
    }
}

function changeLanguage(lang) {
    loadContent(lang);
    const url = new URL(window.location);
    url.searchParams.set('lang', lang);
    window.history.pushState({}, '', url);
}

// Load Blogs
async function loadBlogPosts() {
    try {
        const response = await fetch('blog/blogPosts.json');
        const posts = await response.json();
        const container = document.querySelector('.blog-posts');

        container.innerHTML = posts.map(post => `
            <article class="blog-post">
                <h3>${post.title}</h3>
                <p><strong>Date:</strong> ${post.date}</p>
                <p>${post.description} <a href="blog/${post.link}">Read more</a></p>
            </article>
        `).join('');
    } catch (error) {
        console.error('Error loading blog posts:', error);
    }
}

// Robust, Smooth Infinite Auto-Scroll using RequestAnimationFrame
let scrollAnimationId;
function setupInfiniteScroll() {
    const container = document.getElementById('featureList');
    if (!container) return;

    // Reset container for language changes
    cancelAnimationFrame(scrollAnimationId);
    
    // Duplicate content once to create a seamless looping track
    const originalContent = container.innerHTML;
    container.innerHTML = originalContent + originalContent;

    let isHovered = false;

    // Pause on Interaction
    container.onmouseenter = () => isHovered = true;
    container.onmouseleave = () => isHovered = false;
    container.ontouchstart = () => isHovered = true;
    container.ontouchend = () => isHovered = false;

    function smoothScroll() {
        if (!isHovered) {
            container.scrollLeft += 1; // Speed factor
            
            // Loop back seamlessly when halfway (the end of the original set)
            if (container.scrollLeft >= (container.scrollWidth / 2)) {
                container.scrollLeft = 0;
            }
        }
        scrollAnimationId = requestAnimationFrame(smoothScroll);
    }
    
    scrollAnimationId = requestAnimationFrame(smoothScroll);
}

// Initialization
document.addEventListener("DOMContentLoaded", () => {
    const urlParams = new URLSearchParams(window.location.search);
    let lang = urlParams.get('lang') || (navigator.language || navigator.languages[0]).split('-')[0];

    loadContent(lang);
    createLanguageButtons();
    loadBlogPosts();

    // Init language button label
    fetch('translations.json')
        .then(res => res.json())
        .then(data => {
            const currentLang = data.languages.find(l => l.code === lang);
            if (currentLang) {
                document.getElementById('languageMenuButton').textContent = `${currentLang.emoji} ${currentLang.name}`;
            }
        }).catch(err => console.error(err));

    // UI Toggles
    const languageMenuButton = document.getElementById('languageMenuButton');
    const languageMenu = document.getElementById('languageMenu');
    
    languageMenuButton.addEventListener('click', (e) => {
        e.stopPropagation();
        languageMenu.classList.toggle('show');
    });

    const extensionButton = document.getElementById('extensionButton');
    const extensionUI = document.getElementById('extensionUI');
    
    extensionButton.addEventListener('click', (e) => {
        e.stopPropagation();
        extensionUI.classList.toggle('hidden');
    });

    extensionUI.addEventListener('click', () => {
        if (appData && appData.aisummary) {
            const summarySection = document.createElement('section');
            summarySection.classList.add('padding-h-m');
            summarySection.innerHTML = appData.aisummary;
            
            const featuresSection = document.getElementById('features-section');
            featuresSection.parentNode.insertBefore(summarySection, featuresSection);
            extensionUI.classList.add('hidden');
        }
    });

    // Close popups when clicking outside
    document.addEventListener('click', (e) => {
        if (!languageMenu.contains(e.target) && e.target !== languageMenuButton) {
            languageMenu.classList.remove('show');
        }
        if (!extensionUI.contains(e.target) && e.target !== extensionButton) {
            extensionUI.classList.add('hidden');
        }
    });
});
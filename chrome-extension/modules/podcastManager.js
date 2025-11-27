import { handlePlayPodcast } from "./audioManager.js";
import { generateAudioFromText } from "../api.js";
// podcastManager.js
// MULTI-STEP WIZARD VERSION

let currentStep = 1; // 1 = name, 2 = articles, 3 = length, 4 = generate
let podcastWizardState = {
    name: '',
    selectedArticles: [],
    length: '2'
};

function renderPodcastUI(targetContainer) {
    if (!targetContainer) return;

    // Remove old UI
    targetContainer.innerHTML = "";

    // Outer container
    const container = document.createElement("div");
    container.id = "podcastContainer";
    container.className = "podcast-ui flex column gap-2";
    targetContainer.appendChild(container);

    // Step container for swapping views
    const stepContainer = document.createElement("div");
    stepContainer.id = "podcastStepContainer";
    container.appendChild(stepContainer);

    // Navigation buttons
    const nav = document.createElement("div");
    nav.className = "flex row gap-2 mt-2";
    nav.innerHTML = `
        <button id="prevStepBtn" class="button-secondary">◀ Back</button>
        <button id="nextStepBtn" class="button-primary">Next ▶</button>
    `;
    container.appendChild(nav);

    // Final section for created podcasts
    const createdHeader = document.createElement("h3");
    createdHeader.textContent = "Created Podcasts";
    container.appendChild(createdHeader);

    const podcastList = document.createElement("div");
    podcastList.id = "podcastList";
    podcastList.className = "podcast-list";
    container.appendChild(podcastList);

    renderCreatedPodcasts(podcastList);

    // Initial render
    renderStep(stepContainer);

    // Button handlers
    document.getElementById("prevStepBtn").onclick = () => {
        currentStep = Math.max(1, currentStep - 1);
        renderStep(stepContainer);
    };

    document.getElementById("nextStepBtn").onclick = () => {
        if (currentStep < 4) {
            currentStep++;
            renderStep(stepContainer);
        }
    };
}

// ------------------------------
// STEP RENDERER
// ------------------------------
function renderStep(container) {
    container.innerHTML = "";

    switch (currentStep) {
        case 1:
            renderStep1(container);
            break;
        case 2:
            renderStep2(container);
            break;
        case 3:
            renderStep3(container);
            break;
        case 4:
            renderStep4(container);
            break;
    }

    // Update navigation buttons
    const prevBtn = document.getElementById("prevStepBtn");
    const nextBtn = document.getElementById("nextStepBtn");

    prevBtn.style.display = currentStep === 1 ? "none" : "block";
    nextBtn.textContent = currentStep === 4 ? "Generate 🎙️" : "Next ▶";

    // Require at least one article selected before allowing to proceed from step 2
    if (currentStep === 2) {
        // Check selection and update button state
        const updateNextBtnState = () => {
            nextBtn.disabled = podcastWizardState.selectedArticles.length === 0;
        };
        updateNextBtnState();
        // Listen for changes in selection
        const selectionList = document.getElementById("articleSelectionList");
        if (selectionList) {
            selectionList.addEventListener("change", updateNextBtnState);
        }
        nextBtn.onclick = () => {
            if (podcastWizardState.selectedArticles.length > 0) {
                currentStep++;
                renderStep(container);
            }
        };
    } else if (currentStep === 4) {
        nextBtn.onclick = generatePodcast;
    } else {
        nextBtn.onclick = () => {
            currentStep++;
            renderStep(container);
        };
    }
}

// ------------------------------
// STEP 1 — Name
// ------------------------------
function renderStep1(container) {
    const label = document.createElement("label");
    label.textContent = "Pick a name for your show:";

    const input = document.createElement("input");
    input.id = "podcastNameInput";
    input.placeholder = "Podcast Name";

    chrome.storage.local.get(["lastPodcastName"], data => {
        if (data.lastPodcastName) input.value = data.lastPodcastName;
        podcastWizardState.name = input.value;
    });

    input.addEventListener("input", () => {
        chrome.storage.local.set({ lastPodcastName: input.value });
        podcastWizardState.name = input.value;
    });

    container.append(label, input);
}

// ------------------------------
// STEP 2 — Article Picker
// ------------------------------
function renderStep2(container) {
    const label = document.createElement("label");
    label.textContent = "Select articles for your podcast:";
    container.appendChild(label);

    // Horizontal scrolling container for cards
    const scrollContainer = document.createElement("div");
    scrollContainer.className = "article-scroll-container";
    scrollContainer.style.display = "flex";
    scrollContainer.style.overflowX = "auto";
    scrollContainer.style.gap = "1rem";
    scrollContainer.style.padding = "0.5rem 0";
    scrollContainer.id = "articleSelectionList";
    container.appendChild(scrollContainer);

    let visibleCount = 5;

    function renderCards(articles, startIdx = 0) {
        scrollContainer.innerHTML = "";
        const endIdx = Math.min(startIdx + visibleCount, articles.length);
        // Preselect the 3 most recent articles (indices 0, 1, 2 in reversed array)
        const defaultSelected = (startIdx === 0)
            ? [0, 1, 2].filter(i => i < endIdx)
            : [];

        // If no selection, set to defaultSelected
        if (podcastWizardState.selectedArticles.length === 0 && defaultSelected.length > 0) {
            podcastWizardState.selectedArticles = [...defaultSelected];
        }

        for (let idx = startIdx; idx < endIdx; idx++) {
            const article = articles[idx];
            const card = document.createElement("div");
            card.className = "article-card";
            card.style.minWidth = "220px";
            card.style.border = "1px solid #ccc";
            card.style.borderRadius = "8px";
            card.style.padding = "1rem";
            card.style.background = "#fff";
            card.style.display = "flex";
            card.style.flexDirection = "column";
            card.style.alignItems = "flex-start";

            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.value = idx;
            cb.checked = podcastWizardState.selectedArticles.includes(idx);
            cb.style.marginBottom = "0.5rem";

            // Limit selection to 5 articles
            cb.addEventListener("change", () => {
                const checkedBoxes = scrollContainer.querySelectorAll("input[type='checkbox']:checked");
                if (checkedBoxes.length > 5) {
                    cb.checked = false;
                    alert("You can select up to 5 articles only.");
                } else {
                    if (cb.checked) {
                        if (!podcastWizardState.selectedArticles.includes(idx)) {
                            podcastWizardState.selectedArticles.push(idx);
                        }
                    } else {
                        podcastWizardState.selectedArticles = podcastWizardState.selectedArticles.filter(i => i !== idx);
                    }
                }
                // After any change, update Next button state
                const nextBtn = document.getElementById("nextStepBtn");
                if (nextBtn) nextBtn.disabled = podcastWizardState.selectedArticles.length === 0;
            });

            const title = document.createElement("div");
            title.textContent = article.title || `Article ${idx + 1}`;
            title.style.fontWeight = "bold";
            title.style.marginBottom = "0.5rem";

            // Optionally show summary or timestamp
            if (article.summary) {
                const summary = document.createElement("div");
                summary.textContent = article.summary.replace(/<[^>]+>/g, "").slice(0, 80) + "...";
                summary.style.fontSize = "0.9em";
                summary.style.marginBottom = "0.5rem";
                card.appendChild(summary);
            }
            if (article.timestamp) {
                const date = document.createElement("div");
                date.textContent = new Date(article.timestamp).toLocaleDateString();
                date.style.fontSize = "0.8em";
                date.style.color = "#888";
                card.appendChild(date);
            }

            card.appendChild(cb);
            card.appendChild(title);

            scrollContainer.appendChild(card);
        }

        // If there are more articles to show, add a Load More button as the last card
        if (endIdx < articles.length) {
            const loadMoreCard = document.createElement("div");
            loadMoreCard.className = "article-card load-more-card";
            loadMoreCard.style.minWidth = "120px";
            loadMoreCard.style.display = "flex";
            loadMoreCard.style.alignItems = "center";
            loadMoreCard.style.justifyContent = "center";
            loadMoreCard.style.border = "1px dashed #aaa";
            loadMoreCard.style.borderRadius = "8px";
            loadMoreCard.style.background = "#f9f9f9";

            const btn = document.createElement("button");
            btn.textContent = "Load More";
            btn.className = "button-secondary";
            btn.onclick = () => {
                visibleCount += 5;
                renderCards(articles, 0);
            };
            loadMoreCard.appendChild(btn);
            scrollContainer.appendChild(loadMoreCard);
        }
        // After rendering, update Next button state
        const nextBtn = document.getElementById("nextStepBtn");
        if (nextBtn) nextBtn.disabled = podcastWizardState.selectedArticles.length === 0;
    }

    chrome.storage.local.get(["articles"], data => {
        let articles = Object.values(data.articles || {});
        articles = articles.map((a, idx) => ({
            ...a,
            timestamp: typeof a.timestamp === "string" ? Date.parse(a.timestamp) : (typeof a.timestamp === "number" ? a.timestamp : 0)
        }));
        articles.sort((a, b) => b.timestamp - a.timestamp);

        const MAX_SELECTION = 5;

        articles.forEach((article, idx) => {
            const id = typeof article.timestamp === "string" ? article.timestamp : new Date(article.timestamp).toISOString();
            const isSelected = podcastWizardState.selectedArticles.includes(id);

            const card = document.createElement("div");
            card.className = "article-card";
            card.style.minWidth = "220px";
            card.style.border = isSelected ? "2px solid #0084ff" : "1px solid #ccc";
            card.style.borderRadius = "8px";
            card.style.padding = "1rem";
            card.style.background = isSelected ? "#e8f3ff" : "#fff";
            card.style.display = "flex";
            card.style.flexDirection = "column";
            card.style.alignItems = "flex-start";
            card.style.cursor = "pointer";
            card.style.transition = "border-color 0.2s, background 0.2s";

            // Checkbox (optional, hidden)
            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.value = id;
            cb.checked = isSelected;
            cb.style.display = "none";

            // Card click toggles selection
            card.addEventListener("click", (e) => {
                if (!isSelected && podcastWizardState.selectedArticles.length >= MAX_SELECTION) {
                    card.classList.add("shake");
                    setTimeout(() => card.classList.remove("shake"), 400);
                    return;
                }
                if (!isSelected) {
                    podcastWizardState.selectedArticles.push(id);
                } else {
                    podcastWizardState.selectedArticles = podcastWizardState.selectedArticles.filter(x => x !== id);
                }
                // Update UI
                cb.checked = !isSelected;
                card.style.border = cb.checked ? "2px solid #0084ff" : "1px solid #ccc";
                card.style.background = cb.checked ? "#e8f3ff" : "#fff";
                const nextBtn = document.getElementById("nextStepBtn");
                if (nextBtn) nextBtn.disabled = podcastWizardState.selectedArticles.length === 0;
            });

            // Title
            const title = document.createElement("div");
            title.textContent = article.title || "Untitled";
            title.style.fontWeight = "bold";
            title.style.marginBottom = "0.5rem";

            // Summary (truncated, plain text)
            if (article.summary) {
                const summary = document.createElement("div");
                summary.textContent = article.summary.replace(/<[^>]+>/g, "").slice(0, 100) + "…";
                summary.style.fontSize = "0.9em";
                summary.style.marginBottom = "0.5rem";
                card.appendChild(summary);
            }

            // Date
            if (article.timestamp) {
                const date = document.createElement("div");
                date.textContent = new Date(article.timestamp).toLocaleDateString();
                date.style.fontSize = "0.8em";
                date.style.color = "#888";
                card.appendChild(date);
            }

            card.appendChild(cb);
            card.appendChild(title);

            scrollContainer.appendChild(card);
        });

        const nextBtn = document.getElementById("nextStepBtn");
        if (nextBtn) nextBtn.disabled = podcastWizardState.selectedArticles.length === 0;
    });
}

// ------------------------------
// STEP 3 — Length Slider
// ------------------------------
function renderStep3(container) {
    const label = document.createElement("label");
    label.textContent = "Podcast length (minutes):";

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "1";
    slider.max = "3";
    slider.value = "2";

    const value = document.createElement("span");
    value.id = "podcastLengthValue";
    value.textContent = slider.value;

    slider.oninput = () => {
        value.textContent = slider.value;
        podcastWizardState.length = slider.value;
    };
    // Set initial value in state
    podcastWizardState.length = slider.value;

    container.append(label, slider, value);
}

// ------------------------------
// STEP 4 — Final Confirmation + Generate
// ------------------------------
function renderStep4(container) {
    // Use wizard state for confirmation values
    const podcastName = podcastWizardState.name || "(not set)";
    const podcastLength = podcastWizardState.length || "(not set)";
    chrome.storage.local.get(["articles"], data => {
        const original = data.articles || [];
        const titles = podcastWizardState.selectedArticles
            .map(id => {
                const found = original.find(a => a.timestamp === id);
                return found?.title;
            })
            .filter(Boolean);
        container.innerHTML = `
            <p>You're ready to generate your podcast! 🎙️</p>
            <p><strong>Name:</strong> ${podcastWizardState.name}</p>
            <p><strong>Selected articles:</strong> ${titles.join(", ")}</p>
            <p><strong>Length:</strong> ${podcastWizardState.length} min</p>
            <p>Click “Generate 🎙️” to create your episode.</p>
        `;
    });
}

// ------------------------------
// GENERATION LOGIC
// ------------------------------
function generatePodcast() {
    // Use wizard state for all values
    const selected = podcastWizardState.selectedArticles;
    const podcastName = podcastWizardState.name || "Untitled Podcast";
    const length = podcastWizardState.length || "2";

    // Always get nextBtn reference at the start
    const nextBtn = document.getElementById("nextStepBtn");

    // Get articles and generate podcast script using createChatCompletion
    chrome.storage.local.get(["articles", "podcasts"], async articleData => {
        // Defensive: ensure articles exist and selected indices are valid
        const allArticles = Array.isArray(articleData.articles) ? articleData.articles : [];
        const selectedArticleObjects = selected
            .map(id => allArticles.find(a => a.timestamp === id))
            .filter(Boolean);

        // Truncate each article summary to fit within 2000 chars total
        let totalLimit = 2000;
        let used = 0;
        const formattedArticles = selectedArticleObjects.map(a => {
            let cleanSummary = a.summary ? a.summary.replace(/<[^>]+>/g, "") : "";
            let maxLen = Math.min(cleanSummary.length, totalLimit - used - (selectedArticleObjects.length - 1));
            if (maxLen < 0) maxLen = 0;
            let truncatedSummary = cleanSummary.slice(0, maxLen);
            used += truncatedSummary.length + 1; // +1 for separator
            return `Title: ${a.title || "Untitled"}\nDomain: ${a.domain || ""}\nSummary: ${truncatedSummary}`;
        });
        const inputText = formattedArticles.join("\n\n");

        // Get service config and selected language
        chrome.storage.sync.get(["servicesConfig", "activeService", "selectedLanguage"], async sdata => {
            const activeService = sdata.activeService || "openai";
            const servicesConfig = sdata.servicesConfig || {};
            const selectedLanguage = sdata.selectedLanguage || "en-US";
            const serviceCfg = servicesConfig[activeService] || {};
            const apiKey = serviceCfg.apiKey || "";
            // Prefer customModel if set, else default model
            const modelIdentifier = serviceCfg.customModel || serviceCfg.model || "";

            // Import createChatCompletion dynamically
            const { createChatCompletion } = await import("../api.js");
            if (nextBtn) {
                nextBtn.disabled = true;
                nextBtn.textContent = "Generating...";
            }
            try {
                const script = await createChatCompletion(
                    inputText,
                    apiKey,
                    selectedLanguage,
                    podcastName,
                    activeService,
                    modelIdentifier
                );
                // 🔊 Generate audio from script
                let audioBase64 = null;
                try {
                    const audioBlob = await generateAudioFromText(
                        script,
                        apiKey,
                        typeof activeService === "string" && activeService.length > 0 ? activeService : "openai"
                    );
                    audioBase64 = await blobToBase64(audioBlob);
                } catch (e) {
                    console.warn("TTS failed, saving without audio:", e);
                }

                const podcast = {
                    name: podcastName,
                    articles: selectedArticleObjects,
                    length,
                    script,
                    created: Date.now(),
                    service: typeof activeService === "string" && activeService.length > 0 ? activeService : "openai",
                    model: modelIdentifier,
                    audio: audioBase64 || null
                };
                const podcasts = Array.isArray(articleData.podcasts) ? articleData.podcasts : [];
                podcasts.unshift(podcast);
                chrome.storage.local.set({ podcasts }, () => {
                    renderCreatedPodcasts(document.getElementById("podcastList"));
                    if (nextBtn) {
                        nextBtn.disabled = false;
                        nextBtn.textContent = "Generate 🎙️";
                    }
                });
            } catch (err) {
                if (nextBtn) {
                    nextBtn.disabled = false;
                    nextBtn.textContent = "Generate 🎙️";
                }
                alert("Error generating podcast: " + (err?.message || err));
            }
        });
    });
}

// ------------------------------
// RENDER SAVED PODCASTS
// ------------------------------
function renderCreatedPodcasts(listContainer) {
    listContainer.innerHTML = "";

    chrome.storage.local.get({ podcasts: [] }, data => {
        data.podcasts.forEach((podcast, index) => {
            const card = document.createElement("div");
            card.className = "podcast-card";

            const title = podcast.name || podcast.title || "Untitled Podcast";
            let audioHtml = "";
            if (podcast.audio) {
                audioHtml = `<audio controls src="${podcast.audio}"></audio>`;
            } else {
                audioHtml = "<em>No audio yet</em>";
            }
            card.innerHTML = `
                <div class="podcast-card-content">
                    <h3>${title}</h3>
                    ${audioHtml}
                    <button class="delete-podcast-button">Delete</button>
                </div>
            `;

            listContainer.appendChild(card);

            card
                .querySelector(".delete-podcast-button")
                .addEventListener("click", () => {
                    data.podcasts.splice(index, 1);
                    chrome.storage.local.set({ podcasts: data.podcasts }, () => {
                        renderCreatedPodcasts(listContainer);
                    });
                });
        });
    });
}

function blobToBase64(blob) {
    return new Promise(resolve => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
    });
}

export { renderPodcastUI };

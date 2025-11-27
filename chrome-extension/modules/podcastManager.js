/******************************************************************
 * PODCAST MANAGER — CLEAN, REFACTORED, BUG-FREE VERSION
 * Your Podcast Wizard with perfect selection handling
 ******************************************************************/

import { generateAudioFromText } from "../api.js";

// ─────────────────────────────────────────────
// GLOBAL STATE
// ─────────────────────────────────────────────

let currentStep = 1; // 1 = name, 2 = articles, 3 = length, 4 = generate

let podcastWizardState = {
    name: "",
    selectedArticles: new Set(), // ⚡ Use Set to avoid duplicates
    length: "2",
    allArticles: []
};


// ─────────────────────────────────────────────
// ENTRYPOINT
// ─────────────────────────────────────────────

export function renderPodcastUI(targetContainer) {
    if (!targetContainer) return;

    targetContainer.innerHTML = "";

    const container = document.createElement("div");
    container.id = "podcastContainer";
    container.className = "podcast-ui flex column gap-2";
    targetContainer.appendChild(container);

    const stepContainer = document.createElement("div");
    stepContainer.id = "podcastStepContainer";
    container.appendChild(stepContainer);

    const nav = document.createElement("div");
    nav.className = "flex row gap-2 mt-2";
    nav.innerHTML = `
        <button id="prevStepBtn" class="button-secondary">◀ Back</button>
        <button id="nextStepBtn" class="button-primary">Next ▶</button>
    `;
    container.appendChild(nav);

    const createdHeader = document.createElement("h3");
    createdHeader.textContent = "Created Podcasts";
    container.appendChild(createdHeader);

    const podcastList = document.createElement("div");
    podcastList.id = "podcastList";
    podcastList.className = "podcast-list";
    container.appendChild(podcastList);

    renderCreatedPodcasts(podcastList);

    loadArticles().then(() => {
        renderStep(stepContainer);
    });

    document.getElementById("prevStepBtn").onclick = () => {
        currentStep = Math.max(1, currentStep - 1);
        renderStep(stepContainer);
    };

    document.getElementById("nextStepBtn").onclick = goNextStep;
}


// ─────────────────────────────────────────────
// STEP LOADER
// ─────────────────────────────────────────────

function renderStep(container) {
    container.innerHTML = "";

    switch (currentStep) {
        case 1: renderStep1(container); break;
        case 2: renderStep2(container); break;
        case 3: renderStep3(container); break;
        case 4: renderStep4(container); break;
    }

    const prevBtn = document.getElementById("prevStepBtn");
    const nextBtn = document.getElementById("nextStepBtn");

    prevBtn.style.display = currentStep === 1 ? "none" : "block";
    nextBtn.textContent = currentStep === 4 ? "Generate 🎙️" : "Next ▶";

    if (currentStep === 2) {
        nextBtn.disabled = podcastWizardState.selectedArticles.size === 0;
    }
}


// Handle Next Step
function goNextStep() {
    if (currentStep === 2 && podcastWizardState.selectedArticles.size === 0) return;
    if (currentStep === 4) return generatePodcast();
    currentStep++;
    renderStep(document.getElementById("podcastStepContainer"));
}


// ─────────────────────────────────────────────
// STEP 1 — NAME
// ─────────────────────────────────────────────

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


// ─────────────────────────────────────────────
// STEP 2 — CLEAN ARTICLE PICKER
// ─────────────────────────────────────────────

function renderStep2(container) {
    const label = document.createElement("label");
    label.textContent = "Select up to 5 articles:";
    container.appendChild(label);

    const list = document.createElement("div");
    list.style.display = "flex";
    list.style.overflowX = "auto";
    list.style.gap = "1rem";
    list.style.padding = "0.5rem 0";
    container.appendChild(list);

    podcastWizardState.allArticles.forEach(article => {
        const id = article._id; // stable ID
        const isSelected = podcastWizardState.selectedArticles.has(id);

        const card = document.createElement("div");
        card.className = "article-card";
        card.style.minWidth = "220px";
        card.style.cursor = "pointer";
        card.style.border = isSelected ? "2px solid #0084ff" : "1px solid #ccc";
        card.style.borderRadius = "8px";
        card.style.padding = "1rem";
        card.style.background = isSelected ? "#e8f3ff" : "#fff";

        card.onclick = () => toggleArticle(id, card);

        const title = document.createElement("div");
        title.textContent = article.title || "Untitled";
        title.style.fontWeight = "bold";
        title.style.marginBottom = "0.5rem";

        const summary = document.createElement("div");
        if (article.summary) {
            summary.textContent = article.summary.replace(/<[^>]+>/g, "").slice(0, 100) + "…";
            summary.style.fontSize = "0.9em";
            summary.style.marginBottom = "0.5rem";
        }

        const date = document.createElement("div");
        date.textContent = new Date(article.timestamp).toLocaleDateString();
        date.style.fontSize = "0.8em";
        date.style.color = "#888";

        card.appendChild(title);
        if (article.summary) card.appendChild(summary);
        card.appendChild(date);

        list.appendChild(card);
    });

    updateNextButtonState();
}


// Toggle selection safely
function toggleArticle(id, card) {
    const MAX = 5;

    if (podcastWizardState.selectedArticles.has(id)) {
        podcastWizardState.selectedArticles.delete(id);
    } else {
        if (podcastWizardState.selectedArticles.size >= MAX) {
            card.classList.add("shake");
            setTimeout(() => card.classList.remove("shake"), 300);
            return;
        }
        podcastWizardState.selectedArticles.add(id);
    }

    // Update card UI
    const selected = podcastWizardState.selectedArticles.has(id);
    card.style.border = selected ? "2px solid #0084ff" : "1px solid #ccc";
    card.style.background = selected ? "#e8f3ff" : "#fff";

    updateNextButtonState();
}


function updateNextButtonState() {
    const nextBtn = document.getElementById("nextStepBtn");
    if (nextBtn) nextBtn.disabled = podcastWizardState.selectedArticles.size === 0;
}


// ─────────────────────────────────────────────
// STEP 3 — LENGTH
// ─────────────────────────────────────────────

function renderStep3(container) {
    const label = document.createElement("label");
    label.textContent = "Podcast length (minutes):";

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0.5";
    slider.max = "3";
    slider.step = "0.5";
    slider.value = podcastWizardState.length;

    // Create a wrapper for slider and label
    const sliderWrapper = document.createElement("div");
    sliderWrapper.style.position = "relative";
    sliderWrapper.style.width = "100%";
    sliderWrapper.appendChild(slider);

    const value = document.createElement("span");
    value.textContent = slider.value + " min";
    value.style.position = "absolute";
    value.style.top = "48px";
    value.style.left = "0";
    value.style.transform = "translateX(-12px)";
    value.style.whiteSpace = "nowrap";

    // Function to update label position under slider thumb
    function updateValuePosition() {
        const min = parseFloat(slider.min);
        const max = parseFloat(slider.max);
        const val = parseFloat(slider.value);
        // Calculate percent position
        const percent = (val - min) / (max - min);
        // Get slider width
        const sliderWidth = slider.offsetWidth || 200;
        // Thumb offset (approximate)
        const thumbWidth = 16;
        const offset = percent * (sliderWidth - thumbWidth) + thumbWidth / 2;
        value.style.left = `${offset}px`;
        value.textContent = slider.value + " min";
    }

    slider.oninput = () => {
        podcastWizardState.length = slider.value;
        updateValuePosition();
        // Save length in local storage
        import('./storageManager.js').then(({ default: StorageManager }) => {
            StorageManager.setLocal({ podcastLength: slider.value });
        });
    };

    slider.addEventListener('input', updateValuePosition);
    slider.addEventListener('change', updateValuePosition);
    window.addEventListener('resize', updateValuePosition);

    // Load saved length from local storage
    import('./storageManager.js').then(({ default: StorageManager }) => {
        StorageManager.getLocal({ podcastLength: "2" }).then(data => {
            if (data.podcastLength) {
                slider.value = data.podcastLength;
                podcastWizardState.length = slider.value;
                updateValuePosition();
            } else {
                updateValuePosition();
            }
        });
    });

    sliderWrapper.appendChild(value);
    container.appendChild(label);
    container.appendChild(sliderWrapper);

    // Podcast style chips
    const styleLabel = document.createElement("label");
    styleLabel.textContent = "Podcast style:";
    styleLabel.style.marginTop = "1em";
    container.appendChild(styleLabel);

    const styles = [
        "Interview",
        "News",
        "Comedy",
        "Storytelling",
        "Educational",
        "Panel",
        "Solo"
    ];
    const chipsContainer = document.createElement("div");
    chipsContainer.className = "podcast-style-chips";
    chipsContainer.style.display = "flex";
    chipsContainer.style.gap = "0.5em";
    chipsContainer.style.flexWrap = "wrap";

    // Load saved style from local storage
    import('./storageManager.js').then(({ default: StorageManager }) => {
        StorageManager.getLocal({ podcastStyle: "" }).then(data => {
            if (data.podcastStyle) {
                podcastWizardState.style = data.podcastStyle;
            }
            Array.from(chipsContainer.children).forEach(c => {
                if (c.textContent === podcastWizardState.style) {
                    c.style.background = "#cce6ff";
                }
            });
        });
    });

    styles.forEach(style => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "chip";
        chip.textContent = style;
        chip.style.padding = "0.3em 0.8em";
        chip.style.borderRadius = "16px";
        chip.style.border = "1px solid #0084ff";
        chip.style.background = "#f4f8ff";
        chip.style.cursor = "pointer";
        chip.onclick = () => {
            podcastWizardState.style = style;
            Array.from(chipsContainer.children).forEach(c => c.style.background = "#f4f8ff");
            chip.style.background = "#cce6ff";
            // Save style in local storage
            import('./storageManager.js').then(({ default: StorageManager }) => {
                StorageManager.setLocal({ podcastStyle: style });
            });
        };
        chipsContainer.appendChild(chip);
    });
    container.appendChild(chipsContainer);

    // Custom style input
    const customStyleLabel = document.createElement("label");
    customStyleLabel.textContent = "Custom style (optional):";
    customStyleLabel.style.marginTop = "1em";
    container.appendChild(customStyleLabel);

    const customStyleInput = document.createElement("input");
    customStyleInput.type = "text";
    customStyleInput.placeholder = "Describe your podcast style";
    customStyleInput.style.marginBottom = "0.5em";
    // Load saved custom style from local storage
    import('./storageManager.js').then(({ default: StorageManager }) => {
        StorageManager.getLocal({ podcastCustomStyle: "" }).then(data => {
            if (data.podcastCustomStyle) {
                customStyleInput.value = data.podcastCustomStyle;
                podcastWizardState.customStyle = data.podcastCustomStyle;
            }
        });
    });

    customStyleInput.value = podcastWizardState.customStyle || "";
    customStyleInput.oninput = () => {
        podcastWizardState.customStyle = customStyleInput.value;
        // Save custom style in local storage
        import('./storageManager.js').then(({ default: StorageManager }) => {
            StorageManager.setLocal({ podcastCustomStyle: customStyleInput.value });
        });
    };
    container.appendChild(customStyleInput);
}


// ─────────────────────────────────────────────
// STEP 4 — CONFIRM
// ─────────────────────────────────────────────

function renderStep4(container) {
    const selected = [...podcastWizardState.selectedArticles];
    const titles = podcastWizardState.allArticles
        .filter(a => selected.includes(a._id))
        .map(a => a.title);

    const style = podcastWizardState.style || "";
    const customStyle = podcastWizardState.customStyle || "";

    container.innerHTML = `
        <p>You're ready to generate your podcast! 🎙️</p>
        <p><strong>Name:</strong> ${podcastWizardState.name}</p>
        <p><strong>Articles:</strong> ${titles.join(", ")}</p>
        <p><strong>Length:</strong> ${podcastWizardState.length} min</p>
        <p><strong>Style:</strong> ${style ? style : "-"}</p>
        <p><strong>Custom style:</strong> ${customStyle ? customStyle : "-"}</p>
        <p>Click “Generate 🎙️” to create your episode.</p>
    `;
}


// ─────────────────────────────────────────────
// LOAD ARTICLES
// ─────────────────────────────────────────────

function loadArticles() {
    return new Promise(resolve => {
        chrome.storage.local.get(["articles"], data => {
            let articles = Object.values(data.articles || {});

            articles = articles.map(a => ({
                ...a,
                timestamp: a.timestamp ? Date.parse(a.timestamp) : 0,
                _id: a.timestamp ? String(a.timestamp) : crypto.randomUUID()
            }));

            articles.sort((a, b) => b.timestamp - a.timestamp);

            podcastWizardState.allArticles = articles;
            resolve();
        });
    });
}


// ─────────────────────────────────────────────
// GENERATION LOGIC
// ─────────────────────────────────────────────

async function generatePodcast() {
    const nextBtn = document.getElementById("nextStepBtn");

    const selectedArticles = podcastWizardState.allArticles.filter(a =>
        podcastWizardState.selectedArticles.has(a._id)
    );

    // Include style and custom style in the prompt
    const style = podcastWizardState.style || "";
    const customStyle = podcastWizardState.customStyle || "";
    let styleText = "";
    if (style || customStyle) {
        styleText = `Podcast Style: ${style ? style : "-"}`;
        if (customStyle) styleText += `\nCustom Style: ${customStyle}`;
    }

    const formattedText = [
        styleText,
        selectedArticles
            .map(a => `Title: ${a.title}\nDomain: ${a.domain || ""}\nSummary: ${a.summary}`)
            .join("\n\n")
    ].filter(Boolean).join("\n\n");

    chrome.storage.sync.get(["servicesConfig", "activeService", "selectedLanguage"], async sdata => {
        const activeService = sdata.activeService || "openai";
        const serviceCfg = sdata.servicesConfig?.[activeService] || {};
        const apiKey = serviceCfg.apiKey;
        const modelIdentifier = serviceCfg.customModel || serviceCfg.model || "";

        const { createChatCompletion } = await import("../api.js");

        nextBtn.disabled = true;
        nextBtn.textContent = "Generating…";

        try {
            const script = await createChatCompletion(
                formattedText,
                apiKey,
                sdata.selectedLanguage || "en-US",
                podcastWizardState.name,
                activeService,
                modelIdentifier
            );

            let audioBase64 = null;
            try {
                const blob = await generateAudioFromText(script, apiKey, activeService);
                audioBase64 = await blobToBase64(blob);
            } catch (e) {
                console.warn("TTS failed:", e);
            }

            savePodcast({
                name: podcastWizardState.name,
                articles: selectedArticles,
                length: podcastWizardState.length,
                script,
                created: Date.now(),
                service: activeService,
                model: modelIdentifier,
                audio: audioBase64
            });

            renderCreatedPodcasts(document.getElementById("podcastList"));

        } catch (err) {
            alert("Error generating podcast: " + err.message);
        }

        nextBtn.disabled = false;
        nextBtn.textContent = "Generate 🎙️";
    });
}


function savePodcast(podcast) {
    chrome.storage.local.get({ podcasts: [] }, data => {
        data.podcasts.unshift(podcast);
        chrome.storage.local.set({ podcasts: data.podcasts });
    });
}


// ─────────────────────────────────────────────
// RENDER SAVED PODCASTS
// ─────────────────────────────────────────────

function renderCreatedPodcasts(container) {
    container.innerHTML = "";

    chrome.storage.local.get({ podcasts: [] }, data => {
        data.podcasts.forEach((p, index) => {
            const card = document.createElement("div");
            card.className = "podcast-card";

            card.innerHTML = `
                <h3>${p.name}</h3>
                ${p.audio ? `<audio controls src="${p.audio}"></audio>` : "<em>No audio</em>"}
                <button class="delete-podcast-button">Delete</button>
            `;

            card.querySelector(".delete-podcast-button").onclick = () => {
                data.podcasts.splice(index, 1);
                chrome.storage.local.set({ podcasts: data.podcasts }, () => {
                    renderCreatedPodcasts(container);
                });
            };

            container.appendChild(card);
        });
    });
}


// ─────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────

function blobToBase64(blob) {
    return new Promise(resolve => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
    });
}

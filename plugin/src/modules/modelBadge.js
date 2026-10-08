// modelBadge.js — the little emoji in front of a model name: ☁️ cloud, 🦙 Ollama, 💻 any other own model/API.
/**
 * Ollama is recognised by service id when known, otherwise by its "name:tag" model ids (gemma4:e2b, llama3.2:3b).
 * Ids with a slash (OpenRouter style) or the "ft:" prefix (OpenAI fine-tunes) are not Ollama.
 */
export function modelEmoji({ connectionMode, service, modelId } = {}) {
    if (connectionMode === 'cloud') return '☁️';
    if (String(service || '').toLowerCase() === 'ollama') return '🦙';
    const id = String(modelId || '');
    if (!service && /^[\w.-]+:[\w.-]+$/.test(id) && !/^ft:/i.test(id)) return '🦙';
    return '💻';
}

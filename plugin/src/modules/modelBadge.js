// modelBadge.js — the little icon in front of a model name: cloud (AISH cloud), server (Ollama), laptop (any other own model/API).
import { icon } from './icons.js';

/**
 * Ollama is recognised by service id when known, otherwise by its "name:tag" model ids (gemma4:e2b, llama3.2:3b).
 * Ids with a slash (OpenRouter style) or the "ft:" prefix (OpenAI fine-tunes) are not Ollama.
 * @returns {'cloud'|'ollama'|'own'}
 */
export function modelKind({ connectionMode, service, modelId } = {}) {
    if (connectionMode === 'cloud') return 'cloud';
    if (String(service || '').toLowerCase() === 'ollama') return 'ollama';
    const id = String(modelId || '');
    if (!service && /^[\w.-]+:[\w.-]+$/.test(id) && !/^ft:/i.test(id)) return 'ollama';
    return 'own';
}

const ICON_NAME = { cloud: 'cloud', ollama: 'server', own: 'laptop' };
export function modelIconName(args) { return ICON_NAME[modelKind(args)]; }
/** SVG markup for the badge (use inside innerHTML templates). */
export function modelIcon(args) { return icon(modelIconName(args)); }

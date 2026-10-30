// mcp/src/pairing.js — the pairing token the extension and the relay share.
// Stored once per machine in the user's config dir; never logged, never sent anywhere but checked locally.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export function configDir() {
    if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'aish-mcp');
    return path.join(os.homedir(), '.config', 'aish-mcp');
}

function configPath() { return path.join(configDir(), 'config.json'); }

function readConfig() {
    try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch (_) { return {}; }
}

function writeConfig(cfg) {
    fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

function newToken() {
    return crypto.randomBytes(32).toString('base64url');
}

/** The current token, generating one on first run. Returns { token, created }. */
export function ensureToken() {
    const cfg = readConfig();
    if (cfg.token) return cfg;
    const next = { token: newToken(), created: new Date().toISOString() };
    writeConfig({ ...cfg, ...next });
    return next;
}

/** A fresh token, replacing any old one (`aish-mcp reset`). */
export function resetToken() {
    const cfg = readConfig();
    const next = { token: newToken(), created: new Date().toISOString() };
    writeConfig({ ...cfg, ...next });
    return next;
}

export function currentToken() {
    return readConfig().token || null;
}

/** Constant-time string compare (S4: a timing side-channel would leak the token one byte at a time). */
export function tokensMatch(a, b) {
    const bufA = Buffer.from(String(a || ''));
    const bufB = Buffer.from(String(b || ''));
    if (bufA.length !== bufB.length) {
        // still do a constant-time compare against itself so the early return above doesn't
        // leak length indirectly through timing on top of the obvious length check
        crypto.timingSafeEqual(bufA, bufA);
        return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
}

/** Simple per-process brute-force guard (S4): 5 wrong tokens in a rolling minute closes the connection. */
export function createRateGuard({ max = 5, windowMs = 60000 } = {}) {
    const hits = [];
    return {
        recordFailure() { const now = Date.now(); hits.push(now); while (hits.length && hits[0] < now - windowMs) hits.shift(); },
        tripped() { const now = Date.now(); while (hits.length && hits[0] < now - windowMs) hits.shift(); return hits.length >= max; },
    };
}

// ── Tool-definition cache (PRD §4.4: "tools are still listed … cached as definitions only") ──
// MCP apps ask for the tool list once, right at start, often before the browser has connected.
// The definitions (names, descriptions, input schemas) are kept here so that first answer is
// never empty. The brand guide rides along (it becomes the server's instructions on the next start).
// No library data, no arguments, no results are ever written.
function defsPath() { return path.join(configDir(), 'tool-definitions.json'); }

export function readDefsCache() {
    try {
        const d = JSON.parse(fs.readFileSync(defsPath(), 'utf8'));
        return d && Array.isArray(d.tools) ? { tools: d.tools, resources: d.resources || [], prompts: d.prompts || [], brand: d.brand || null } : null;
    } catch (_) { return null; }
}

export function writeDefsCache(defs) {
    try {
        fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 });
        const clean = { tools: defs.tools || [], resources: defs.resources || [], prompts: defs.prompts || [], brand: defs.brand || null };
        fs.writeFileSync(defsPath(), JSON.stringify(clean, null, 2), { mode: 0o600 });
    } catch (_) { /* cache only */ }
}

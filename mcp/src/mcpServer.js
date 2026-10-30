// mcp/src/mcpServer.js — wraps @modelcontextprotocol/sdk's low-level Server. Tools, resources and
// prompts are NOT hardcoded here: they come from whatever the extension declared in its last
// `hello` (relay.toolDefinitions() etc.), so this file stays generic (PRD §4.1: "the relay stays
// generic"). All it does is translate MCP requests into relay.call()s.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import http from 'node:http';
import { randomUUID } from 'node:crypto';

import { NOT_RUNNING } from './relayServer.js';

function toolResult(data) {
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}
function errorResult(message) {
    return { content: [{ type: 'text', text: message }], isError: true };
}

// Used until an extension has sent its own brand (the cached one is read on start, so this is only the very first run).
const FALLBACK_INSTRUCTIONS = 'When you create something visual or shareable from the user\'s AI Summary Helper library, read the aish://brand resource and style it in that brand, unless the user asks for a different style.';

export function createMcpServer(relay) {
    // `instructions` go out once, when the app connects: the brand cached from the extension's last hello (hub.js), so a
    // white-label build's own guide is in place even before the browser is running.
    const brand = relay.brand && relay.brand();
    const server = new Server({ name: 'aish-mcp', version: '0.1.0' }, { capabilities: { tools: { listChanged: true }, resources: { listChanged: true }, prompts: { listChanged: true } }, instructions: (brand && brand.instructions) || FALLBACK_INSTRUCTIONS });
    const brandGuide = () => { const b = relay.brand && relay.brand(); return b && b.guide; };

    server.setRequestHandler(ListToolsRequestSchema, async () => {
        const defs = relay.toolDefinitions();
        return { tools: defs.map((d) => ({ name: d.name, description: d.description, inputSchema: d.inputSchema || { type: 'object', properties: {} } })) };
    });

    server.setRequestHandler(CallToolRequestSchema, async (req) => {
        const { name, arguments: args } = req.params;
        if (name === 'get_brand' && brandGuide()) return toolResult({ guide: brandGuide() });   // from the cache, works while the browser is closed
        if (!relay.isExtensionConnected()) return errorResult(NOT_RUNNING);
        try {
            const data = await relay.call(name, args || {});
            return toolResult(data);
        } catch (e) {
            return errorResult(e && e.message ? e.message : 'Tool call failed');
        }
    });

    server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: relay.resourceDefinitions().map((r) => ({ uri: r.uri, name: r.uri, description: r.description })) }));
    server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
        const uri = req.params.uri;
        if (uri === 'aish://brand') {   // served from the cache: works while the browser is closed
            const guide = brandGuide();
            if (!guide) throw new Error(NOT_RUNNING);
            return { contents: [{ uri, mimeType: 'text/markdown', text: guide }] };
        }
        const m = /^aish:\/\/article\/(.+)$/.exec(uri);
        if (!m) throw new Error(`Unknown resource: ${uri}`);
        if (!relay.isExtensionConnected()) throw new Error(NOT_RUNNING);
        const md = await relay.call('get_article', { id: decodeURIComponent(m[1]) });
        return { contents: [{ uri, mimeType: 'text/markdown', text: typeof md === 'string' ? md : JSON.stringify(md, null, 2) }] };
    });

    server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: relay.promptDefinitions().map((p) => ({ name: p.name, description: p.description, arguments: (p.args || []).map((a) => ({ name: a, required: true })) })) }));
    server.setRequestHandler(GetPromptRequestSchema, async (req) => {
        const { name, arguments: args } = req.params;
        if (name === 'weekly_review') {
            return { messages: [{ role: 'user', content: { type: 'text', text: 'Use list_due and list_highlights to draft my weekly review: what is due, what I highlighted, and what I should act on.' } }] };
        }
        if (name === 'write_from_collection') {
            const collection = args && args.collection;
            return { messages: [{ role: 'user', content: { type: 'text', text: `Use list_collections/get_collection to load collection "${collection}" and get_article for each source, then draft from only those sources, quoting my highlights and citing each url.` } }] };
        }
        if (name === 'on_brand') {
            const guide = brandGuide() || 'Read the aish://brand resource.';
            return { messages: [{ role: 'user', content: { type: 'text', text: `Style what you make from my library in this brand guide, unless I ask for something else:\n\n${guide}` } }] };
        }
        throw new Error(`Unknown prompt: ${name}`);
    });

    return server;
}

/** Tell the connected app that the tool/resource/prompt lists changed, so it asks again (the first list may predate the browser). */
export function announceListsChanged(server) {
    for (const fn of ['sendToolListChanged', 'sendResourceListChanged', 'sendPromptListChanged']) {
        try { const r = server[fn] && server[fn](); if (r && r.catch) r.catch(() => {}); } catch (_) { /* not connected yet */ }
    }
}

export async function connectStdio(server) {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    return transport;
}

/** Streamable HTTP on 127.0.0.1 only (S1/S3): no CORS, bearer token required, Host pinned to loopback. */
export function startHttp(server, { port = 47616, getToken, log = () => {} } = {}) {
    const sessions = new Map(); // sessionId -> transport
    const httpServer = http.createServer(async (req, res) => {
        const host = (req.headers.host || '').split(':')[0];
        if (host !== '127.0.0.1' && host !== 'localhost') { res.writeHead(421).end('wrong host'); return; } // S3: DNS rebinding
        const auth = req.headers.authorization || '';
        const expected = getToken();
        if (!expected || auth !== `Bearer ${expected}`) { res.writeHead(401).end('unauthorized'); return; } // S3: bearer token required

        const sid = req.headers['mcp-session-id'];
        let transport = sid && sessions.get(sid);
        if (!transport) {
            transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomUUID(),
                onsessioninitialized: (id) => sessions.set(id, transport),
            });
            transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId); };
            await server.connect(transport);
        }
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', async () => {
            let parsed; try { parsed = body ? JSON.parse(body) : undefined; } catch (_) { parsed = undefined; }
            await transport.handleRequest(req, res, parsed);
        });
    });
    httpServer.listen(port, '127.0.0.1', () => log(`HTTP MCP endpoint on http://127.0.0.1:${port}/`)); // S1
    return httpServer;
}

// mcp/src/hub.js — gives the MCP server one stable backend, whichever role this copy ends up in:
//   owner    this copy holds 127.0.0.1:<port> and talks to the extension (relayServer.js)
//   follower another copy holds the port; forward through it (follower.js)
// If the owner exits (its app closed a chat), a follower takes the port over within about a second.
import { createRelay, NOT_RUNNING } from './relayServer.js';
import { createFollower } from './follower.js';
import { readDefsCache, writeDefsCache } from './pairing.js';

const sameDefs = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);

export function createHub({ getToken, port = 47615, log = () => {}, onDefsChanged = () => {} }) {
    let backend = null;
    let stopped = false;
    let defs = readDefsCache();      // last known definitions, so the first tools/list is never empty

    function setDefs(next) {
        if (!next || sameDefs(next, defs)) return;
        defs = next;
        writeDefsCache(next);
        onDefsChanged(next);
    }

    async function claim() {
        if (stopped) return;
        const relay = createRelay({ getToken, port, log, onDefs: setDefs });
        try {
            await relay.start();
            backend = relay;
            log(`listening for the AISH extension on ws://127.0.0.1:${port}`);
            return;
        } catch (e) {
            if (e.code !== 'EADDRINUSE') throw e;
        }
        const follower = createFollower({
            getToken, port, log, onDefs: setDefs,
            onLost: () => { if (backend === follower) backend = null; setTimeout(() => claim().catch(retry), 200 + Math.random() * 800); },
        });
        try {
            await follower.start();
            backend = follower;
            log(`another aish-mcp owns port ${port}; sharing its connection`);
        } catch (e) {
            log(`could not join the aish-mcp on port ${port}: ${e.message}`);
            retry();
        }
    }
    function retry() { if (!stopped) setTimeout(() => claim().catch(retry), 2000); }

    return {
        start: () => claim(),
        stop() { stopped = true; if (backend) backend.stop(); backend = null; },
        call: (tool, args) => (backend ? backend.call(tool, args) : Promise.reject(new Error(NOT_RUNNING))),
        isExtensionConnected: () => !!(backend && backend.isExtensionConnected()),
        role: () => (backend ? backend.role : 'starting'),
        toolDefinitions: () => (defs ? defs.tools : []),
        resourceDefinitions: () => (defs ? defs.resources : []),
        promptDefinitions: () => (defs ? defs.prompts : []),
        brand: () => (defs && defs.brand) || null,   // { name, short, instructions, guide } of the extension's build
    };
}

#!/usr/bin/env node
// aish-mcp — local relay between your AISH library (in the browser extension) and any
// MCP-capable app on this computer. See ../README.md for setup, and
// claude/prd-local-mcp.md in the ai-summary-helper repo for the design.
import { ensureToken, resetToken, currentToken, configDir } from '../src/pairing.js';
import { createHub } from '../src/hub.js';
import { createMcpServer, connectStdio, startHttp, announceListsChanged } from '../src/mcpServer.js';
import net from 'node:net';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const value = (f, def) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
const VALUE_FLAGS = new Set(['--port', '--http-port']);
const cmdArgs = [];
for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('-')) { if (VALUE_FLAGS.has(args[i])) i++; continue; }
    cmdArgs.push(args[i]);
}
const cmd = cmdArgs[0] || '';

const RELAY_PORT = Number(value('--port', process.env.AISH_MCP_PORT || 47615));
const HTTP_PORT = Number(value('--http-port', RELAY_PORT + 1));

function printPairingCode(token) {
    console.error('');
    console.error('  AISH pairing code (paste into AISH → Settings → AI apps):');
    console.error('');
    console.error(`    ${token}`);
    console.error('');
    console.error(`  Stored in ${configDir()}. Run "aish-mcp reset" to generate a new one.`);
    console.error('');
}

async function runServer() {
    const { token } = ensureToken();
    const log = (line) => console.error(`[aish-mcp] ${line}`);
    let server = null;
    const hub = createHub({ getToken: currentToken, port: RELAY_PORT, log, onDefsChanged: () => { if (server) announceListsChanged(server); } });
    server = createMcpServer(hub);
    // Answer the app first (it may only wait a few seconds), then sort out who owns the relay port.
    if (flag('--http')) startHttp(server, { port: HTTP_PORT, getToken: currentToken, log });
    else await connectStdio(server);
    try {
        await hub.start();
    } catch (e) {
        log(`could not open 127.0.0.1:${RELAY_PORT}: ${e && e.message}`);
    }
    if (hub.role() === 'owner') printPairingCode(token);

    const shutdown = () => { hub.stop(); process.exit(0); };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.stdin.on('end', shutdown);   // the app closed our stdio: leave, and free the port for another copy
}

function portInUse(port) {
    return new Promise((resolve) => {
        const socket = net.connect({ host: '127.0.0.1', port, timeout: 500 });
        socket.once('connect', () => { socket.destroy(); resolve(true); });
        socket.once('error', () => resolve(false));
        socket.once('timeout', () => { socket.destroy(); resolve(false); });
    });
}

async function main() {
    switch (cmd) {
        case 'pair': {
            const { token } = ensureToken();
            printPairingCode(token);
            return;
        }
        case 'reset': {
            const { token } = resetToken();
            console.error('[aish-mcp] new pairing token generated.');
            printPairingCode(token);
            return;
        }
        case 'status': {
            const has = !!currentToken();
            const up = await portInUse(RELAY_PORT);
            console.log(`config dir : ${configDir()}`);
            console.log(`pairing    : ${has ? 'set' : 'not set (run "aish-mcp pair")'}`);
            console.log(`relay port : ${RELAY_PORT} (${up ? 'something is listening' : 'not running'})`);
            return;
        }
        case '':
            return runServer();
        default:
            console.error(`Unknown command: ${cmd}`);
            console.error('Usage: aish-mcp [--http] [--port <n>] | aish-mcp pair | aish-mcp reset | aish-mcp status');
            process.exit(1);
    }
}

main().catch((e) => { console.error('[aish-mcp] fatal:', e && e.stack || e); process.exit(1); });

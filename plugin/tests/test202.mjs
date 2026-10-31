// The two-device encrypted sync (test200) again, with a folder on disk as the store instead of WebDAV.
import { execFileSync } from 'child_process'; import path from 'path'; import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const out = execFileSync(process.execPath, [...process.execArgv, path.join(here, 'test200.mjs')], { env: { ...process.env, AISH_STORE: 'folder' }, encoding: 'utf8', timeout: 90000 });
if (!out.includes('TEST 200 OK')) throw new Error('folder variant failed: ' + out.slice(-300));
console.log('TEST 202 OK'); process.exit(0);

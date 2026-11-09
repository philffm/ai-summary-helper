// The background worker's source as the browser runs it: background.js with each `importScripts('bg/….js')` line replaced
// by that file. Tests read this instead of background.js alone, so text checks, slices between markers and vm runs see the
// parts in bg/ in the same place as before they were moved out (R4 phase 3).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DEFAULT_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

export function bgSource(src = process.env.AISH_SRC || DEFAULT_SRC) {
    const main = fs.readFileSync(path.join(src, 'background.js'), 'utf8');
    return main.replace(/^try \{ if \(typeof importScripts === 'function'\) importScripts\('(bg\/[\w.-]+\.js)'\); \} catch[^\n]*$/gm,
        (_, file) => fs.readFileSync(path.join(src, file), 'utf8'));
}

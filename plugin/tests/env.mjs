// Preloaded by `node --import` (see run.mjs / npm test): gives every test the repo paths.
import path from 'path';
import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
process.env.AISH_TESTS = here;
process.env.AISH_SRC = path.resolve(here, '../src');
process.env.AISH_ROOT = path.resolve(here, '../..');

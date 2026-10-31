// An in-memory FileSystemDirectoryHandle (the subset syncFolder.js uses), with `files` (path → { body }) and `log` for the tests.
export function createFakeFolder({ permission = 'granted' } = {}) {
  const files = new Map(), dirs = new Set(['']), log = []; let mt = 1_700_000_000_000;
  const err = (name) => Object.assign(new Error(name), { name });
  const dirHandle = (path) => ({
    kind: 'directory', name: path.split('/').pop(),
    async queryPermission() { return permission; },
    async getDirectoryHandle(n, { create } = {}) { const p = path ? path + '/' + n : n; if (!dirs.has(p)) { if (!create) throw err('NotFoundError'); dirs.add(p); } return dirHandle(p); },
    async getFileHandle(n, { create } = {}) {
      const p = path ? path + '/' + n : n;
      if (!files.has(p)) { if (!create) throw err('NotFoundError'); files.set(p, { body: new Uint8Array(0), mt: ++mt }); }
      return { kind: 'file', name: n,
        async getFile() { const f = files.get(p); if (!f) throw err('NotFoundError'); return { size: f.body.length, lastModified: f.mt, async arrayBuffer() { return f.body.buffer.slice(f.body.byteOffset, f.body.byteOffset + f.body.length); } }; },
        async createWritable() { let buf; return { async write(b) { buf = b instanceof Uint8Array ? b : new Uint8Array(b); }, async close() { log.push('WRITE ' + p); files.set(p, { body: buf || new Uint8Array(0), mt: ++mt }); } }; } };
    },
    async removeEntry(n) { const p = path ? path + '/' + n : n; if (!files.delete(p)) throw err('NotFoundError'); },
    async *entries() {
      for (const d of dirs) if (d && d.slice(0, d.lastIndexOf('/') + 1) === (path ? path + '/' : '') && d !== path) yield [d.split('/').pop(), dirHandle(d)];
      for (const [p] of files) if (p.slice(0, p.lastIndexOf('/') + 1) === (path ? path + '/' : '')) { const n = p.split('/').pop(); yield [n, (await dirHandle(path).getFileHandle(n))]; }
    },
  });
  return { handle: dirHandle(''), files, dirs, log };
}

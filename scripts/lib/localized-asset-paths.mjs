import path from 'node:path';

export function localizedAssetPrefix(pagePath) {
    const relative = path.posix.relative(path.posix.dirname(pagePath), '.');
    return relative ? `${relative}/` : '';
}

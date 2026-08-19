import fs from 'node:fs';
import path from 'node:path';

const LANG_DIR = './lang';

function getRootPrefix(filePath) {
  // Compute depth relative to the project root
  const relativeFromRoot = path.relative('.', path.dirname(filePath));
  const depth = relativeFromRoot.split(path.sep).filter(Boolean).length;
  return depth > 0 ? '../'.repeat(depth) : './';
}

function fixPathsInFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const prefix = getRootPrefix(filePath);

  const updated = content.replace(
    /(src|href)=["'](?!https?:\/\/|\/\/|\/|#|mailto:|data:)(?:\.\.\/|\.\/)*([^"']+)["']/gi,
    (match, attr, assetPath) => {
      // Avoid modifying target page links if they are already correctly routed
      if (assetPath.startsWith('http') || assetPath.startsWith('#')) return match;
      return `${attr}="${prefix}${assetPath}"`;
    }
  );

  fs.writeFileSync(filePath, updated, 'utf8');
  console.log(`Updated paths in: ${filePath} (prefix: ${prefix})`);
}

function walkAndFix(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkAndFix(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      fixPathsInFile(fullPath);
    }
  }
}

// Run against existing lang files
walkAndFix(LANG_DIR);
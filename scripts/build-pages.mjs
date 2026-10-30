import { cpSync, mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

function filesIn(directory) {
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(file) : [file];
  });
}
const files = ['index.html', ...filesIn('public')];
const hash = createHash('sha256');
hash.update(readFileSync(import.meta.filename)).update('\0');
for (const file of files) hash.update(file).update('\0').update(readFileSync(file)).update('\0');
const version = hash.digest('hex').slice(0, 16);

rmSync('pages-dist', { recursive: true, force: true });
mkdirSync('pages-dist', { recursive: true });
cpSync('public', 'pages-dist', { recursive: true });
// Version the complete import graph: updating only app.mjs would leave cached
// dependencies (for example the poster renderer) at the previous release.
for (const file of filesIn('pages-dist').filter(file => file.endsWith('.mjs'))) {
  const source = readFileSync(file, 'utf8').replace(/(\b(?:from\s+|import\s*\(\s*|import\s+))(['"])(\.{1,2}\/[^'"]+\.mjs)\2/g,
    (_, prefix, quote, specifier) => `${prefix}${quote}${specifier}?v=${version}${quote}`);
  writeFileSync(file, source);
}
const html = readFileSync('index.html', 'utf8').replace(/((?:src|href)=["'])(\.\/[^"'?]+\.(?:mjs|css))(["'])/g,
  (_, prefix, file, quote) => `${prefix}${file}?v=${version}${quote}`);
writeFileSync('pages-dist/index.html', html);
console.log(`GitHub Pages output: pages-dist/ (asset version ${version})`);

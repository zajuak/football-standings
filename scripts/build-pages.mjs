import { cpSync, mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const campus = process.argv.includes('--campus');
const output = campus ? 'campus-dist' : 'pages-dist';
const runtimeConfig = campus ? "export const RECORDS_API = '/api/records';\n" : null;

function filesIn(directory) {
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(file) : [file];
  });
}
const files = ['index.html', ...filesIn('public')];
const hash = createHash('sha256');
hash.update(readFileSync(import.meta.filename)).update('\0');
hash.update(campus ? 'campus' : 'pages').update('\0');
for (const file of files) hash.update(file).update('\0').update(file === 'public/runtime-config.mjs' && campus ? runtimeConfig : readFileSync(file)).update('\0');
const version = hash.digest('hex').slice(0, 16);

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
cpSync('public', output, { recursive: true });
if (campus) writeFileSync(path.join(output, 'runtime-config.mjs'), runtimeConfig);
// Version the complete import graph: updating only app.mjs would leave cached
// dependencies (for example the poster renderer) at the previous release.
for (const file of filesIn(output).filter(file => file.endsWith('.mjs'))) {
  const source = readFileSync(file, 'utf8').replace(/(\b(?:from\s+|import\s*\(\s*|import\s+))(['"])(\.{1,2}\/[^'"]+\.mjs)\2/g,
    (_, prefix, quote, specifier) => `${prefix}${quote}${specifier}?v=${version}${quote}`);
  writeFileSync(file, source);
}
let html = readFileSync('index.html', 'utf8').replace(/((?:src|href)=["'])(\.\/[^"'?]+\.(?:mjs|css))(["'])/g,
  (_, prefix, file, quote) => `${prefix}${file}?v=${version}${quote}`);
if (campus) html = html
  .replace('北京大学足球协会</div>', '北京大学足球协会 · 校内独立版</div>')
  .replace('赛事数据统一同步到云端，切换不会新增历史', '数据保存在校内服务器，与原网站分别维护')
  .replaceAll('https://football-standings-api.junkaizhao404.workers.dev/health', '/health');
writeFileSync(path.join(output, 'index.html'), html);
console.log(`${campus ? 'Campus' : 'GitHub Pages'} output: ${output}/ (asset version ${version})`);

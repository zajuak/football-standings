import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const buildScript = path.resolve(import.meta.dirname, '../scripts/build-pages.mjs');
function project(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'standings-release-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(path.join(directory, 'public'));
  const write = (name, value) => writeFileSync(path.join(directory, name), value);
  write('index.html', '<link rel="stylesheet" href="./styles.css"><script type="module" src="./app.mjs"></script>');
  write('public/styles.css', 'body { color: blue }');
  write('public/app.mjs', "import { value } from './core.mjs'; export const result = value; export const lazy = () => import('./core.mjs');");
  write('public/core.mjs', 'export const value = 1;');
  const build = () => {
    execFileSync(process.execPath, [buildScript], { cwd: directory });
    const html = readFileSync(path.join(directory, 'pages-dist/index.html'), 'utf8');
    const source = html.match(/src="(.+?)"/)[1];
    return { html, source, url: new URL(source, pathToFileURL(path.join(directory, 'pages-dist/index.html'))).href };
  };
  return { directory, write, build };
}

test('发布入口、样式与静态及动态依赖使用一致资源版本', async t => {
  const fixture = project(t), release = fixture.build();
  const version = release.source.split('?v=')[1];
  assert.match(version, /^[0-9a-f]{16}$/);
  assert.ok(release.html.includes(`styles.css?v=${version}`));
  const built = readFileSync(path.join(fixture.directory, 'pages-dist/app.mjs'), 'utf8');
  assert.equal(built.split(`core.mjs?v=${version}`).length - 1, 2);
  const app = await import(release.url);
  assert.equal(app.result, 1); assert.equal((await app.lazy()).value, 1);
});

test('升级依赖后已缓存的旧模块不影响新版本，重复构建保持稳定', async t => {
  const fixture = project(t), previous = fixture.build();
  const oldApp = await import(previous.url); assert.equal(oldApp.result, 1);
  assert.equal(fixture.build().source, previous.source);
  fixture.write('public/core.mjs', 'export const value = 2;');
  const next = fixture.build(); assert.notEqual(next.source, previous.source);
  const newApp = await import(next.url);
  assert.equal(newApp.result, 2); assert.equal((await newApp.lazy()).value, 2);
  assert.equal(oldApp.result, 1);
});

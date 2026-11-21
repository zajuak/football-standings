import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDatabase, mergeDatabase, mergeRecords, databaseSummary, RECORD_COLUMNS } from '../server/database.mjs';
import { createBackend } from '../server/http.mjs';
import { createInitialState } from '../public/core.mjs';

function directory(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'standings-backend-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
async function start(t, filename, options = {}) {
  const db = openDatabase(filename);
  const server = createBackend({ db, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    server.closeIdleConnections();
    await new Promise(resolve => server.close(resolve));
    db.close();
  };
  t.after(close);
  return { db, url, close, get: async query => (await fetch(`${url}/api/records${query || ''}`)).json(),
    post: data => fetch(`${url}/api/records`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof data === 'string' ? data : JSON.stringify(data) }) };
}
const submission = (id, baseRevision, state = createInitialState()) => ({ id, baseRevision, action: '后端验收', state });
const original = (revision, applied = 1) => ({ revision, submission_id: `original-${revision}`, base_revision: 0,
  action: '原始历史', state: JSON.stringify(createInitialState()), applied, created_at: '2026-10-29T00:00:00Z', content_hash: null });

test('服务器默认只读，健康检查、历史读取和来源限制可用且不会写入', async t => {
  const server = await start(t, ':memory:');
  const health = await (await fetch(`${server.url}/health`)).json();
  assert.equal(health.mode, 'replica'); assert.equal(health.readOnly, true);
  assert.equal((await server.post(submission('blocked', 0))).status, 503);
  assert.equal((await server.get()).revision, 0);
  assert.equal((await fetch(`${server.url}/api/records`, { headers: { origin: 'https://other.test' } })).status, 403);
  assert.equal((await fetch(`${server.url}/api/records`, { method: 'OPTIONS', headers: { origin: server.url } })).status, 204);
  assert.equal((await fetch(`${server.url}/server/main.mjs`)).status, 404);
});

test('实际 HTTP 写入跨重启持久保存，冲突与恢复仍保留全部历史', async t => {
  const file = path.join(directory(t), 'standings.sqlite');
  const first = await start(t, file, { readOnly: false });
  const state = createInitialState();
  assert.equal((await first.post(submission('one', 0, state))).status, 200);
  assert.equal((await first.post(submission('one', 0, state))).status, 200);
  state.competitions[0].title = '另一台设备';
  assert.equal((await first.post(submission('conflict', 0, state))).status, 409);
  await first.close();
  const second = await start(t, file, { readOnly: false });
  assert.equal((await second.get()).revision, 1);
  assert.equal((await second.get('?history=1&full=1')).items.length, 2);
  assert.equal((await second.get('?revision=2')).state.competitions[0].title, '另一台设备');
  assert.equal((await second.post(submission('restore', 1, state))).status, 200);
  assert.equal((await second.get()).revision, 3);
});

test('HTTP 层拒绝无效 JSON、超限请求和不支持的方法', async t => {
  const server = await start(t, ':memory:', { readOnly: false });
  assert.equal((await server.post('{broken')).status, 400);
  assert.equal((await server.post('x'.repeat(2_000_001))).status, 413);
  assert.equal((await fetch(`${server.url}/api/records`, { method: 'DELETE' })).status, 405);
  assert.equal((await server.get()).revision, 0);
});

test('独立校园版同源提供网页、资源和可写接口，不暴露源码、数据库或符号链接外的文件', async t => {
  const dir = directory(t), web = path.join(dir, 'web');
  mkdirSync(web);
  writeFileSync(path.join(web, 'index.html'), '<title>校内积分榜</title>');
  writeFileSync(path.join(web, 'runtime-config.mjs'), "export const RECORDS_API = '/api/records';");
  writeFileSync(path.join(dir, 'private.mjs'), 'private data');
  symlinkSync(path.join(dir, 'private.mjs'), path.join(web, 'escape.mjs'));
  const server = await start(t, path.join(dir, 'standings.sqlite'), { readOnly: false, staticDirectory: web });
  const page = await fetch(server.url);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(await page.text(), /校内积分榜/);
  const config = await fetch(`${server.url}/runtime-config.mjs?v=release`);
  assert.match(config.headers.get('content-type'), /javascript/);
  assert.match(await config.text(), /'\/api\/records'/);
  const head = await fetch(server.url, { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
  for (const name of ['escape.mjs', 'standings.sqlite', 'server/main.mjs', '.env', '%2e%2e%2fprivate.mjs', '%2f..%2fprivate.mjs']) {
    assert.equal((await fetch(`${server.url}/${name}`)).status, 404, name);
  }
  assert.equal((await fetch(server.url, { method: 'POST' })).status, 405);
  assert.equal((await server.post(submission('campus', 0))).status, 200);
  assert.equal((await server.get()).revision, 1);
  assert.equal((await (await fetch(`${server.url}/health`)).json()).readOnly, false);
});

test('SQL 迁入保持原始版本号、冲突记录、时间和状态原文，续传幂等', t => {
  const dir = directory(t), sourceFile = path.join(dir, 'source.sqlite');
  const source = openDatabase(sourceFile), target = openDatabase(path.join(dir, 'target.sqlite'));
  t.after(() => { source.close(); target.close(); });
  const records = [original(24), original(25, 0), original(30)];
  mergeRecords(source, records);
  assert.equal(mergeDatabase(target, sourceFile).inserted, 3);
  assert.equal(mergeDatabase(target, sourceFile).inserted, 0);
  const rows = target.sql.prepare(`SELECT ${RECORD_COLUMNS.join(',')} FROM submissions ORDER BY revision`).all();
  assert.deepEqual(rows.map(row => ({ ...row })), records);
  target.sql.prepare('INSERT INTO submissions(submission_id,base_revision,action,state,applied,created_at) VALUES (?,?,?,?,?,?)').run('next', 30, '后续', '{}', 1, '2026-11-10T00:00:00Z');
  assert.equal(databaseSummary(target).revision, 31);
});

test('迁入发现版本或提交编号冲突时整批回滚，不能覆盖既有记录', () => {
  const db = openDatabase(':memory:');
  try {
    mergeRecords(db, [original(1), original(2)]);
    assert.throws(() => mergeRecords(db, [original(3), { ...original(2), action: '错误覆盖' }]), /mismatch/);
    assert.equal(databaseSummary(db).records, 2);
    assert.throws(() => mergeRecords(db, [{ ...original(3), submission_id: 'original-1' }]), /mismatch/);
    assert.equal(databaseSummary(db).records, 2);
  } finally { db.close(); }
});

test('运行中的 WAL 数据库可生成完整且可恢复的独立备份', t => {
  const dir = directory(t), filename = path.join(dir, 'live.sqlite');
  const db = openDatabase(filename);
  t.after(() => db.close());
  mergeRecords(db, [original(1), original(2, 0)]);
  execFileSync('python3', [path.resolve('server/backup.py')], { env: { ...process.env, DATABASE_PATH: filename, BACKUP_DIR: path.join(dir, 'backups') } });
  const files = readdirSync(path.join(dir, 'backups'));
  assert.equal(files.length, 1);
  assert.ok(files[0].endsWith('.sqlite'));
  const backupFile = path.join(dir, 'backups', files[0]);
  const restored = openDatabase(backupFile);
  try { assert.deepEqual(databaseSummary(restored), databaseSummary(db)); }
  finally { restored.close(); }
});

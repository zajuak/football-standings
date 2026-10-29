import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createInitialState } from '../public/core.mjs';
import { handleRecords, validSnapshot } from '../cloudflare/records-api.mjs';
import worker from '../cloudflare/worker.mjs';

function database() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE submissions (revision INTEGER PRIMARY KEY AUTOINCREMENT, submission_id TEXT UNIQUE NOT NULL, base_revision INTEGER NOT NULL, action TEXT NOT NULL, state TEXT NOT NULL, applied INTEGER NOT NULL, created_at TEXT NOT NULL)`);
  return { prepare(query) { let args = []; const statement = sql.prepare(query); return { bind(...values) { args = values; return this; }, async run() { return statement.run(...args); }, async first() { return statement.get(...args) ?? null; }, async all() { return { results: statement.all(...args) }; } }; } };
}
const post = (db, data) => handleRecords(new Request('https://test/api/records', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }), db);
const get = async (db, query = '') => (await handleRecords(new Request(`https://test/api/records${query}`), db)).json();
const submit = (id, baseRevision = 0, state = createInitialState()) => ({ id, baseRevision, state, action: '录入赛果' });

test('全量快照追加保存，删除和重置不丢失旧版本', async () => {
  const db = database(); const initial = createInitialState();
  const first = await (await post(db, submit('one', 0, initial))).json();
  const modified = structuredClone(initial); modified.competitions[0].matches.pop();
  const second = await (await post(db, submit('two', first.revision, modified))).json();
  assert.equal(second.applied, true);
  assert.equal((await get(db)).state.competitions[0].matches.length, 15);
  assert.deepEqual((await get(db, '?revision=1')).state, initial);
  assert.equal((await get(db, '?history=1')).items.length, 2);
});
test('响应丢失后重试不重复写入，提交号不能覆盖已有数据', async () => {
  const db = database(); const data = submit('once');
  assert.equal((await post(db, data)).status, 200);
  assert.equal((await post(db, data)).status, 200);
  assert.equal((await get(db, '?history=1')).items.length, 1);
  data.state.competitions[0].title = 'other';
  assert.equal((await post(db, data)).status, 409);
  assert.notEqual((await get(db)).state.competitions[0].title, 'other');
});
test('过期页面提交被存档但不覆盖云端；恢复会产生新版本', async () => {
  const db = database(); await post(db, submit('first'));
  const local = createInitialState(); local.competitions[0].title = '本机修改';
  const response = await post(db, submit('stale', 0, local));
  assert.equal(response.status, 409); assert.equal((await response.json()).archived, true);
  assert.equal((await get(db)).revision, 1);
  assert.equal((await get(db, '?revision=2')).state.competitions[0].title, '本机修改');
  assert.equal((await post(db, submit('restored', 1, local))).status, 200);
  assert.equal((await get(db)).revision, 3);
});
test('历史导出可以遍历超过一页的所有版本（包括冲突）', async () => {
  const db = database(); let base = 0;
  for (let i = 0; i < 53; i++) base = (await (await post(db, submit(`id-${i}`, base))).json()).revision;
  const first = await get(db, '?history=1&full=1');
  const rest = await get(db, `?history=1&full=1&before=${first.next}`);
  assert.equal(first.items.length, 50); assert.equal(rest.items.length, 3); assert.equal(rest.next, null);
  assert.ok(first.items.every(item => validSnapshot(item.state)));
  assert.equal(new Set([...first.items, ...rest.items].map(i => i.revision)).size, 53);
});
test('无效数据、跨来源请求被拒绝且不会写入', async () => {
  const db = database();
  for (const value of [null, {}, { ...submit('bad'), state: { ...createInitialState(), competitions: [null, null] } }]) assert.equal((await post(db, value)).status, 400);
  const state = createInitialState(); state.competitions[0].matches[0].homeId = 'missing';
  assert.equal(validSnapshot(state), false);
  assert.equal((await post(db, submit('bad-ref', 0, state))).status, 400);
  const request = new Request('https://test/api/records', { method: 'POST', headers: { origin: 'https://other', 'content-type': 'application/json' }, body: JSON.stringify(submit('csrf')) });
  assert.equal((await get(db, '?history=1')).items.length, 0);
});

const secret = 'test-only-standings-secret-0123456789';
const env = db => ({ DB: db, SYNC_TOKEN: secret });
test('云端所有数据接口要求口令，健康检查不泄露数据', async () => {
  const db = database();
  const response = await worker.fetch(new Request('https://api.test/api/records'), env(db));
  assert.equal(response.status, 401);
  const health = await (await worker.fetch(new Request('https://api.test/health'), env(db))).json();
  assert.deepEqual(health, { ok: true, databaseBound: true, authConfigured: true });
  assert.equal((await worker.fetch(new Request('https://api.test/api/records'), { DB: db })).status, 503);
});
test('GitHub Pages 跨域预检和授权提交可用，其他来源被拒绝', async () => {
  const db = database();
  const preflight = await worker.fetch(new Request('https://api.test/api/records', { method: 'OPTIONS', headers: { origin: 'https://zajuak.github.io' } }), env(db));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://zajuak.github.io');
  const request = new Request('https://api.test/api/records', { method: 'POST', headers: { origin: 'https://zajuak.github.io', authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify(submit('github')) });
  const response = await worker.fetch(request, env(db)); assert.equal(response.status, 200);
  const rejected = await worker.fetch(new Request('https://api.test/api/records', { headers: { origin: 'https://example.com', authorization: `Bearer ${secret}` } }), env(db));
  assert.equal(rejected.status, 403);
});

import { CloudSync } from '../public/cloud-sync.mjs';
function cloudClient(db, saved = new Map()) {
  let online = true;
  const client = new CloudSync({ storage: { getItem: key => saved.get(key), setItem: (key,value) => saved.set(key,value) }, fetcher: async (url, options) => {
    if (!online) throw new Error('offline');
    return worker.fetch(new Request(url, options), env(db));
  } });
  return { client, saved, offline() { online = false; }, online() { online = true; } };
}
const idle = async client => { while (client.running) await new Promise(r => setTimeout(r, 1)); };
test('连接空云端不会用默认数据自动覆盖，迁移所有本机历史且可续传', async () => {
  const db = database(); const { client } = cloudClient(db);
  await client.connect(secret); assert.equal(client.selected, false);
  assert.equal((await get(db, '?history=1')).items.length, 0);
  const state = createInitialState(); state.competitions[0].title = '正式数据';
  const records = [1,2].map(n => ({ submission_id: `local-${n}`, action: `修改${n}`, state, created_at: '2026-10-29T10:00:00.000Z' }));
  await client.migrate(records, state); assert.equal(client.selected, true);
  assert.equal((await get(db, '?history=1')).items.length, 3);
  assert.deepEqual((await get(db)).state, state);
  assert.equal((await get(db, '?revision=1')).created_at, '2026-10-29T10:00:00.000Z');
  await client.migrate(records, state);
  assert.equal((await get(db, '?history=1')).items.length, 4); // history is deduplicated; current state is a new explicit submission.
});
test('云端离线期间的提交刷新后仍能按顺序补传', async () => {
  const db = database(); const c = cloudClient(db); await c.client.connect(secret);
  c.offline(); c.client.selected = true;
  for (let i = 0; i < 3; i++) { const state = createInitialState(); state.competitions[0].title = `offline ${i}`; c.client.enqueue(state, '离线修改'); }
  await idle(c.client); assert.equal(c.client.queue.length, 3);
  const restored = cloudClient(db, c.saved); await restored.client.connect(secret); await idle(restored.client);
  assert.equal(restored.client.queue.length, 0); assert.equal((await get(db, '?history=1')).items.length, 3);
  assert.equal((await get(db)).state.competitions[0].title, 'offline 2');
});
test('并发修改先归档冲突，选用云端版本时保留所有本机待同步快照', async () => {
  const db = database(); const a = cloudClient(db).client, b = cloudClient(db).client;
  await a.connect(secret); await b.connect(secret);
  a.enqueue(createInitialState(), '设备 A'); await idle(a);
  b.enqueue(createInitialState(), '设备 B 第一次'); b.enqueue(createInitialState(), '设备 B 第二次'); await idle(b);
  assert.equal(b.conflict, true); let loaded;
  await b.resolve(false, state => loaded = state);
  assert.equal(b.queue.length, 0); assert.equal(b.conflict, false); assert.ok(loaded);
  const history = (await get(db, '?history=1')).items;
  assert.equal(history.length, 3); assert.equal(history.filter(r => !r.applied).length, 2);
});

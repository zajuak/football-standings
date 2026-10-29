import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createInitialState } from '../public/core.mjs';
import { handleRecords, validSnapshot } from '../lib/server/records-api.mjs';
import { HistorySync, SYNC_KEY } from '../public/sync.mjs';

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
  assert.equal((await handleRecords(request, db)).status, 403);
  assert.equal((await get(db, '?history=1')).items.length, 0);
});
function client(db, saved = new Map()) {
  let online = true;
  const sync = new HistorySync({ storage: { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) }, fetcher: (path, options) => {
    if (!online) throw new Error('offline');
    return handleRecords(new Request(`https://test${path}`, options), db);
  } });
  return { sync, saved, offline() { online = false; }, online() { online = true; } };
}
async function idle(sync) { while (sync.running) await new Promise(r => setTimeout(r, 1)); }

test('离线多次提交在刷新后仍逐条同步，不压缩历史', async () => {
  const db = database(); const c = client(db); const initial = createInitialState();
  await c.sync.init(initial); await idle(c.sync);
  c.offline();
  for (let i = 0; i < 3; i++) { const state = createInitialState(); state.competitions[0].title = `offline ${i}`; c.sync.enqueue(state, '离线提交'); }
  await idle(c.sync); assert.equal(c.sync.queue.length, 3);
  const reloaded = client(db, c.saved); await reloaded.sync.init(initial); await idle(reloaded.sync);
  assert.equal(reloaded.sync.queue.length, 0);
  assert.equal((await get(db, '?history=1')).items.length, 4);
  assert.equal((await get(db)).state.competitions[0].title, 'offline 2');
});
test('云端已接收但客户端超时，刷新后可幂等恢复', async () => {
  const db = database(); const data = submit('lost'); await post(db, data);
  const saved = new Map([[SYNC_KEY, JSON.stringify({ revision: 0, queue: [data] })]]);
  const c = client(db, saved); await c.sync.init(createInitialState()); await idle(c.sync);
  assert.equal(c.sync.queue.length, 0); assert.equal(c.sync.revision, 1);
  assert.equal((await get(db, '?history=1')).items.length, 1);
});
test('处理并发冲突前会归档全部待同步数据', async () => {
  const db = database(); const a = client(db); const b = client(db);
  await a.sync.init(createInitialState()); await idle(a.sync);
  await b.sync.init(createInitialState());
  a.sync.enqueue(createInitialState(), 'A更新'); await idle(a.sync);
  b.offline();
  b.sync.enqueue(createInitialState(), 'B更新1'); b.sync.enqueue(createInitialState(), 'B更新2'); await idle(b.sync);
  b.online(); await b.sync.flush(); assert.equal(b.sync.conflict, true);
  await b.sync.resolve(false);
  assert.equal(b.sync.queue.length, 0); assert.equal(b.sync.conflict, false);
  const history = (await get(db, '?history=1')).items;
  assert.equal(history.length, 4); assert.equal(history.filter(i => !i.applied).length, 2);
  assert.equal((await get(db)).revision, 2);
});

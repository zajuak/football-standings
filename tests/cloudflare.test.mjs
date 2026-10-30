import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createInitialState, createCompetition, resetCompetition } from '../public/core.mjs';
import { handleRecords, validSnapshot } from '../cloudflare/records-api.mjs';
import worker from '../cloudflare/worker.mjs';

function database() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE submissions (revision INTEGER PRIMARY KEY AUTOINCREMENT, submission_id TEXT UNIQUE NOT NULL, base_revision INTEGER NOT NULL, action TEXT NOT NULL, state TEXT NOT NULL, applied INTEGER NOT NULL, created_at TEXT NOT NULL, content_hash TEXT)`);
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
  for (let i = 0; i < 53; i++) { const state = createInitialState(); state.competitions[0].title = `版本${i}`; base = (await (await post(db, submit(`id-${i}`, base, state))).json()).revision; }
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
  assert.equal((await get(db, '?history=1')).items.length, 0);
});

const env = db => ({ DB: db });
test('无需口令即可自动读写云端，健康检查明确无需验证', async () => {
  const db = database();
  const response = await worker.fetch(new Request('https://api.test/api/records'), env(db));
  assert.equal(response.status, 200);
  const health = await (await worker.fetch(new Request('https://api.test/health'), env(db))).json();
  assert.deepEqual(health, { ok: true, databaseBound: true, authenticationRequired: false });
  assert.equal((await worker.fetch(new Request('https://api.test/api/records'), {})).status, 503);
});
test('GitHub Pages 无口令跨域提交可用，其他浏览器来源被拒绝', async () => {
  const db = database();
  const preflight = await worker.fetch(new Request('https://api.test/api/records', { method: 'OPTIONS', headers: { origin: 'https://zajuak.github.io' } }), env(db));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://zajuak.github.io');
  const request = new Request('https://api.test/api/records', { method: 'POST', headers: { origin: 'https://zajuak.github.io', 'content-type': 'application/json' }, body: JSON.stringify(submit('github')) });
  assert.equal((await worker.fetch(request, env(db))).status, 200);
  assert.equal((await worker.fetch(new Request('https://api.test/api/records', { headers: { origin: 'https://example.com' } }), env(db))).status, 403);
});

import { CloudSync } from '../public/cloud-sync.mjs';
import { contentFingerprint } from '../public/state-content.mjs';
function cloudClient(db, saved = new Map(), options = {}) {
  let online = true;
  const client = new CloudSync({ storage: { getItem: key => saved.get(key), setItem: (key,value) => saved.set(key,value) }, fetcher: async (url, settings) => {
    if (!online) throw new Error('offline');
    assert.equal(new Headers(settings?.headers).has('authorization'), false);
    return worker.fetch(new Request(url, settings), env(db));
  }, ...options });
  return { client, saved, offline() { online = false; }, online() { online = true; } };
}
const idle = async client => { while (client.running) await new Promise(r => setTimeout(r, 1)); };
const changed = title => { const s = createInitialState(); s.competitions[0].title = title; return s; };
test('打开页面自动读取云端；空库不会写入默认数据；导入历史可续传', async () => {
  const db = database(); let loaded;
  const { client } = cloudClient(db, new Map(), { onState: s => loaded = s });
  await client.start(createInitialState());
  assert.equal((await get(db, '?history=1')).items.length, 0);
  const state = changed('正式数据');
  const records = [1,2].map(n => ({ submission_id: `local-${n}`, action: `修改${n}`, state, created_at: '2026-10-29T10:00:00.000Z' }));
  await client.archiveRecords(records); client.enqueue(state, '迁移当前数据'); await idle(client);
  await client.archiveRecords(records);
  assert.equal((await get(db, '?history=1')).items.length, 3);
  assert.deepEqual((await get(db)).state, state);
  assert.equal((await get(db, '?revision=1')).created_at, '2026-10-29T10:00:00.000Z');
  await client.start(createInitialState()); assert.deepEqual(loaded, state);
});
test('离线提交刷新后按顺序补传；初始化失败不会覆盖云端', async () => {
  const db = database(); const c = cloudClient(db); await c.client.start(createInitialState());
  c.offline();
  for (let i = 0; i < 3; i++) c.client.enqueue(changed(`offline ${i}`), '离线修改');
  await idle(c.client); assert.equal(c.client.queue.length, 3);
  const restored = cloudClient(db, c.saved); await restored.client.start(createInitialState()); await idle(restored.client);
  assert.equal(restored.client.queue.length, 0); assert.equal((await get(db, '?history=1')).items.length, 3);
  assert.equal((await get(db)).state.competitions[0].title, 'offline 2');
  const failed = cloudClient(db); failed.offline(); assert.equal(await failed.client.start(createInitialState()), false);
  assert.equal(failed.client.ready, false); assert.equal((await get(db)).revision, 3);
});
test('并发修改归档冲突，选用云端时保留所有待同步快照', async () => {
  const db = database(); let loaded;
  const a = cloudClient(db).client, b = cloudClient(db, new Map(), { onState: s => loaded = s }).client;
  await a.start(createInitialState()); await b.start(createInitialState());
  a.enqueue(changed('A'), '设备 A'); await idle(a);
  b.enqueue(changed('B1'), '设备 B 第一次'); b.enqueue(changed('B2'), '设备 B 第二次'); await idle(b);
  assert.equal(b.conflict, true);
  await b.resolve(false);
  assert.equal(b.queue.length, 0); assert.equal(b.conflict, false); assert.equal(loaded.competitions[0].title, 'A');
  const history = (await get(db, '?history=1')).items;
  assert.equal(history.length, 3); assert.equal(history.filter(r => !r.applied).length, 2);
});
test('前端与后端均忽略赛事切换、对象键顺序和旧版格式标记', async () => {
  const db = database(); const state = createInitialState(); await post(db, submit('initial', 0, state));
  const c = cloudClient(db); await c.client.start(state);
  const other = structuredClone(state); other.activeCompetitionId = other.competitions[1].id;
  other.revision = 3; other.competitions.forEach(item => delete item.format);
  assert.equal(c.client.enqueue(other, '切换赛事'), false);
  assert.equal(c.client.queue.length, 0);
  const response = await (await post(db, submit('no-op', 0, other))).json();
  assert.equal(response.unchanged, true); assert.equal(response.revision, 1);
  assert.equal((await get(db, '?history=1')).items.length, 1);
  const reordered = Object.fromEntries(Object.entries(state).reverse());
  assert.equal(contentFingerprint(reordered), contentFingerprint(state));
});
test('同时提交相同内容只生成一个版本，改回原值仍属于真正修改', async () => {
  const db = database(); const state = changed('new');
  const results = await Promise.all(['a','b','c'].map(id => post(db, submit(id, 0, state))));
  assert.ok(results.every(r => r.status === 200));
  assert.equal((await get(db, '?history=1')).items.length, 1);
  await post(db, submit('revert', 1, createInitialState()));
  assert.equal((await get(db, '?history=1')).items.length, 2);
});
test('旧历史不回填或删除，也能比较内容去重', async () => {
  const db = database(); const state = createInitialState();
  await db.prepare('INSERT INTO submissions (submission_id,base_revision,action,state,applied,created_at) VALUES (?,?,?,?,?,?)').bind('old',0,'切换赛事',JSON.stringify(state),1,'2026-10-29T10:00:00Z').run();
  assert.equal((await (await post(db, submit('new',1,state))).json()).unchanged, true);
  assert.equal((await get(db, '?history=1')).items.length, 1);
});
test('新增第三项赛事可往返保存，重置仅清空自定义赛事成绩', async () => {
  const db = database(); const state = createInitialState();
  const item = createCompetition({ name: '2027北大杯', format: 'league', date: '2027-03-01' });
  item.groups[0].teams.push(structuredClone(state.competitions[0].groups[0].teams[0]));
  item.groups[0].teams[0].base.played = 3;
  state.competitions.push(item); state.activeCompetitionId = item.id;
  assert.equal(validSnapshot(state), true);
  assert.equal((await post(db, submit('third',0,state))).status, 200);
  assert.deepEqual((await get(db)).state, state);
  const reset = resetCompetition(item);
  assert.equal(reset.groups[0].teams[0].base.played, 0);
  assert.equal(reset.groups[0].teams[0].name, item.groups[0].teams[0].name);
  assert.equal(reset.id, item.id); assert.equal(item.groups[0].teams[0].base.played, 3);
});
test('刷新自动跟随云端更新，不反复渲染相同内容', async () => {
  const db = database(); let calls = 0;
  await post(db, submit('seed'));
  const c = cloudClient(db, new Map(), { onState: () => calls++ }).client;
  await c.start(createInitialState()); assert.equal(calls, 1);
  await c.refresh(); assert.equal(calls, 1);
  await post(db, submit('update',1,changed('remote')));
  await c.refresh(); assert.equal(calls, 2); assert.equal(c.revision, 2);
});
test('刷新请求等待期间发生编辑，不覆盖本机新修改', async () => {
  let release; let delayed = false; let loaded = 0;
  const client = new CloudSync({ storage: { getItem: () => null, setItem() {} }, onState: () => loaded++, fetcher: async (_, options) => {
    if (options.method === 'POST') throw new Error('offline');
    if (delayed) await new Promise(r => release = r);
    return Response.json({ revision: 1, state: changed('remote') });
  } });
  await client.start(createInitialState()); delayed = true;
  const pending = client.refresh(); client.enqueue(changed('draft'), '编辑'); release(); await pending; await idle(client);
  assert.equal(loaded, 1); assert.equal(client.queue.at(-1).state.competitions[0].title, 'draft');
});

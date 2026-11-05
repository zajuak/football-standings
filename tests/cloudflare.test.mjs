import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createInitialState, createCompetition, createCompetitionSeason, createResult, migrateState, resetCompetition } from '../public/core.mjs';
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


test('不支持 AbortSignal.timeout 的旧版手机浏览器仍能读取并保存云端', async t => {
  const timeout = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout');
  Object.defineProperty(AbortSignal, 'timeout', { configurable: true, value: undefined });
  t.after(() => Object.defineProperty(AbortSignal, 'timeout', timeout));
  const db = database(); const { client } = cloudClient(db);
  assert.equal(await client.start(createInitialState()), true);
  client.enqueue(changed('手机修改'), '手机编辑'); await idle(client);
  assert.equal(client.queue.length, 0); assert.equal((await get(db)).state.competitions[0].title, '手机修改');
});
test('接口网络错误显示连通性提示，并保留待同步数据', async () => {
  let offline = false, status;
  const client = new CloudSync({ storage: { getItem: () => null, setItem() {} }, onStatus: message => status = message, fetcher: async () => {
    if (offline) throw new TypeError('Load failed');
    return Response.json({ revision: 0, state: null });
  } });
  await client.start(createInitialState()); offline = true;
  client.enqueue(changed('离线手机修改'), '手机编辑'); await idle(client);
  assert.equal(client.queue.length, 1); assert.match(status, /无法访问云端接口/); assert.match(status, /连通性检查/);
});
test('网络超时会终止请求并给出可理解的提示', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let status;
  const client = new CloudSync({ storage: { getItem: () => null, setItem() {} }, onStatus: message => status = message, fetcher: (_, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  }) });
  const started = client.start(createInitialState());
  t.mock.timers.tick(15000);
  assert.equal(await started, false); assert.equal(client.ready, false); assert.match(status, /连接云端超时/);
});

test('历史合并忽略浏览偏好并兼容旧记录，保留原始导出和 A→B→A 的真实变化', async () => {
  const db = database();
  const old = createInitialState(); old.revision = 3; old.competitions.forEach(c => delete c.format);
  await db.prepare('INSERT INTO submissions (submission_id,base_revision,action,state,applied,created_at) VALUES (?,?,?,?,?,?)').bind('legacy',0,'旧版本',JSON.stringify(old),1,'2026-10-29T10:00:00Z').run();
  const same = createInitialState(); same.activeCompetitionId = same.competitions[1].id;
  await post(db, { ...submit('archived-copy',0,same), archiveOnly: true });
  await post(db, submit('B',1,changed('实际变化')));
  await post(db, submit('back-to-A',3,createInitialState()));
  const history = await get(db, '?history=1&distinct=1');
  assert.deepEqual(history.items.map(item => item.revision), [4,3,2]);
  assert.equal(history.items[2].duplicateCount, 1);
  assert.equal((await get(db, '?history=1&full=1')).items.length, 4);
  assert.deepEqual((await get(db, '?revision=1')).state, old);
});
test('历史合并跨原始批次和分页边界不漏项，也不重复展示相同内容', async () => {
  const db = database();
  // The newest page ends with a long identical run crossing multiple SQL batches.
  for (let i = 0; i < 120; i++) {
    await post(db, { ...submit(`duplicate-${i}`,0,changed('最早的一组')), archiveOnly: true });
  }
  for (let i = 0; i < 51; i++) {
    await post(db, { ...submit(`distinct-${i}`,0,changed(`内容${i}`)), archiveOnly: true });
  }
  const first = await get(db, '?history=1&distinct=1');
  assert.equal(first.items.length, 50); assert.equal(first.next, 122);
  const second = await get(db, `?history=1&distinct=1&before=${first.next}`);
  assert.deepEqual(second.items.map(item => item.revision), [121,120]);
  assert.equal(second.items[1].duplicateCount, 119); assert.equal(second.next, null);
  // Place the identical run at the page boundary to exercise the anchor hash.
  const boundary = await get(db, '?history=1&distinct=1&before=120');
  assert.deepEqual(boundary.items, []); assert.equal(boundary.next, null);
  const raw = await get(db, '?history=1&full=1'); assert.equal(raw.items.length, 50);
});


test('云端往返保存空赛季与排位赛，编辑排位赛不会改动原赛季赛果', async () => {
  const db = database(), state = createInitialState();
  const before = structuredClone(state.competitions[0].matches);
  const season = createCompetitionSeason(state.competitions[0], '2027-28');
  assert.equal((await post(db, submit('empty-season',0,state))).status, 200);
  assert.deepEqual((await get(db)).state, state);
  season.placement.groups.push({ id: 'pg', name: '排位A组', teams: structuredClone(state.competitions[0].groups[0].teams.slice(0,2)) });
  season.placement.matches.push(createResult(season.placement,{groupId:'pg',homeId:season.placement.groups[0].teams[0].id,awayId:season.placement.groups[0].teams[1].id,homeScore:2,awayScore:1}));
  assert.equal((await post(db, submit('placement-result',1,state))).status, 200);
  const saved = (await get(db)).state;
  assert.deepEqual(saved.competitions[0].matches,before);
  assert.equal(saved.competitions[0].additionalSeasons[0].placement.matches.length,1);
  assert.equal(saved.competitions[0].additionalSeasons[0].matches.length,0);
});
test('云端拒绝不连续赛季和排位赛中引用其他阶段球队的无效赛果', async () => {
  const db = database(), state = createInitialState();
  createCompetitionSeason(state.competitions[0], '2027-28');
  const invalid = structuredClone(state); invalid.competitions[0].additionalSeasons[0].season='2027-30';
  assert.equal((await post(db, submit('bad-season',0,invalid))).status,400);
  const invalidType=structuredClone(state); invalidType.competitions[0].season=['2026-27'];
  assert.equal((await post(db, submit('bad-season-type',0,invalidType))).status,400);
  const missingBase=structuredClone(state); delete missingBase.competitions[0].season;
  assert.equal((await post(db, submit('missing-base-season',0,missingBase))).status,400);
  const invalidStage=structuredClone(state);
  invalidStage.competitions[0].additionalSeasons[0].placement.matches.push(structuredClone(state.competitions[0].matches[0]));
  assert.equal((await post(db, submit('bad-stage',0,invalidStage))).status,400);
  const duplicate=structuredClone(state); duplicate.competitions[0].additionalSeasons[0].season='2026-27';
  assert.equal((await post(db, submit('duplicate-season',0,duplicate))).status,400);
  assert.equal((await get(db,'?history=1')).items.length,0);
});
test('新增赛季结构兼容旧哈希，纯格式升级不写入重复版本', async () => {
  const db=database(), legacy=createInitialState();
  for (const item of legacy.competitions) { delete item.season;delete item.placement;delete item.additionalSeasons; }
  await db.prepare('INSERT INTO submissions (submission_id,base_revision,action,state,applied,created_at,content_hash) VALUES (?,?,?,?,?,?,?)').bind('old-hash',0,'旧版本',JSON.stringify(legacy),1,'2026-10-29T10:00:00Z','f'.repeat(64)).run();
  const upgraded=migrateState(structuredClone(legacy));
  assert.equal((await (await post(db,submit('format-upgrade',1,upgraded))).json()).unchanged,true);
  await post(db,{...submit('archive-upgrade',0,upgraded),archiveOnly:true});
  const history=await get(db,'?history=1&distinct=1');
  assert.equal(history.items.length,1);assert.equal(history.items[0].duplicateCount,1);
  assert.deepEqual((await get(db,'?revision=1')).state,legacy);
});

test('淘汰赛分赛季完整保存并拒绝破坏对阵结构的数据', async () => {
  const {setKnockoutTeam,setKnockoutScore}=await import('../public/knockout.mjs');
  const db=database();const state=createInitialState();
  await post(db,submit('knockout-base',0,state));
  const season=createCompetitionSeason(state.competitions[0],'2027-28');
  setKnockoutTeam(season.knockout,{matchId:'men-r12-1',name:'甲'});
  setKnockoutTeam(season.knockout,{matchId:'men-r12-1',side:'away',name:'乙'});
  setKnockoutScore(season.knockout,'men-r12-1',0,'home',2);setKnockoutScore(season.knockout,'men-r12-1',0,'away',1);
  assert.equal((await post(db,submit('knockout-edit',1,state))).status,200);
  const loaded=(await get(db)).state;
  assert.deepEqual(loaded,state);
  assert.equal(loaded.competitions[0].knockout.rounds[0].matches[0].homeName,'');
  const mutations=[
    k=>k.rounds.pop(),
    k=>k.rounds[1].matches[0].homeSource={winner:'missing'},
    k=>k.rounds[1].matches[0].homeSource={winner:'men-final'},
    k=>k.rounds[1].matches[0].awaySource=[],
    k=>k.rounds[0].matches[1].id=k.rounds[0].matches[0].id,
    k=>k.rounds[0].matches[0].legs=[],
    k=>k.rounds[0].matches[0].homeName='x'.repeat(31),
    k=>k.rounds[0].byes[0].name='甲',
    k=>k.rounds[0].matches[0].tiebreakWinner='away',
    k=>k.rounds[2].matches[0].legs[0].homeScore=1,
  ];
  for(const [i,mutate] of mutations.entries()) {
    const invalid=structuredClone(state);mutate(invalid.competitions[0].additionalSeasons[0].knockout);
    assert.equal((await post(db,submit(`invalid-knockout-${i}`,2,invalid))).status,400,`invalid knockout ${i}`);
  }
  assert.equal((await get(db,'?history=1')).items.length,2);
});

test('淘汰赛兼容升级不改写旧数据，旧赛季哈希与新空对阵仍合并比对', async () => {
  const {contentHash,CONTENT_HASH_PREFIX}=await import('../public/state-content.mjs');
  const db=database();const old=createInitialState();for(const c of old.competitions)delete c.knockout;
  const oldHash='seasons-v1:'+ 'b'.repeat(64);
  await db.prepare('INSERT INTO submissions(submission_id,base_revision,action,state,applied,created_at,content_hash) VALUES(?,?,?,?,?,?,?)').bind('before-knockout',0,'旧数据',JSON.stringify(old),1,'2026-11-02T00:00:00Z',oldHash).run();
  const upgraded=migrateState(structuredClone(old));
  const response=await(await post(db,submit('upgrade-no-op',1,upgraded))).json();
  assert.equal(response.unchanged,true);
  assert.deepEqual((await get(db,'?revision=1')).state,old);
  await post(db,{...submit('archive-upgraded',1,upgraded),archiveOnly:true});
  const history=await get(db,'?history=1&distinct=1');
  assert.equal(history.items.length,1);assert.equal(history.items[0].duplicateCount,1);
  assert.ok((await contentHash(upgraded)).startsWith(CONTENT_HASH_PREFIX));
  assert.notEqual(CONTENT_HASH_PREFIX,'seasons-v1:');
});

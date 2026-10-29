import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../public/core.mjs';
import { LocalHistory, LOCAL_QUEUE_KEY } from '../public/local-history.mjs';
class MemoryArchive {
  rows = [];
  async append(item) {
    const saved = this.rows.find(r => r.submission_id === item.id);
    if (saved) return saved.revision;
    const revision = this.rows.length + 1;
    this.rows.push({ revision, submission_id: item.id, state: structuredClone(item.state), action: item.action, created_at: item.createdAt, applied: 1 });
    return revision;
  }
  async latest() { return this.rows.at(-1) ?? null; }
  async get(id) { return this.rows.find(r => r.revision === id); }
  async list(before, full) {
    const items = this.rows.filter(r => r.revision < before).slice().reverse().slice(0, 50).map(r => full ? structuredClone(r) : { ...r, state: undefined });
    return { items, next: items.length === 50 ? items.at(-1).revision : null };
  }
}
function setup(archive = new MemoryArchive(), map = new Map()) {
  const c = new LocalHistory({ archive, storage: { getItem: k => map.get(k), setItem: (k, v) => map.set(k, v) } });
  return { c, archive, map };
}
async function idle(c) { while (c.running) await new Promise(r => setTimeout(r, 1)); }

test('本机每次保存都产生快照，删除后旧赛果仍可恢复', async () => {
  const { c, archive } = setup(); await c.init(createInitialState()); await idle(c);
  const modified = createInitialState(); modified.competitions[0].matches.pop();
  c.enqueue(modified, '删除赛果'); await idle(c);
  assert.equal(archive.rows.length, 2);
  assert.equal((await c.request('?revision=1')).state.competitions[0].matches.length, 16);
  assert.equal((await c.request()).state.competitions[0].matches.length, 15);
});
test('刷新读取最新历史，不用默认数据覆盖已有记录', async () => {
  const { c, archive, map } = setup(); await c.init(createInitialState()); await idle(c);
  const changed = createInitialState(); changed.competitions[0].title = '本机正式标题'; c.enqueue(changed, '修改标题'); await idle(c);
  let restored;
  const next = new LocalHistory({ archive, storage: { getItem: k => map.get(k), setItem: (k,v) => map.set(k,v) }, onState: s => restored = s });
  await next.init(createInitialState());
  assert.equal(restored.competitions[0].title, '本机正式标题'); assert.equal(archive.rows.length, 2);
});
test('存档失败保留队列，刷新后逐条重试，不重复保存', async () => {
  const archive = new MemoryArchive(); const map = new Map();
  const state = createInitialState();
  map.set(LOCAL_QUEUE_KEY, JSON.stringify([{ id: 'one', state, action: '原有提交', createdAt: new Date().toISOString() }]));
  await archive.append(JSON.parse(map.get(LOCAL_QUEUE_KEY))[0]);
  const { c } = setup(archive, map); await c.init(state); await idle(c);
  assert.equal(c.queue.length, 0); assert.equal(archive.rows.length, 1);
});
test('完整历史分页不会截断 50 条以后的记录', async () => {
  const { c } = setup(); await c.init(createInitialState()); await idle(c);
  for (let i = 0; i < 53; i++) c.enqueue(createInitialState(), `保存 ${i}`);
  await idle(c);
  const first = await c.request('?history=1&full=1');
  const second = await c.request(`?history=1&full=1&before=${first.next}`);
  assert.equal(first.items.length, 50); assert.equal(second.items.length, 4); assert.equal(second.next, null);
});
test('完整备份可以导回所有历史，重复导入不重复追加旧记录', async () => {
  const { c: original } = setup(); await original.init(createInitialState()); await idle(original);
  original.enqueue(createInitialState(), '第二次'); await idle(original);
  const items = (await original.request('?history=1&full=1')).items.reverse();
  const { c, archive } = setup(); await c.init(createInitialState()); await idle(c);
  await c.importHistory(items); await c.importHistory(items);
  assert.equal(archive.rows.length, 3); assert.equal(archive.rows[1].action, '导入历史：首次保存本机数据');
});

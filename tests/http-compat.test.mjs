import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256 } from '../public/sha256.mjs';
import { CloudSync } from '../public/cloud-sync.mjs';
import { createInitialState } from '../public/core.mjs';

test('HTTP 缺少 Web Crypto 时口令、中文和跨块 SHA-256 与原生结果一致', async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  t.after(() => Object.defineProperty(globalThis, 'crypto', original));
  const values = ['', 'abc', 'PKUFA2026', '北京大学足球协会⚽', ...[55,56,63,64,65,1000].map(n => 'a'.repeat(n))];
  const native = await Promise.all(values.map(sha256));
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} });
  for (const [i,value] of values.entries()) {
    assert.equal(await sha256(value), createHash('sha256').update(value).digest('hex'));
    assert.equal(await sha256(value), native[i]);
  }
  assert.equal(await sha256('PKUFA2026'), '5c165cb2e7df0bfc1a090fad2e6e1fcd32f76b2d0eff4727ffa3e8db71e6a9a0');
});

test('HTTP 下导入历史仍使用相同的提交编号，重复导入可以安全续传', async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  t.after(() => Object.defineProperty(globalThis, 'crypto', original));
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} });
  const sent = [];
  const sync = new CloudSync({ storage: { getItem: () => null, setItem() {} }, fetcher: async (url, options) => {
    sent.push(JSON.parse(options.body));
    return Response.json({ revision: 1 });
  } });
  sync.ready = true;
  const records = [{ submission_id: '原始记录', state: createInitialState(), action: '历史导入' }];
  await sync.archiveRecords(records); await sync.archiveRecords(records);
  assert.equal(sent[0].id, 'import-' + createHash('sha256').update('原始记录').digest('hex'));
  assert.equal(sent[1].id, sent[0].id);
  assert.equal(sent[0].archiveOnly, true);
});

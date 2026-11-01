import test from 'node:test';
import assert from 'node:assert/strict';
import { interactionState } from '../public/interaction-state.mjs';

test('手机首次连接失败不锁定浏览，也不允许未确认的数据写入', () => {
  for (const authenticated of [false, true]) {
    const state = interactionState({ authenticated, cloudLoaded: false, busy: false });
    assert.equal(state.browseBlocked, false);
    assert.equal(state.canEdit, false);
    assert.match(state.notice, /可切换赛事/);
    if (authenticated) assert.match(state.mode, /等待云端/);
  }
});
test('云端连接完成后按口令权限启用编辑，退出后仍可浏览', () => {
  assert.equal(interactionState({ authenticated: true, cloudLoaded: true }).canEdit, true);
  const readonly = interactionState({ authenticated: false, cloudLoaded: true });
  assert.equal(readonly.canEdit, false); assert.equal(readonly.browseBlocked, false);
});
test('仅实际导入恢复期间暂停页面操作，完成后解除', () => {
  const busy = interactionState({ authenticated: true, cloudLoaded: true, busy: true });
  assert.equal(busy.canEdit, false); assert.equal(busy.browseBlocked, true);
  assert.equal(interactionState({ authenticated: true, cloudLoaded: true, busy: false }).browseBlocked, false);
});

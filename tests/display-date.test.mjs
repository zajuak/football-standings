import test from 'node:test';
import assert from 'node:assert/strict';
import { currentDisplayDate } from '../public/display-date.mjs';
import { createInitialState } from '../public/core.mjs';
import { buildPoster, buildKnockoutPoster } from '../public/poster.mjs';
import { contentFingerprint } from '../public/state-content.mjs';

test('显示日期按北京时间跨日，包含跨年与闰日边界', () => {
  for (const [instant, expected] of [
    ['2026-11-14T15:59:59Z', '2026-11-14'],
    ['2026-11-14T16:00:00Z', '2026-11-15'],
    ['2026-12-31T16:00:00Z', '2027-01-01'],
    ['2028-02-28T16:00:00Z', '2028-02-29'],
  ]) assert.equal(currentDisplayDate(new Date(instant)), expected);
});

test('男女足、排位赛、组间比较和淘汰赛均显示当天，且不改动原始数据', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-14T16:30:00Z') });
  const state = createInitialState(), original = structuredClone(state);
  const before = contentFingerprint(state);
  for (const item of state.competitions) {
    for (const stage of [item, item.placement]) assert.match(buildPoster(stage).svg, />2026年11月15日</);
    assert.match(buildPoster(item, '', { mode: 'cross-group' }).svg, />2026年11月15日</);
    assert.match(buildKnockoutPoster(item.knockout).svg, />2026年11月15日</);
  }
  assert.deepEqual(state, original);
  assert.equal(contentFingerprint(state), before);
});

test('跨过北京时间午夜后再次生成导出图片会采用新日期', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-15T15:59:59Z') });
  const current = createInitialState().competitions[0];
  assert.match(buildPoster(current).svg, />2026年11月15日</);
  t.mock.timers.setTime(Date.parse('2026-11-15T16:00:00Z'));
  assert.match(buildPoster(current).svg, />2026年11月16日</);
  assert.match(buildKnockoutPoster(current.knockout).svg, />2026年11月16日</);
  assert.equal(current.date, '2026-10-29');
});

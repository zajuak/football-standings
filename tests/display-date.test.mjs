import test from 'node:test';
import assert from 'node:assert/strict';
import { currentDisplayDate, DisplayDateSelection } from '../public/display-date.mjs';
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

test('默认日期随当天更新，自选日期按赛事阶段保留，恢复今天后继续自动更新', () => {
  const dates = new DisplayDateSelection();
  const beforeMidnight = new Date('2026-11-15T15:59:59Z');
  const afterMidnight = new Date('2026-11-15T16:00:00Z');
  assert.equal(dates.get('men:2026:group', beforeMidnight), '2026-11-15');
  assert.equal(dates.get('men:2026:group', afterMidnight), '2026-11-16');
  dates.select('men:2026:group', '2026-10-31', beforeMidnight);
  assert.equal(dates.get('men:2026:group', afterMidnight), '2026-10-31');
  assert.equal(dates.get('men:2026:knockout', afterMidnight), '2026-11-16');
  assert.equal(dates.get('women:2026:group', afterMidnight), '2026-11-16');
  dates.select('men:2026:group', '', beforeMidnight);
  assert.equal(dates.get('men:2026:group', afterMidnight), '2026-11-16');
  dates.select('men:2026:group', '2026-10-31', beforeMidnight);
  dates.select('men:2026:group', '2026-11-15', beforeMidnight);
  assert.equal(dates.get('men:2026:group', afterMidnight), '2026-11-16');
});

test('无效日期不能覆盖已有选择', () => {
  const dates = new DisplayDateSelection();
  dates.select('group', '2028-02-29');
  for (const invalid of ['2026-02-29', '2026-13-01', '2026-11-31', 'invalid']) {
    assert.throws(() => dates.select('group', invalid), /请选择有效日期/);
    assert.equal(dates.get('group'), '2028-02-29');
  }
});

test('自选日期应用到所有预览和导出，且不改动历史数据或提交指纹', () => {
  const state = createInitialState(), original = structuredClone(state);
  const before = contentFingerprint(state);
  const date = '2026-10-31';
  for (const item of state.competitions) {
    for (const stage of [item, item.placement]) assert.match(buildPoster(stage, '', { date }).svg, />2026年10月31日</);
    assert.match(buildPoster(item, '', { mode: 'cross-group', date }).svg, />2026年10月31日</);
    assert.match(buildKnockoutPoster(item.knockout, { date }).svg, />2026年10月31日</);
  }
  assert.deepEqual(state, original);
  assert.equal(contentFingerprint(state), before);
});

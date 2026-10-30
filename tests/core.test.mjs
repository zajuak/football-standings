import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCrossGroupStandings, calculateMatchFairPlay, calculateStandings,
  createInitialState, createResult, formatChineseDate, formatFairPlay, getActiveCompetition,
  getMatchFairPlay, migrateState, updateResult,
} from '../public/core.mjs';
import { contentFingerprint } from '../public/state-content.mjs';
import { buildPoster } from '../public/poster.mjs';

const zero = () => ({ played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 });
const base = (played, wins, draws, losses, goalsFor, goalsAgainst) => ({ played, wins, draws, losses, goalsFor, goalsAgainst });
const team = (id, name, initial = zero(), fairPlay = 5) => ({ id, name, base: initial, fairPlay, disciplineDeduction: 0 });
const competitionOf = (teams, matches = []) => ({ groups: [{ id: 'g', name: 'A组', teams }], matches });
const result = (homeId, awayId, homeScore, awayScore) => ({ id: `${homeId}-${awayId}`, groupId: 'g', homeId, awayId, homeScore, awayScore });

function menCompetition() {
  return getActiveCompetition(createInitialState());
}

test('男足初始数据包含前三轮 16 场赛果并正确计算', () => {
  const competition = menCompetition();
  const standings = calculateStandings(competition);
  assert.equal(competition.matches.length, 16);
  assert.equal(standings.length, 5);
  assert.equal(standings.flatMap(group => group.rows).length, 18);
  assert.deepEqual(
    standings[0].rows.map(row => [row.name, row.points, row.goalDifference]),
    [['信科', 6, 10], ['城环', 3, 2], ['元培', 3, 1], ['心艺哲', 0, -13]],
  );
  assert.deepEqual(standings[1].rows.map(row => row.name), ['医学', '物理', '外院', '法学']);
  assert.equal(standings[4].rows[0].name, '工学');
  assert.equal(standings[4].rows[0].goalsFor, 22);
  assert.equal(standings[0].rows[0].fairPlay, 3.5);
});

test('女足初始数据包含 8 支球队和第二周 3 场赛果', () => {
  const state = createInitialState();
  state.activeCompetitionId = 'women-pku-cup';
  const competition = getActiveCompetition(state);
  const standings = calculateStandings(competition);
  assert.equal(competition.matches.length, 3);
  assert.deepEqual(standings[0].rows.map(row => [row.name, row.points]), [
    ['医学', 3], ['中历外', 3], ['理叉地', 1], ['政信社', 1], ['工数', 0], ['国光', 0], ['城新考', 0], ['元培', 0],
  ]);
});

test('旧版本数据升级时补充女足新球队并保留已有修改', () => {
  const state = createInitialState();
  const women = state.competitions.find(item => item.id === 'women-pku-cup');
  women.title = '已修改的女足标题';
  women.groups[0].teams = women.groups[0].teams.filter(item => !['women-gongshu', 'women-guoguang'].includes(item.id));
  state.revision = 2;
  migrateState(state);
  assert.equal(state.revision, 4);
  assert.equal(women.title, '已修改的女足标题');
  assert.equal(women.matches.length, 3);
  assert.deepEqual(women.groups[0].teams.slice(-2).map(item => item.name), ['工数', '国光']);
  women.groups[0].teams = women.groups[0].teams.filter(item => item.id !== 'women-gongshu');
  migrateState(state);
  assert.equal(women.groups[0].teams.length, 7);
});

test('录入胜利赛果后同时更新双方全部统计', () => {
  const competition = menCompetition();
  competition.matches.push(createResult(competition, {
    groupId: 'men-a', homeId: 'men-xinke', awayId: 'men-chenghuan', homeScore: 2, awayScore: 1,
  }));
  const rows = calculateStandings(competition)[0].rows;
  const home = rows.find(row => row.id === 'men-xinke');
  const away = rows.find(row => row.id === 'men-chenghuan');
  assert.deepEqual(
    [home.played, home.points, home.wins, home.goalsFor, home.goalsAgainst, home.goalDifference],
    [3, 9, 3, 13, 2, 11],
  );
  assert.deepEqual(
    [away.played, away.points, away.losses, away.goalsFor, away.goalsAgainst, away.goalDifference],
    [2, 3, 1, 4, 3, 1],
  );
});

test('平局各得一分，删除赛果后恢复初始统计', () => {
  const competition = menCompetition();
  const match = createResult(competition, {
    groupId: 'men-d', homeId: 'men-shuxue', awayId: 'men-shengke', homeScore: 2, awayScore: 2,
  });
  competition.matches.push(match);
  let rows = calculateStandings(competition)[3].rows;
  assert.equal(rows.find(row => row.id === 'men-shuxue').points, 4);
  assert.equal(rows.find(row => row.id === 'men-shengke').points, 1);
  competition.matches = competition.matches.filter(item => item.id !== match.id);
  rows = calculateStandings(competition)[3].rows;
  assert.equal(rows.find(row => row.id === 'men-shuxue').points, 3);
  assert.equal(rows.find(row => row.id === 'men-shengke').played, 0);
});

test('红黄牌按四种情形扣分，总积分取所有场次平均后再减纪律扣分', () => {
  const competition = menCompetition();
  const cards = { yellow: 2, secondYellowRed: 1, directRed: 1, yellowDirectRed: 1 };
  assert.equal(calculateMatchFairPlay(cards), -9);
  competition.matches.push(createResult(competition, {
    groupId: 'men-a', homeId: 'men-xinke', awayId: 'men-chenghuan', homeScore: 2, awayScore: 1,
    homeCards: cards,
    awayCards: { yellow: 1, secondYellowRed: 0, directRed: 0, yellowDirectRed: 0 },
  }));
  competition.groups[0].teams.find(item => item.id === 'men-xinke').disciplineDeduction = 2;
  const rows = calculateStandings(competition)[0].rows;
  const home = rows.find(row => row.id === 'men-xinke');
  const away = rows.find(row => row.id === 'men-chenghuan');
  assert.equal(home.fairPlayBeforeDiscipline, -2 / 3);
  assert.equal(home.fairPlay, -8 / 3);
  assert.equal(away.fairPlayBeforeDiscipline, 4.5);
  assert.equal(formatFairPlay(home.fairPlay), '-2.67');
});

test('红黄牌数量必须为非负整数', () => {
  const competition = menCompetition();
  assert.throws(() => createResult(competition, {
    groupId: 'men-a', homeId: 'men-xinke', awayId: 'men-chenghuan', homeScore: 1, awayScore: 0,
    homeCards: { yellow: -1 },
  }), /红黄牌数量/);
  assert.throws(() => createResult(competition, {
    groupId: 'men-a', homeId: 'men-xinke', awayId: 'men-chenghuan', homeScore: 1, awayScore: 0,
    awayCards: { directRed: 0.5 },
  }), /红黄牌数量/);
});

test('两队同分时相互比赛积分优先于总净胜球', () => {
  const competition = competitionOf([
    team('a', '甲', base(1, 1, 0, 0, 5, 0)),
    team('b', '乙'),
    team('c', '丙'),
  ], [result('a', 'b', 0, 1)]);
  const rows = calculateStandings(competition)[0].rows;
  assert.equal(rows.find(row => row.id === 'a').goalDifference, 4);
  assert.equal(rows.find(row => row.id === 'b').goalDifference, 1);
  assert.deepEqual(rows.map(row => row.name), ['乙', '甲', '丙']);
});

test('三队同分时先比较相关球队比赛积分', () => {
  const competition = competitionOf([
    team('a', '甲'),
    team('b', '乙', base(1, 1, 0, 0, 3, 0)),
    team('c', '丙', base(2, 0, 2, 0, 2, 2)),
  ], [result('a', 'b', 2, 0), result('a', 'c', 1, 1), result('b', 'c', 0, 0)]);
  assert.deepEqual(calculateStandings(competition)[0].rows.map(row => row.name), ['甲', '丙', '乙']);
});

test('三队小联赛仍同分同净胜球时比较相关球队进球数', () => {
  const competition = competitionOf([
    team('a', '甲'),
    team('b', '乙', base(1, 0, 0, 1, 0, 5)),
    team('c', '丙'),
  ], [result('a', 'b', 2, 0), result('b', 'c', 3, 0), result('c', 'a', 1, 0)]);
  const rows = calculateStandings(competition)[0].rows;
  assert.equal(rows.find(row => row.id === 'a').goalDifference, 1);
  assert.equal(rows.find(row => row.id === 'b').goalDifference, -4);
  assert.deepEqual(rows.map(row => row.name), ['乙', '甲', '丙']);
});

test('总指标仍相同时比较公平竞赛积分及纪律扣分', () => {
  const competition = competitionOf([team('1', '甲'), team('2', '乙', zero(), 4)]);
  assert.deepEqual(calculateStandings(competition)[0].rows.map(row => row.name), ['甲', '乙']);
  competition.groups[0].teams[0].disciplineDeduction = 2;
  assert.deepEqual(calculateStandings(competition)[0].rows.map(row => row.name), ['乙', '甲']);
});

test('所有指标仍相同时使用可选抽签顺序', () => {
  const competition = competitionOf([team('1', '甲'), team('2', '乙')]);
  assert.deepEqual(calculateStandings(competition)[0].rows.map(row => row.name), ['甲', '乙']);
  competition.groups[0].teams[0].drawOrder = 2;
  competition.groups[0].teams[1].drawOrder = 1;
  assert.deepEqual(calculateStandings(competition)[0].rows.map(row => row.name), ['乙', '甲']);
});

test('组间排名剔除较多球队小组与本组末位的比赛且不影响公平竞赛积分', () => {
  const competition = menCompetition();
  const rows = calculateCrossGroupStandings(competition, 0);
  assert.deepEqual(rows.map(row => row.name), ['光华', '医学', '工学', '数学', '信科']);
  const xinke = rows.find(row => row.name === '信科');
  assert.equal(xinke.points, 3);
  assert.equal(xinke.goalsFor, 3);
  assert.equal(xinke.fairPlay, 3.5);
});

test('修改赛果覆盖原比赛并保留轮次、ID和未修改的公平竞赛积分', () => {
  const competition = menCompetition();
  const original = competition.matches.find(match => match.id === 'men-r1-yuanpei-xinke');
  const updated = updateResult(competition, original.id, {
    groupId: 'men-a', homeId: 'men-yuanpei', awayId: 'men-xinke', homeScore: 1, awayScore: 4,
    homeCards: {}, awayCards: {}, homeFairPlay: 5, awayFairPlay: 2,
  });
  competition.matches = competition.matches.map(match => match.id === original.id ? updated : match);
  assert.equal(competition.matches.length, 16);
  assert.equal(updated.id, original.id);
  assert.equal(updated.round, '第一轮');
  assert.equal(getMatchFairPlay(updated, 'away'), 2);
  assert.equal(calculateStandings(competition)[0].rows.find(row => row.id === 'men-xinke').goalsFor, 12);

  const withCards = updateResult(competition, original.id, {
    groupId: 'men-a', homeId: 'men-yuanpei', awayId: 'men-xinke', homeScore: 1, awayScore: 4,
    homeCards: { yellow: 1 }, awayCards: {},
  });
  assert.equal(withCards.homeFairPlay, undefined);
  assert.equal(withCards.awayFairPlay, undefined);
  assert.equal(getMatchFairPlay(withCards, 'home'), 4);
});

test('拒绝同队比赛、跨组比赛和无效比分', () => {
  const competition = menCompetition();
  assert.throws(() => createResult(competition, {
    groupId: 'men-a', homeId: 'men-xinke', awayId: 'men-xinke', homeScore: 1, awayScore: 0,
  }), /不同的球队/);
  assert.throws(() => createResult(competition, {
    groupId: 'men-a', homeId: 'men-xinke', awayId: 'men-wuli', homeScore: 1, awayScore: 0,
  }), /同一小组/);
  assert.throws(() => createResult(competition, {
    groupId: 'men-a', homeId: 'men-xinke', awayId: 'men-chenghuan', homeScore: 1.5, awayScore: 0,
  }), /整数/);
});

test('两项赛事的新增数据相互独立', () => {
  const state = createInitialState();
  const men = getActiveCompetition(state);
  men.matches.push(createResult(men, {
    groupId: 'men-a', homeId: 'men-xinke', awayId: 'men-chenghuan', homeScore: 1, awayScore: 0,
  }));
  state.activeCompetitionId = 'women-pku-cup';
  assert.equal(getActiveCompetition(state).matches.length, 3);
  assert.equal(men.matches.length, 17);
});

test('全部共同名次的组间比较合并为一张表并只说明一次剔除规则', () => {
  const competition = menCompetition();
  const { svg } = buildPoster(competition, '', { mode: 'cross-group' });
  assert.match(svg, /男足组间晋级比较/);
  for (const rank of [1, 2, 3]) assert.match(svg, new RegExp(`小组第 ${rank} 名 · 组间晋级比较`));
  assert.doesNotMatch(svg, /小组第 4 名/);
  assert.equal((svg.match(/公平竞赛积分保留/g) ?? []).length, 1);
  assert.equal((svg.match(/>排序<\/text>/g) ?? []).length, 1);
  for (const label of ['C组 · 光华', 'E组 · 化学', 'A组 · 元培']) assert.match(svg, new RegExp(label));
  assert.ok(svg.indexOf('小组第 1 名') < svg.indexOf('小组第 2 名'));
  assert.ok(svg.indexOf('小组第 2 名') < svg.indexOf('小组第 3 名'));
  assert.match(svg, /C组 · 光华/);
  assert.match(svg, /A组 · 信科/);
  assert.match(svg, /公平竞赛积分保留/);
  assert.doesNotMatch(svg, />A组<\/text>/);
});

test('海报使用中文日期并转义可编辑文本', () => {
  const competition = menCompetition();
  competition.title = '测试<积分榜>';
  const { svg, width, height } = buildPoster(competition);
  assert.equal(width, 1240);
  assert.ok(height >= 1754);
  assert.match(svg, /测试&lt;积分榜&gt;/);
  assert.match(svg, /2026年10月29日/);
  assert.equal(formatChineseDate('2026-01-05'), '2026年1月5日');
});

test('原有赛果直接保存但未修改内容，不产生内容差异', () => {
  const state = createInitialState(), current = state.competitions[0], match = current.matches[0];
  const before = contentFingerprint(state);
  const cards = { yellow: 0, secondYellowRed: 0, directRed: 0, yellowDirectRed: 0 };
  current.matches[0] = updateResult(current, match.id, { ...match, homeCards: cards, awayCards: cards });
  assert.equal(contentFingerprint(state), before);
});


test('组间比较只接受各组共同拥有的名次，空组不参与错误比较', () => {
  const competition = menCompetition();
  for (const position of [-1, .5, 3, 4, NaN]) assert.deepEqual(calculateCrossGroupStandings(competition, position), []);
  assert.equal(calculateCrossGroupStandings(competition, 2).length, 5);
  competition.groups.push({ id: 'empty', name: '空组', teams: [] });
  assert.deepEqual(calculateCrossGroupStandings(competition, 0), []);
});
test('组间排序按积分、净胜球及公平竞赛积分比较，不改变小组数据', () => {
  const competition = { groups: [
    { id: 'a', name: 'A组', teams: [team('a1', '甲'), team('a2', '乙')] },
    { id: 'b', name: 'B组', teams: [team('b1', '丙'), team('b2', '丁')] },
  ], matches: [
    { ...result('a1', 'a2', 2, 0), groupId: 'a', homeFairPlay: 2 },
    { ...result('b1', 'b2', 2, 0), groupId: 'b', homeFairPlay: 5 },
  ] };
  const before = structuredClone(competition);
  assert.deepEqual(calculateCrossGroupStandings(competition).map(row => row.name), ['丙', '甲']);
  assert.deepEqual(competition, before);
  competition.matches[0].homeScore = 3;
  assert.deepEqual(calculateCrossGroupStandings(competition).map(row => row.name), ['甲', '丙']);
  competition.matches.push({ ...result('b1', 'b2', 0, 0), id: 'draw', groupId: 'b' });
  assert.deepEqual(calculateCrossGroupStandings(competition).map(row => row.name), ['丙', '甲']);
});
test('同人数小组的比较不声称剔除成绩，海报转义组名与队名', () => {
  const current = menCompetition(); current.groups = current.groups.slice(0,2);
  current.groups[0].name = '<A组>'; current.groups[0].teams[0].name = '甲<&球队';
  const { svg } = buildPoster(current, '', { mode: 'cross-group' });
  assert.match(svg, /各小组球队数量相同，不剔除比赛成绩/);
  assert.match(svg, /&lt;A组&gt;/); assert.doesNotMatch(svg, /<A组>/);
});

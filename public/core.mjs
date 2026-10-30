export const STORAGE_KEY = 'pku-football-standings-v1';

export function createId(prefix = 'id') {
  const value = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${value}`;
}

function stats(played, wins, draws, losses, goalsFor, goalsAgainst) {
  return { played, wins, draws, losses, goalsFor, goalsAgainst };
}

function team(id, name, base, fairPlay = 5) {
  return { id, name, base, fairPlay, disciplineDeduction: 0, drawOrder: null };
}

function group(id, name, teams) {
  return { id, name, teams };
}

function emptyStats() {
  return stats(0, 0, 0, 0, 0, 0);
}

function seedMatch(id, round, groupId, homeId, awayId, homeScore, awayScore, homeFairPlay = 5, awayFairPlay = 5) {
  return { id, round, groupId, homeId, awayId, homeScore, awayScore, homeFairPlay, awayFairPlay };
}

function createMenMatches() {
  return [
    seedMatch('men-r1-chenghuan-xinyizhe', '第一轮', 'men-a', 'men-chenghuan', 'men-xinyizhe', 3, 1),
    seedMatch('men-r1-xinli-jingji', '第一轮', 'men-c', 'men-xinli', 'men-jingji', 4, 6, 2, 3),
    seedMatch('men-r1-huaxue-zhongma', '第一轮', 'men-e', 'men-huaxue', 'men-zhongma', 17, 0, 4, 5),
    seedMatch('men-r1-waiyuan-yixue', '第一轮', 'men-b', 'men-waiyuan', 'men-yixue', 0, 3, 5, 4),
    seedMatch('men-r1-yuanpei-xinke', '第一轮', 'men-a', 'men-yuanpei', 'men-xinke', 0, 3, 5, 2),
    seedMatch('men-r1-shuxue-dikong', '第一轮', 'men-d', 'men-shuxue', 'men-dikong', 6, 0, 5, 4),
    seedMatch('men-r1-faxue-wuli', '第一轮', 'men-b', 'men-faxue', 'men-wuli', 1, 13),
    seedMatch('men-r1-guoguan-guanghua', '第一轮', 'men-c', 'men-guoguan', 'men-guanghua', 2, 4, 3, 2),
    seedMatch('men-r2-xinli-guanghua', '第二轮', 'men-c', 'men-xinli', 'men-guanghua', 0, 3),
    seedMatch('men-r2-gongxue-zhongma', '第二轮', 'men-e', 'men-gongxue', 'men-zhongma', 22, 0),
    seedMatch('men-r2-yuanpei-xinyizhe', '第二轮', 'men-a', 'men-yuanpei', 'men-xinyizhe', 5, 1),
    seedMatch('men-r2-guoguan-jingji', '第二轮', 'men-c', 'men-guoguan', 'men-jingji', 5, 2),
    seedMatch('men-r2-faxue-yixue', '第二轮', 'men-b', 'men-faxue', 'men-yixue', 1, 12),
    seedMatch('men-r3-guanghua-jingji', '第三轮', 'men-c', 'men-guanghua', 'men-jingji', 8, 0),
    seedMatch('men-r3-xinke-xinyizhe', '第三轮', 'men-a', 'men-xinke', 'men-xinyizhe', 8, 1),
    seedMatch('men-r3-wuli-yixue', '第三轮', 'men-b', 'men-wuli', 'men-yixue', 3, 3),
  ];
}

function createMenCompetition() {
  return {
    id: 'men-freshman-cup', format: 'groups',
    shortName: '男足新生杯',
    title: '2026年北京大学“新生杯”男足小组赛积分榜',
    date: '2026-10-29',
    groups: [
      group('men-a', 'A组', [
        team('men-xinke', '信科', emptyStats()),
        team('men-chenghuan', '城环', emptyStats()),
        team('men-xinyizhe', '心艺哲', emptyStats()),
        team('men-yuanpei', '元培', emptyStats()),
      ]),
      group('men-b', 'B组', [
        team('men-wuli', '物理', emptyStats()),
        team('men-yixue', '医学', emptyStats()),
        team('men-waiyuan', '外院', emptyStats()),
        team('men-faxue', '法学', emptyStats()),
      ]),
      group('men-c', 'C组', [
        team('men-jingji', '经济', emptyStats()),
        team('men-guanghua', '光华', emptyStats()),
        team('men-xinli', '信历', emptyStats()),
        team('men-guoguan', '国关', emptyStats()),
      ]),
      group('men-d', 'D组', [
        team('men-shuxue', '数学', emptyStats()),
        team('men-shengke', '生科', emptyStats()),
        team('men-dikong', '地空', emptyStats()),
      ]),
      group('men-e', 'E组', [
        team('men-huaxue', '化学', emptyStats()),
        team('men-gongxue', '工学', emptyStats()),
        team('men-zhongma', '中马', emptyStats()),
      ]),
    ],
    matches: createMenMatches(),
  };
}

function createWomenCompetition() {
  return {
    id: 'women-pku-cup', format: 'league',
    shortName: '女足北大杯',
    title: '2026年北京大学“北大杯”女足常规赛积分榜',
    date: '2026-10-29',
    groups: [group('women-regular', '常规赛', [
      team('women-lchadi', '理叉地', emptyStats()),
      team('women-zhengxinshe', '政信社', emptyStats()),
      team('women-yixue', '医学', emptyStats()),
      team('women-yuanpei', '元培', emptyStats()),
      team('women-chengxinkao', '城新考', emptyStats()),
      team('women-zhongliwai', '中历外', emptyStats()),
      team('women-gongshu', '工数', emptyStats()),
      team('women-guoguang', '国光', emptyStats()),
    ])],
    matches: [
      seedMatch('women-w2-lchadi-zhengxinshe', '第二周', 'women-regular', 'women-lchadi', 'women-zhengxinshe', 2, 2),
      seedMatch('women-w2-yixue-yuanpei', '第二周', 'women-regular', 'women-yixue', 'women-yuanpei', 5, 0),
      seedMatch('women-w2-chengxinkao-zhongliwai', '第二周', 'women-regular', 'women-chengxinkao', 'women-zhongliwai', 1, 3),
    ],
  };
}

export function createInitialState() {
  return {
    version: 1,
    revision: 4,
    activeCompetitionId: 'men-freshman-cup',
    competitions: [createMenCompetition(), createWomenCompetition()],
  };
}

export function migrateState(state) {
  if (state.revision === 2) {
    const regular = state.competitions.find(item => item.id === 'women-pku-cup')
      ?.groups.find(item => item.id === 'women-regular');
    if (regular) {
      const initialTeams = createWomenCompetition().groups[0].teams;
      for (const id of ['women-gongshu', 'women-guoguang']) {
        if (!regular.teams.some(item => item.id === id)) regular.teams.push(initialTeams.find(item => item.id === id));
      }
    }
  }
  for (const item of state.competitions) item.format ??= item.groups.length > 1 ? 'groups' : 'league';
  state.revision = 4;
  return state;
}

export function createCompetition({ name, format = 'groups', date = '' }) {
  name = String(name ?? '').trim();
  if (!name || name.length > 40) throw new Error('赛事名称须为 1–40 个字。');
  if (!['groups', 'league'].includes(format)) throw new Error('请选择赛制。');
  return {
    id: createId('competition'), shortName: name, title: `${name}积分榜`, date, format,
    groups: [{ id: createId('group'), name: format === 'league' ? '常规赛' : 'A组', teams: [] }], matches: [],
  };
}

export function resetCompetition(current) {
  const initial = createInitialState().competitions.find(item => item.id === current.id);
  if (initial) return migrateState({ version: 1, revision: 4, competitions: [initial] }).competitions[0];
  return {
    ...structuredClone(current), matches: [],
    groups: current.groups.map(group => ({ ...group, teams: group.teams.map(team => ({
      ...team, base: emptyStats(), fairPlay: 5, disciplineDeduction: 0, drawOrder: null,
    })) })),
  };
}

export function getActiveCompetition(state) {
  return state.competitions.find(item => item.id === state.activeCompetitionId) ?? state.competitions[0];
}

const CARD_KEYS = ['yellow', 'secondYellowRed', 'directRed', 'yellowDirectRed'];

export function calculateMatchFairPlay(cards = {}) {
  return 5 -
    (Number(cards.yellow) || 0) -
    (Number(cards.secondYellowRed) || 0) * 3 -
    (Number(cards.directRed) || 0) * 4 -
    (Number(cards.yellowDirectRed) || 0) * 5;
}

export function getMatchFairPlay(match, side) {
  const savedScore = match[`${side}FairPlay`];
  return Number.isFinite(savedScore) ? savedScore : calculateMatchFairPlay(match[`${side}Cards`]);
}

export function formatFairPlay(value) {
  return Number(value.toFixed(2)).toString();
}

function validateCards(cards = {}) {
  const validated = {};
  for (const key of CARD_KEYS) {
    const value = cards[key] ?? 0;
    if (!Number.isInteger(value) || value < 0 || value > 99) {
      throw new Error('红黄牌数量须为 0–99 之间的整数。');
    }
    validated[key] = value;
  }
  return validated;
}

export function createResult(competition, { groupId, homeId, awayId, homeScore, awayScore, homeCards, awayCards, homeFairPlay, awayFairPlay }) {
  const selectedGroup = competition.groups.find(item => item.id === groupId);
  if (!selectedGroup) throw new Error('请选择比赛小组。');
  if (!homeId || !awayId || homeId === awayId) throw new Error('请选择两支不同的球队。');
  if (!selectedGroup.teams.some(item => item.id === homeId) || !selectedGroup.teams.some(item => item.id === awayId)) {
    throw new Error('两支球队必须属于同一小组。');
  }
  for (const score of [homeScore, awayScore]) {
    if (!Number.isInteger(score) || score < 0 || score > 99) throw new Error('比分须为 0–99 之间的整数。');
  }
  const validatedHomeCards = validateCards(homeCards);
  const validatedAwayCards = validateCards(awayCards);
  const result = {
    id: createId('match'),
    groupId,
    homeId,
    awayId,
    homeScore,
    awayScore,
    homeCards: validatedHomeCards,
    awayCards: validatedAwayCards,
    createdAt: new Date().toISOString(),
  };
  if (Number.isFinite(homeFairPlay)) result.homeFairPlay = homeFairPlay;
  if (Number.isFinite(awayFairPlay)) result.awayFairPlay = awayFairPlay;
  return result;
}

export function updateResult(competition, matchId, values) {
  const existing = competition.matches.find(match => match.id === matchId);
  if (!existing) throw new Error('未找到要修改的赛果，请刷新后重试。');
  const updated = {
    ...createResult(competition, values), id: existing.id,
    round: existing.round, createdAt: existing.createdAt,
  };
  // Seed matches only record aggregate fair play, not individual card counts.
  for (const side of ['home', 'away']) {
    if (existing[`${side}Cards`] == null && Number.isFinite(existing[`${side}FairPlay`]) && updated[`${side}FairPlay`] === existing[`${side}FairPlay`]) delete updated[`${side}Cards`];
  }
  return updated;
}

function relatedStats(teamId, relatedIds, matches) {
  const result = { points: 0, goalDifference: 0, goalsFor: 0 };
  for (const match of matches) {
    const isHome = match.homeId === teamId;
    const isAway = match.awayId === teamId;
    if (!isHome && !isAway) continue;
    const opponentId = isHome ? match.awayId : match.homeId;
    if (!relatedIds.has(opponentId)) continue;
    const goalsFor = isHome ? match.homeScore : match.awayScore;
    const goalsAgainst = isHome ? match.awayScore : match.homeScore;
    result.goalsFor += goalsFor;
    result.goalDifference += goalsFor - goalsAgainst;
    if (goalsFor > goalsAgainst) result.points += 3;
    else if (goalsFor === goalsAgainst) result.points += 1;
  }
  return result;
}

function sortGroupRows(rows, matches) {
  const pointGroups = new Map();
  for (const row of rows) {
    if (!pointGroups.has(row.points)) pointGroups.set(row.points, []);
    pointGroups.get(row.points).push(row);
  }
  const sorted = [];
  for (const points of [...pointGroups.keys()].sort((a, b) => b - a)) {
    const tiedRows = pointGroups.get(points);
    const relatedIds = new Set(tiedRows.map(row => row.id));
    const miniLeague = new Map(tiedRows.map(row => [row.id, relatedStats(row.id, relatedIds, matches)]));
    tiedRows.sort((a, b) => {
      const aRelated = miniLeague.get(a.id);
      const bRelated = miniLeague.get(b.id);
      return bRelated.points - aRelated.points ||
        (tiedRows.length > 2 ? bRelated.goalDifference - aRelated.goalDifference : 0) ||
        (tiedRows.length > 2 ? bRelated.goalsFor - aRelated.goalsFor : 0) ||
        b.goalDifference - a.goalDifference ||
        b.goalsFor - a.goalsFor ||
        b.fairPlay - a.fairPlay ||
        (a.drawOrder ?? a.originalIndex + 1) - (b.drawOrder ?? b.originalIndex + 1);
    });
    sorted.push(...tiedRows);
  }
  return sorted;
}

export function calculateStandings(competition) {
  return competition.groups.map(selectedGroup => {
    const rows = selectedGroup.teams.map((item, originalIndex) => {
      const baseFairPlay = Number(item.fairPlay) || 0;
      return {
        id: item.id,
        name: item.name,
        originalIndex,
        drawOrder: Number.isFinite(item.drawOrder) ? item.drawOrder : null,
        disciplineDeduction: Number(item.disciplineDeduction) || 0,
        ...item.base,
        points: item.base.wins * 3 + item.base.draws,
        goalDifference: item.base.goalsFor - item.base.goalsAgainst,
        fairPlayPoints: baseFairPlay * item.base.played,
        fairPlayMatches: item.base.played,
      };
    });
    const byId = new Map(rows.map(row => [row.id, row]));

    for (const match of competition.matches) {
      if (match.groupId !== selectedGroup.id) continue;
      const home = byId.get(match.homeId);
      const away = byId.get(match.awayId);
      if (!home || !away) continue;

      home.played += 1;
      away.played += 1;
      home.goalsFor += match.homeScore;
      home.goalsAgainst += match.awayScore;
      away.goalsFor += match.awayScore;
      away.goalsAgainst += match.homeScore;
      home.fairPlayPoints += getMatchFairPlay(match, 'home');
      away.fairPlayPoints += getMatchFairPlay(match, 'away');
      home.fairPlayMatches += 1;
      away.fairPlayMatches += 1;

      if (match.homeScore > match.awayScore) {
        home.wins += 1;
        away.losses += 1;
        home.points += 3;
      } else if (match.homeScore < match.awayScore) {
        away.wins += 1;
        home.losses += 1;
        away.points += 3;
      } else {
        home.draws += 1;
        away.draws += 1;
        home.points += 1;
        away.points += 1;
      }
    }

    for (const row of rows) {
      row.goalDifference = row.goalsFor - row.goalsAgainst;
      row.fairPlayBeforeDiscipline = row.fairPlayMatches ? row.fairPlayPoints / row.fairPlayMatches : 5;
      row.fairPlay = row.fairPlayBeforeDiscipline - row.disciplineDeduction;
      delete row.fairPlayPoints;
      delete row.fairPlayMatches;
    }
    return { id: selectedGroup.id, name: selectedGroup.name, rows: sortGroupRows(rows, competition.matches) };
  });
}

export function calculateCrossGroupStandings(competition, position = 0) {
  const standings = calculateStandings(competition);
  const minimumTeams = Math.min(...standings.map(selectedGroup => selectedGroup.rows.length));
  return standings.map((selectedGroup, groupIndex) => {
    const source = selectedGroup.rows[position];
    if (!source) return null;
    const row = { ...source, groupId: selectedGroup.id, groupName: selectedGroup.name, groupIndex };
    if (selectedGroup.rows.length > minimumTeams) {
      const excludedId = selectedGroup.rows.at(-1).id;
      for (const match of competition.matches) {
        const isHome = match.homeId === row.id && match.awayId === excludedId;
        const isAway = match.awayId === row.id && match.homeId === excludedId;
        if (!isHome && !isAway) continue;
        const goalsFor = isHome ? match.homeScore : match.awayScore;
        const goalsAgainst = isHome ? match.awayScore : match.homeScore;
        row.played -= 1;
        row.goalsFor -= goalsFor;
        row.goalsAgainst -= goalsAgainst;
        if (goalsFor > goalsAgainst) {
          row.wins -= 1;
          row.points -= 3;
        } else if (goalsFor < goalsAgainst) {
          row.losses -= 1;
        } else {
          row.draws -= 1;
          row.points -= 1;
        }
      }
      row.goalDifference = row.goalsFor - row.goalsAgainst;
    }
    return row;
  }).filter(Boolean).sort((a, b) =>
    b.points - a.points ||
    b.goalDifference - a.goalDifference ||
    b.goalsFor - a.goalsFor ||
    b.fairPlay - a.fairPlay ||
    (a.drawOrder ?? a.groupIndex + 1) - (b.drawOrder ?? b.groupIndex + 1)
  );
}

export function formatChineseDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!match) return value || '';
  return `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日`;
}

export function isValidState(value) {
  return value?.version === 1 &&
    Array.isArray(value.competitions) &&
    value.competitions.length > 0 &&
    value.competitions.every(competition =>
      typeof competition.id === 'string' &&
      typeof competition.title === 'string' &&
      Array.isArray(competition.groups) &&
      Array.isArray(competition.matches)
    );
}

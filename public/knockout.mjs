const CARD_KEYS = ['yellow', 'secondYellowRed', 'directRed', 'yellowDirectRed'];

function emptyCards() {
  return Object.fromEntries(CARD_KEYS.map(key => [key, 0]));
}

function legs(count) {
  return Array.from({ length: count }, () => ({ homeScore: null, awayScore: null, homeCards: emptyCards(), awayCards: emptyCards() }));
}

function matchFairPlay(cards = {}) {
  return 5 - (Number(cards.yellow) || 0) - (Number(cards.secondYellowRed) || 0) * 3 -
    (Number(cards.directRed) || 0) * 4 - (Number(cards.yellowDirectRed) || 0) * 5;
}

function match(id, legCount = 1, homeSource = null, awaySource = null) {
  const result = { id, legs: legs(legCount) };
  if (homeSource) result.homeSource = homeSource;
  else result.homeName = '';
  if (awaySource) result.awaySource = awaySource;
  else result.awayName = '';
  return result;
}

function menKnockout() {
  return [
    { id: 'men-round-12', name: '十二进八', byes: Array.from({ length: 4 }, (_, index) => ({ id: `men-bye-${index + 1}`, name: '' })), matches: [
      match('men-r12-1'), match('men-r12-2'), match('men-r12-3'), match('men-r12-4'),
    ] },
    { id: 'men-round-8', name: '八进四', matches: [
      match('men-r8-1', 1, { bye: 'men-bye-1' }, { winner: 'men-r12-1' }),
      match('men-r8-2', 1, { winner: 'men-r12-2' }, { bye: 'men-bye-2' }),
      match('men-r8-3', 1, { bye: 'men-bye-3' }, { winner: 'men-r12-3' }),
      match('men-r8-4', 1, { winner: 'men-r12-4' }, { bye: 'men-bye-4' }),
    ] },
    { id: 'men-round-4', name: '半决赛', matches: [
      match('men-r4-1', 1, { winner: 'men-r8-1' }, { winner: 'men-r8-2' }),
      match('men-r4-2', 1, { winner: 'men-r8-3' }, { winner: 'men-r8-4' }),
    ] },
    { id: 'men-round-2', name: '决赛', matches: [
      match('men-final', 1, { winner: 'men-r4-1' }, { winner: 'men-r4-2' }),
    ] },
  ];
}

function womenKnockout() {
  return [
    { id: 'women-round-4', name: '四进二 · 双回合', matches: [
      match('women-r4-1', 2), match('women-r4-2', 2),
    ] },
    { id: 'women-round-2', name: '决赛 · 单回合', matches: [
      match('women-final', 1, { winner: 'women-r4-1' }, { winner: 'women-r4-2' }),
    ] },
  ];
}

export function createKnockoutStage(competitionId, title, date = '') {
  const rounds = competitionId === 'women-pku-cup' ? womenKnockout() : menKnockout();
  return { title, date, rounds, disciplineDeductions: {} };
}

export function getKnockoutBracket(knockout) {
  const byes = new Map(knockout.rounds.flatMap(round => round.byes ?? []).map(bye => [bye.id, bye.name]));
  const winners = new Map();
  const rounds = knockout.rounds.map(round => ({
    ...round,
    matches: round.matches.map(match => {
      const resolve = side => {
        const source = match[`${side}Source`];
        if (source?.bye) return { name: byes.get(source.bye) ?? '', editable: false, source };
        if (source?.winner) return { name: winners.get(source.winner) ?? '', editable: false, source };
        return { name: match[`${side}Name`] ?? '', editable: true, source: null };
      };
      const home = resolve('home');
      const away = resolve('away');
      const completed = match.legs.every(leg => Number.isInteger(leg.homeScore) && Number.isInteger(leg.awayScore));
      const homeAggregate = match.legs.reduce((total, leg) => total + (leg.homeScore ?? 0), 0);
      const awayAggregate = match.legs.reduce((total, leg) => total + (leg.awayScore ?? 0), 0);
      const winnerName = completed && home.name && away.name
        ? homeAggregate !== awayAggregate ? homeAggregate > awayAggregate ? home.name : away.name
          : match.tiebreakWinner === 'home' ? home.name : match.tiebreakWinner === 'away' ? away.name : ''
        : '';
      const result = { ...match, home, away, homeAggregate, awayAggregate, completed, winnerName };
      winners.set(match.id, winnerName);
      return result;
    }),
  }));
  return { ...knockout, rounds };
}

export function getKnockoutSummary(knockout) {
  const bracket = getKnockoutBracket(knockout);
  const matches = bracket.rounds.flatMap(round => round.matches);
  return { played: matches.filter(match => match.winnerName).length, total: matches.length };
}

function renameDiscipline(knockout, previous, next) {
  if (previous === next || !knockout.disciplineDeductions) return;
  const deduction = Object.hasOwn(knockout.disciplineDeductions, previous) ? knockout.disciplineDeductions[previous] : null;
  delete knockout.disciplineDeductions[previous];
  if (next && deduction != null) knockout.disciplineDeductions = { ...knockout.disciplineDeductions, [next]: deduction };
}

// A later result belongs to its two participants. Never apply it to a different
// qualifier after an earlier team/result changes. Same-winner corrections keep it.
function updateParticipants(knockout, update) {
  const before = new Map(getKnockoutBracket(knockout).rounds.flatMap(round => round.matches)
    .map(match => [match.id, [match.home.name, match.away.name]]));
  update();
  let clearedMatches = 0;
  for (const round of knockout.rounds) {
    const current = new Map(getKnockoutBracket(knockout).rounds.flatMap(item => item.matches).map(match => [match.id, match]));
    for (const match of round.matches) {
      const previous = before.get(match.id);
      const next = current.get(match.id);
      if (previous[0] === next.home.name && previous[1] === next.away.name) continue;
      if (match.tiebreakWinner || match.legs.some(leg => leg.homeScore != null || leg.awayScore != null ||
        ['home', 'away'].some(side => Object.values(leg[`${side}Cards`] ?? {}).some(Number)))) clearedMatches++;
      match.legs = legs(match.legs.length);
      delete match.tiebreakWinner;
    }
  }
  return { clearedMatches };
}

export function setKnockoutTeam(knockout, { matchId, byeId, side = 'home', name }) {
  name = String(name ?? '').trim().slice(0, 30);
  if (!['home', 'away'].includes(side)) throw new Error('未找到要修改的球队。');
  const entries = knockout.rounds.flatMap(round => [
    ...(round.byes ?? []).map(bye => ({ id: bye.id, name: bye.name })),
    ...round.matches.flatMap(match => ['home', 'away'].filter(teamSide => !match[`${teamSide}Source`])
      .map(teamSide => ({ id: `${match.id}:${teamSide}`, name: match[`${teamSide}Name`] ?? '' }))),
  ]);
  const targetId = byeId || `${matchId}:${side}`;
  if (name.trim() && entries.some(entry => entry.id !== targetId && entry.name.trim() === name.trim())) throw new Error('该球队已在淘汰赛中，请填写不同的球队名称。');
  if (byeId) {
    const bye = knockout.rounds.flatMap(round => round.byes ?? []).find(item => item.id === byeId);
    if (!bye) throw new Error('未找到轮空球队。');
    return updateParticipants(knockout, () => {
      renameDiscipline(knockout, bye.name, name);
      bye.name = name;
    });
  }
  const match = knockout.rounds.flatMap(round => round.matches).find(item => item.id === matchId);
  if (!match || match[`${side}Source`]) throw new Error('该对阵位置由上一轮晋级球队决定。');
  const key = `${side}Name`;
  return updateParticipants(knockout, () => {
    renameDiscipline(knockout, match[key], name);
    match[key] = name;
  });
}

export function setKnockoutScore(knockout, matchId, legIndex, side, value) {
  const match = knockout.rounds.flatMap(round => round.matches).find(item => item.id === matchId);
  const leg = match?.legs[legIndex];
  if (!leg || !['home', 'away'].includes(side)) throw new Error('未找到要修改的比分。');
  const score = value === '' || value == null ? null : Number(value);
  if (score !== null && (!Number.isInteger(score) || score < 0 || score > 99)) throw new Error('比分须为 0–99 之间的整数。');
  const resolved = getKnockoutBracket(knockout).rounds.flatMap(round => round.matches).find(item => item.id === matchId);
  if (score !== null && (!resolved.home.name.trim() || !resolved.away.name.trim())) throw new Error('请先确定本场两支球队，再填写比分。');
  return updateParticipants(knockout, () => {
    if (leg[`${side}Score`] !== score) delete match.tiebreakWinner;
    leg[`${side}Score`] = score;
  });
}

export function setKnockoutTiebreak(knockout, matchId, side) {
  const match = knockout.rounds.flatMap(round => round.matches).find(item => item.id === matchId);
  const resolved = getKnockoutBracket(knockout).rounds.flatMap(round => round.matches).find(item => item.id === matchId);
  if (!match || !['', 'home', 'away'].includes(side) || !resolved.completed || !resolved.home.name.trim() || !resolved.away.name.trim() || resolved.homeAggregate !== resolved.awayAggregate) throw new Error('请先录入完整的平局比分，再确认晋级球队。');
  return updateParticipants(knockout, () => {
    if (side) match.tiebreakWinner = side;
    else delete match.tiebreakWinner;
  });
}

export function setKnockoutCards(knockout, matchId, legIndex, side, cards) {
  const match = knockout.rounds.flatMap(round => round.matches).find(item => item.id === matchId);
  const leg = match?.legs[legIndex];
  if (!leg || !['home', 'away'].includes(side)) throw new Error('未找到要修改的红黄牌记录。');
  const validated = {};
  for (const key of CARD_KEYS) {
    const value = cards[key] ?? 0;
    if (!Number.isInteger(value) || value < 0 || value > 99) throw new Error('红黄牌数量须为 0–99 之间的整数。');
    validated[key] = value;
  }
  leg[`${side}Cards`] = validated;
}

export function setKnockoutDiscipline(knockout, name, value) {
  const deduction = Number(value);
  if (!Number.isInteger(deduction) || deduction < 0 || deduction > 99) throw new Error('纪律处罚扣分须为 0–99 之间的整数。');
  const names = getKnockoutBracket(knockout).rounds.flatMap(round => round.matches.flatMap(match => [match.home.name, match.away.name])).filter(Boolean);
  if (!names.includes(name)) throw new Error('未找到要设置纪律处罚的球队。');
  knockout.disciplineDeductions = { ...knockout.disciplineDeductions, [name]: deduction };
}

export function getKnockoutFairPlay(knockout) {
  const bracket = getKnockoutBracket(knockout);
  const rows = new Map();
  for (const match of bracket.rounds.flatMap(round => round.matches)) {
    for (const side of ['home', 'away']) {
      const name = match[side].name;
      if (name && !rows.has(name)) rows.set(name, { name, played: 0, fairPlayPoints: 0 });
    }
    for (const leg of match.legs) {
      if (!Number.isInteger(leg.homeScore) || !Number.isInteger(leg.awayScore)) continue;
      for (const side of ['home', 'away']) {
        const name = match[side].name;
        if (!name) continue;
        const row = rows.get(name);
        row.played += 1;
        row.fairPlayPoints += matchFairPlay(leg[`${side}Cards`]);
      }
    }
  }
  return [...rows.values()].map(row => {
    const disciplineDeduction = Number(knockout.disciplineDeductions?.[row.name]) || 0;
    const beforeDiscipline = row.played ? row.fairPlayPoints / row.played : 5;
    return {
      name: row.name,
      played: row.played,
      beforeDiscipline,
      disciplineDeduction,
      fairPlay: beforeDiscipline - disciplineDeduction,
    };
  }).sort((a, b) => b.fairPlay - a.fairPlay || b.played - a.played || a.name.localeCompare(b.name, 'zh-CN'));
}

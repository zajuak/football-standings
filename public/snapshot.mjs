import { isValidState, isValidSeasonName } from './core.mjs';
import { createKnockoutStage, getKnockoutBracket } from './knockout.mjs';
function validStage(stage, allowEmpty = false) {
  if (typeof stage.title !== 'string' || typeof stage.date !== 'string' || !Array.isArray(stage.groups) || !Array.isArray(stage.matches) || (!allowEmpty && !stage.groups.length)) return false;
  const unique = values => new Set(values).size === values.length;
  if (!unique(stage.groups.map(g => g.id)) || !unique(stage.groups.flatMap(g => g.teams?.map(t => t.id) ?? [])) || !unique(stage.matches.map(m => m.id))) return false;
  return stage.groups.every(g => typeof g.id === 'string' && typeof g.name === 'string' && Array.isArray(g.teams) && g.teams.every(t =>
    typeof t.id === 'string' && typeof t.name === 'string' && t.base &&
    ['played', 'wins', 'draws', 'losses', 'goalsFor', 'goalsAgainst'].every(k => Number.isInteger(t.base[k]) && t.base[k] >= 0) &&
    Number.isFinite(t.fairPlay) && (t.disciplineDeduction == null || Number.isFinite(t.disciplineDeduction)) &&
    (t.drawOrder == null || Number.isFinite(t.drawOrder))
  )) && stage.matches.every(m => {
    const g = stage.groups.find(g => g.id === m.groupId);
    return typeof m.id === 'string' && m.homeId !== m.awayId && g?.teams.some(t => t.id === m.homeId) && g.teams.some(t => t.id === m.awayId) &&
      [m.homeScore, m.awayScore].every(n => Number.isInteger(n) && n >= 0 && n <= 99) &&
      ['home', 'away'].every(side => (m[`${side}FairPlay`] == null || Number.isFinite(m[`${side}FairPlay`])) &&
        (m[`${side}Cards`] == null || ['yellow', 'secondYellowRed', 'directRed', 'yellowDirectRed'].every(k => Number.isInteger(m[`${side}Cards`][k]) && m[`${side}Cards`][k] >= 0 && m[`${side}Cards`][k] <= 99)));
  });
}

function validPlacement(stage) {
  return stage.placement == null || (stage.placement.format === 'groups' && validStage(stage.placement, true));
}

function validKnockoutCards(cards) {
  return cards == null || (typeof cards === 'object' && !Array.isArray(cards) &&
    ['yellow', 'secondYellowRed', 'directRed', 'yellowDirectRed'].every(key => cards[key] == null || (Number.isInteger(cards[key]) && cards[key] >= 0 && cards[key] <= 99)));
}

function validKnockout(stage, competitionId) {
  if (stage.knockout == null) return true;
  const knockout = stage.knockout;
  if (typeof knockout.title !== 'string' || typeof knockout.date !== 'string' || !Array.isArray(knockout.rounds)) return false;
  const template = createKnockoutStage(competitionId, '');
  if (knockout.rounds.length !== template.rounds.length) return false;
  const validName = name => typeof name === 'string' && name.length <= 30;
  const entrants = [];
  if (knockout.disciplineDeductions != null && (typeof knockout.disciplineDeductions !== 'object' || Array.isArray(knockout.disciplineDeductions) ||
    !Object.entries(knockout.disciplineDeductions).every(([name, value]) => name.length > 0 && name.length <= 30 && Number.isInteger(value) && value >= 0 && value <= 99))) return false;
  const validSource = (source, expected) => expected == null ? source == null : source && !Array.isArray(source) &&
    Object.keys(source).length === 1 && Object.entries(expected).every(([key, value]) => source[key] === value);
  const structureValid = knockout.rounds.every((round, roundIndex) => {
    const expected = template.rounds[roundIndex];
    if (round.id !== expected.id || typeof round.name !== 'string' || !Array.isArray(round.matches) || round.matches.length !== expected.matches.length) return false;
    const byes = round.byes ?? [];
    if (!Array.isArray(byes) || byes.length !== (expected.byes?.length ?? 0) || !byes.every((bye, index) => bye.id === expected.byes[index].id && validName(bye.name))) return false;
    entrants.push(...byes.map(bye => bye.name.trim()).filter(Boolean));
    return round.matches.every((match, matchIndex) => {
      const target = expected.matches[matchIndex];
      if (match.id !== target.id || !Array.isArray(match.legs) || match.legs.length !== target.legs.length ||
        (match.tiebreakWinner != null && !['home', 'away'].includes(match.tiebreakWinner))) return false;
      if (match.penalties != null && (typeof match.penalties !== 'object' || Array.isArray(match.penalties) ||
        Object.keys(match.penalties).some(key => !['homeScore', 'awayScore'].includes(key)) ||
        !['homeScore', 'awayScore'].every(key => match.penalties[key] == null || (Number.isInteger(match.penalties[key]) && match.penalties[key] >= 0 && match.penalties[key] <= 99)))) return false;
      if (!['home', 'away'].every(side => {
        if (!validSource(match[`${side}Source`], target[`${side}Source`])) return false;
        const name = match[`${side}Name`];
        if (target[`${side}Source`]) return name == null || name === '';
        if (!validName(name)) return false;
        if (name.trim()) entrants.push(name.trim());
        return true;
      })) return false;
      return match.legs.every(leg => ['homeScore', 'awayScore'].every(key => leg[key] == null || (Number.isInteger(leg[key]) && leg[key] >= 0 && leg[key] <= 99)) &&
        ['home', 'away'].every(side => validKnockoutCards(leg[`${side}Cards`])));
    });
  });
  if (!structureValid || new Set(entrants).size !== entrants.length) return false;
  // These are the only supported bracket layouts. Verifying their references
  // above also prevents cyclic/missing sources from crashing poster rendering.
  return getKnockoutBracket(knockout).rounds.every(round => round.matches.every(match =>
    (!match.legs.some(leg => leg.homeScore != null || leg.awayScore != null) || (match.home.name.trim() && match.away.name.trim())) &&
    (match.tiebreakWinner == null || (match.completed && match.homeAggregate === match.awayAggregate && match.home.name.trim() && match.away.name.trim())) &&
    (!match.penaltiesStarted || (match.completed && match.homeAggregate === match.awayAggregate && match.home.name.trim() && match.away.name.trim() && match.tiebreakWinner == null))));
}

function validStages(stage, competitionId) {
  return validPlacement(stage) && validKnockout(stage, competitionId);
}

function checkSnapshot(state) {
  if (!isValidState(state) || ![2, 3, 4].includes(state.revision)) return false;
  if (!state.competitions.some(c => c.id === state.activeCompetitionId)) return false;
  const unique = values => new Set(values).size === values.length;
  if (!unique(state.competitions.map(c => c.id))) return false;
  return state.competitions.every(c => {
    if (!c.id || c.id.length > 100 || (c.format != null && !['groups', 'league'].includes(c.format)) || typeof c.shortName !== 'string' || !validStage(c) || !validStages(c, c.id)) return false;
    if (c.season != null && !isValidSeasonName(c.season)) return false;
    if (c.additionalSeasons == null) return true;
    if (!Array.isArray(c.additionalSeasons) || (c.additionalSeasons.length && c.season == null) || !unique([c, ...c.additionalSeasons].map(item => item.season))) return false;
    return c.additionalSeasons.every(item => isValidSeasonName(item.season) && ['groups', 'league'].includes(item.format) && validStage(item, true) && validStages(item, c.id));
  });
}

export function validSnapshot(state) { try { return Boolean(checkSnapshot(state)); } catch { return false; } }


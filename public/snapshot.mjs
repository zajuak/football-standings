import { isValidState, isValidSeasonName } from './core.mjs';
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

function checkSnapshot(state) {
  if (!isValidState(state) || ![2, 3, 4].includes(state.revision)) return false;
  if (!state.competitions.some(c => c.id === state.activeCompetitionId)) return false;
  const unique = values => new Set(values).size === values.length;
  if (!unique(state.competitions.map(c => c.id))) return false;
  return state.competitions.every(c => {
    if (!c.id || c.id.length > 100 || (c.format != null && !['groups', 'league'].includes(c.format)) || typeof c.shortName !== 'string' || !validStage(c) || !validPlacement(c)) return false;
    if (c.season != null && !isValidSeasonName(c.season)) return false;
    if (c.additionalSeasons == null) return true;
    if (!Array.isArray(c.additionalSeasons) || (c.additionalSeasons.length && c.season == null) || !unique([c, ...c.additionalSeasons].map(item => item.season))) return false;
    return c.additionalSeasons.every(item => isValidSeasonName(item.season) && ['groups', 'league'].includes(item.format) && validStage(item, true) && validPlacement(item));
  });
}

export function validSnapshot(state) { try { return Boolean(checkSnapshot(state)); } catch { return false; } }


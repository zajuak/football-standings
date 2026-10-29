import { isValidState } from './core.mjs';
function checkSnapshot(state) {
  if (!isValidState(state) || ![2, 3].includes(state.revision) || state.competitions.length !== 2) return false;
  if (!state.competitions.some(c => c.id === state.activeCompetitionId)) return false;
  const unique = values => new Set(values).size === values.length;
  if (!unique(state.competitions.map(c => c.id))) return false;
  return state.competitions.every(c => {
    if (!['men-freshman-cup', 'women-pku-cup'].includes(c.id) || typeof c.shortName !== 'string' || typeof c.date !== 'string' || !c.groups.length) return false;
    if (!unique(c.groups.map(g => g.id)) || !unique(c.groups.flatMap(g => g.teams?.map(t => t.id) ?? [])) || !unique(c.matches.map(m => m.id))) return false;
    return c.groups.every(g => typeof g.id === 'string' && typeof g.name === 'string' && Array.isArray(g.teams) && g.teams.every(t =>
      typeof t.id === 'string' && typeof t.name === 'string' && t.base &&
      ['played', 'wins', 'draws', 'losses', 'goalsFor', 'goalsAgainst'].every(k => Number.isInteger(t.base[k]) && t.base[k] >= 0) &&
      Number.isFinite(t.fairPlay) && (t.disciplineDeduction == null || Number.isFinite(t.disciplineDeduction)) &&
      (t.drawOrder == null || Number.isFinite(t.drawOrder))
    )) && c.matches.every(m => {
      const g = c.groups.find(g => g.id === m.groupId);
      return typeof m.id === 'string' && m.homeId !== m.awayId && g?.teams.some(t => t.id === m.homeId) && g.teams.some(t => t.id === m.awayId) &&
        [m.homeScore, m.awayScore].every(n => Number.isInteger(n) && n >= 0 && n <= 99) &&
        ['home', 'away'].every(side => (m[`${side}FairPlay`] == null || Number.isFinite(m[`${side}FairPlay`])) &&
          (m[`${side}Cards`] == null || ['yellow', 'secondYellowRed', 'directRed', 'yellowDirectRed'].every(k => Number.isInteger(m[`${side}Cards`][k]) && m[`${side}Cards`][k] >= 0 && m[`${side}Cards`][k] <= 99)));
    });
  });
}

export function validSnapshot(state) { try { return Boolean(checkSnapshot(state)); } catch { return false; } }


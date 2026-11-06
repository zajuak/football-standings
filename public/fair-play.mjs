import { getMatchFairPlay } from './core.mjs';
import { getKnockoutFairPlay } from './knockout.mjs';

// Match identities in the group stage use IDs; knockout entrants currently use
// names. Combine only exact trimmed names within this selected season.
export function getSeasonFairPlay(season) {
  const rows = new Map();
  const ensure = name => {
    name = name.trim();
    if (!rows.has(name)) rows.set(name, { name, groupPlayed: 0, knockoutPlayed: 0, fairPlayPoints: 0,
      groupDiscipline: 0, knockoutDiscipline: 0, hasKnockout: false });
    return rows.get(name);
  };
  for (const group of season.groups) {
    const teams = new Map();
    for (const team of group.teams) {
      if (!team.name.trim()) continue;
      const row = ensure(team.name);
      row.groupPlayed += team.base.played;
      row.fairPlayPoints += (Number(team.fairPlay) || 0) * team.base.played;
      row.groupDiscipline += Number(team.disciplineDeduction) || 0;
      teams.set(team.id, row);
    }
    for (const match of season.matches) {
      if (match.groupId !== group.id) continue;
      for (const side of ['home', 'away']) {
        const row = teams.get(match[`${side}Id`]);
        if (!row) continue;
        row.groupPlayed++;
        row.fairPlayPoints += getMatchFairPlay(match, side);
      }
    }
  }
  for (const team of season.knockout ? getKnockoutFairPlay(season.knockout) : []) {
    const row = ensure(team.name);
    row.hasKnockout = true;
    row.knockoutPlayed = team.played;
    row.fairPlayPoints += team.fairPlayPoints;
    row.knockoutDiscipline = team.disciplineDeduction;
  }
  return [...rows.values()].map(row => {
    const played = row.groupPlayed + row.knockoutPlayed;
    const beforeDiscipline = played ? row.fairPlayPoints / played : 5;
    return { ...row, played, beforeDiscipline,
      fairPlay: beforeDiscipline - row.groupDiscipline - row.knockoutDiscipline };
  }).sort((a, b) => Number(b.played > 0) - Number(a.played > 0) || b.fairPlay - a.fairPlay || b.played - a.played || a.name.localeCompare(b.name, 'zh-CN'));
}

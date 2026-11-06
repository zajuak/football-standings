import { calculateCrossGroupStandings, calculateStandings, formatChineseDate, formatFairPlay } from './core.mjs';
import { getKnockoutBracket } from './knockout.mjs';

const WIDTH = 1240;
const TABLE_X = 100;
const TABLE_WIDTH = 1040;
const COLUMNS = [72, 144, 72, 72, 60, 60, 60, 108, 96, 96, 200];
const HEADERS = ['排序', '球队', '场数', '积分', '胜', '平', '负', '净胜球', '进球数', '失球数', '公平竞赛积分'];

export function escapeXml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character]);
}

function text(x, y, value, { size = 24, weight = 400, color = '#202020', anchor = 'middle', family = 'sans' } = {}) {
  const font = family === 'serif'
    ? 'Songti SC, SimSun, Noto Serif CJK SC, serif'
    : 'PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif';
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="central" font-family="${font}" font-size="${size}" font-weight="${weight}" fill="${color}">${escapeXml(value)}</text>`;
}

function cell(x, y, width, height, fill) {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}" stroke="#c8cdd4" stroke-width="1.5"/>`;
}

export function buildPoster(competition, logoDataUri = '', { mode = 'groups' } = {}) {
  const standings = calculateStandings(competition);
  const groupSizes = standings.map(group => group.rows.length);
  const positionCount = standings.length ? Math.min(...groupSizes) : 0;
  const comparing = mode === 'cross-group' && standings.length > 1 && positionCount > 0;
  const uneven = new Set(groupSizes).size > 1;
  const comparisonNote = uneven
    ? '较多球队小组已剔除与本组最后一名比赛的全部成绩；公平竞赛积分保留。'
    : '各小组球队数量相同，不剔除比赛成绩；公平竞赛积分保留。';
  const sections = comparing ? Array.from({ length: positionCount }, (_, position) => ({
    name: `小组第 ${position + 1} 名 · 组间晋级比较`,
    note: position === 0 ? comparisonNote : null,
    rows: calculateCrossGroupStandings(competition, position).map(row => ({ ...row, name: `${row.groupName} · ${row.name}` })),
  })) : standings;
  if (!sections.length) sections.push({ name: '积分榜暂未生成', note: '尚未进行抽签和分组，完成分组后即可生成积分榜。', rows: [] });
  const tableHeight = 58 + sections.reduce((total, section) => total + (section.note ? 68 : 50) + section.rows.length * 52, 0);
  const tableY = 154;
  const tableBottom = tableY + tableHeight;
  const footerY = tableBottom + 86;
  const height = Math.max(1754, footerY + 100);
  const posterTitle = comparing
    ? (competition.title.includes('小组赛积分榜') ? competition.title.replace('小组赛积分榜', '组间晋级比较') : `${competition.title} · 组间晋级比较`)
    : competition.title;
  const titleSize = posterTitle.length > 31 ? 28 : posterTitle.length > 27 ? 32 : 36;
  const svg = [];

  svg.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">`);
  svg.push(`<rect width="${WIDTH}" height="${height}" fill="#ffffff"/>`);
  svg.push('<g shape-rendering="geometricPrecision">');
  if (logoDataUri) {
    svg.push(`<image x="100" y="65" width="65" height="64" preserveAspectRatio="xMidYMid meet" href="${escapeXml(logoDataUri)}"/>`);
  }
  svg.push(text(179, 99, posterTitle, { size: titleSize, weight: 700, color: '#1a1a1a', anchor: 'start', family: 'serif' }));

  let x = TABLE_X;
  for (let index = 0; index < HEADERS.length; index += 1) {
    svg.push(cell(x, tableY, COLUMNS[index], 58, '#326fc2'));
    svg.push(text(x + COLUMNS[index] / 2, tableY + 30, HEADERS[index], { size: 22, weight: 500, color: '#ffffff' }));
    x += COLUMNS[index];
  }

  let y = tableY + 58;
  for (const section of sections) {
    const headerHeight = section.note ? 68 : 50;
    svg.push(cell(TABLE_X, y, TABLE_WIDTH, headerHeight, '#e8eefb'));
    svg.push(text(TABLE_X + TABLE_WIDTH / 2, y + (section.note ? 22 : 26), section.name, { size: 25, weight: 600 }));
    if (section.note) svg.push(text(TABLE_X + TABLE_WIDTH / 2, y + 49, section.note, { size: 17, color: '#566174' }));
    y += headerHeight;

    for (let rowIndex = 0; rowIndex < section.rows.length; rowIndex += 1) {
      const row = section.rows[rowIndex];
      const values = [
        rowIndex + 1, row.name, row.played, row.points, row.wins, row.draws, row.losses,
        row.goalDifference, row.goalsFor, row.goalsAgainst, formatFairPlay(row.fairPlay),
      ];
      x = TABLE_X;
      for (let index = 0; index < values.length; index += 1) {
        svg.push(cell(x, y, COLUMNS[index], 52, '#ffffff'));
        const units = Array.from(String(values[index])).reduce((sum, ch) => sum + (ch.charCodeAt(0) > 255 ? 1 : .55), 0);
        const size = comparing && index === 1 ? Math.min(20, (COLUMNS[index] - 12) / Math.max(1, units)) : 23;
        svg.push(text(x + COLUMNS[index] / 2, y + 27, values[index], { size, weight: index === 3 ? 600 : 400 }));
        x += COLUMNS[index];
      }
      y += 52;
    }
  }

  svg.push(text(TABLE_X + TABLE_WIDTH, footerY, '北京大学足球协会竞赛部', { size: 23, anchor: 'end' }));
  svg.push(text(TABLE_X + TABLE_WIDTH, footerY + 39, formatChineseDate(competition.date), { size: 23, anchor: 'end' }));
  svg.push('</g></svg>');
  return { svg: svg.join(''), width: WIDTH, height };
}

function fittedSize(value, width, maximum = 22, minimum = 13) {
  const units = Array.from(String(value)).reduce((sum, character) => sum + (character.charCodeAt(0) > 255 ? 1 : .55), 0);
  return Math.max(minimum, Math.min(maximum, width / Math.max(1, units)));
}

function bracketLabel(x, y, value, width, options = {}) {
  const { maximum = 18, minimum = 10, ...style } = options;
  const full = String(value);
  const units = character => character.charCodeAt(0) > 255 ? 1 : .55;
  let label = full;
  if (Array.from(full).reduce((sum, ch) => sum + units(ch), 0) * minimum > width) {
    let used = 0;
    label = '';
    for (const ch of full) {
      if ((used + units(ch) + 1) * minimum > width) break;
      label += ch; used += units(ch);
    }
    label += '…';
  }
  return `<g><title>${escapeXml(full)}</title>${text(x, y, label, { ...style, size: fittedSize(label, width, maximum, minimum) })}</g>`;
}

export function buildKnockoutPoster(knockout) {
  const bracket = getKnockoutBracket(knockout);
  const matches = new Map(bracket.rounds.flatMap(round => round.matches).map(match => [match.id, match]));
  const final = bracket.rounds.at(-1).matches[0];
  const men = bracket.rounds.length === 4;
  const width = men ? 1600 : 1200;
  const center = width / 2;
  const pillWidth = 160;
  const pillHeight = 44;
  const finalPillWidth = 160;
  const top = men ? 190 : 220;
  const leafStride = 128;
  const xForLevel = (level, side) => {
    const offsets = men ? { 1: 250, 2: 440, 3: 630 } : { 1: 380 };
    const x = center - offsets[level] - (side === 'left' ? pillWidth : 0);
    return side === 'left' ? x : center + offsets[level];
  };
  const makeNode = (source, level, side) => {
    if (source?.bye) return { id: source.bye, kind: 'bye', level, side };
    const match = matches.get(source?.winner);
    const node = { id: match.id, kind: 'match', match, level, side, children: [] };
    if (match.homeSource || match.awaySource) {
      node.children = ['home', 'away'].map(teamSide => makeNode(match[`${teamSide}Source`], level + 1, side));
    }
    return node;
  };
  const roots = [
    makeNode(final.homeSource, 1, 'left'),
    makeNode(final.awaySource, 1, 'right'),
  ];
  for (const root of roots) {
    let leafIndex = 0;
    const position = node => {
      node.x = xForLevel(node.level, node.side);
      if (!node.children?.length) {
        node.centerY = top + 48 + leafIndex * leafStride;
        leafIndex += 1;
      } else {
        node.children.forEach(position);
        node.centerY = (node.children[0].centerY + node.children.at(-1).centerY) / 2;
      }
    };
    position(root);
  }
  const finalY = (roots[0].centerY + roots[1].centerY) / 2;
  const finalPositions = {
    home: { x: center - 44 - finalPillWidth, y: finalY },
    away: { x: center + 44, y: finalY },
  };
  const connectors = [];
  const pills = [];
  const details = [];
  const scoreGap = 24;
  const units = value => Array.from(String(value)).reduce((sum, ch) => sum + (ch.charCodeAt(0) > 255 ? 1 : .55), 0);
  const addPill = (slotX, y, maxWidth, match, side, chartSide) => {
    const name = match[side].name;
    const baseScore = match.legs.length === 2
      ? match.completed ? match[`${side}Aggregate`] : ''
      : match.legs[0][`${side}Score`] ?? '';
    const penalty = match.penalties?.[`${side}Score`];
    const score = baseScore === '' ? '' : penalty != null ? `${baseScore}(${penalty})` : String(baseScore);
    const scoreWidth = units(score) * 22;
    const width = Math.min(maxWidth, Math.max(132, units(name) * 26 + scoreWidth + 24 + (score ? scoreGap : 0)));
    const pill = { x: slotX + (chartSide === 'left' ? maxWidth - width : 0), y, width, match, side, chartSide, score, scoreWidth };
    pills.push(pill);
    return pill;
  };
  const connect = (node, targetX, targetY) => {
    const direction = node.side === 'left' ? 1 : -1;
    if (node.kind === 'bye') return;
    const baseX = node.x + (direction === 1 ? pillWidth : 0);
    const joinX = baseX + direction * 12;
    connectors.push(`<path d="M ${baseX} ${node.centerY - 26} H ${joinX} V ${node.centerY + 26} H ${baseX}"/>`);
    const elbow = (joinX + targetX) / 2;
    connectors.push(`<path d="M ${joinX} ${node.centerY} H ${elbow} V ${targetY} H ${targetX}"/>`);
  };
  const layoutNode = node => {
    if (node.kind === 'bye') return;
    const teamPills = [
      addPill(node.x, node.centerY - 26, pillWidth, node.match, 'home', node.side),
      addPill(node.x, node.centerY + 26, pillWidth, node.match, 'away', node.side),
    ];
    if (node.match.legs.length === 2) details.push(node);
    node.children?.forEach((child, index) => {
      layoutNode(child);
      const target = teamPills[index];
      connect(child, target.x + (node.side === 'right' ? target.width : 0), target.y);
    });
  };
  const finalPills = [
    addPill(finalPositions.home.x, finalY, finalPillWidth, final, 'home', 'left'),
    addPill(finalPositions.away.x, finalY, finalPillWidth, final, 'away', 'right'),
  ];
  roots.forEach((root, index) => {
    layoutNode(root);
    const target = finalPills[index];
    connect(root, target.x + (root.side === 'right' ? target.width : 0), target.y);
  });
  const footerY = top + (men ? 4 * leafStride : 170) + 80;
  const height = footerY + 90;
  const svg = [];
  svg.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
  svg.push('<defs><linearGradient id="knockout-pill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f2f2f2"/><stop offset="1" stop-color="#cdcdcd"/></linearGradient><linearGradient id="knockout-out" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#999999"/><stop offset="1" stop-color="#707070"/></linearGradient><filter id="knockout-shadow" x="-30%" y="-50%" width="160%" height="220%"><feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#000000" flood-opacity=".22"/></filter></defs>');
  svg.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);
  svg.push('<g shape-rendering="geometricPrecision">');
  svg.push(text(center, 72, bracket.title, { size: fittedSize(bracket.title, width - 160, 40, 25), weight: 800, color: '#111111' }));
  svg.push(`<g fill="none" stroke="#a84b55" stroke-width="1.6" stroke-linecap="butt" stroke-linejoin="miter">${connectors.join('')}</g>`);
  for (const pill of pills) {
    const team = pill.match[pill.side];
    const name = team.name;
    const winner = pill.match.winnerName && pill.match.winnerName === team.name;
    const eliminated = pill.match.winnerName && team.name && !winner;
    const nameColor = eliminated ? '#f3f3f3' : team.name ? '#a32636' : '#888888';
    svg.push(`<rect x="${pill.x}" y="${pill.y - pillHeight / 2}" width="${pill.width}" height="${pillHeight}" rx="22" fill="url(#${eliminated ? 'knockout-out' : 'knockout-pill'})"${winner ? ' stroke="#ad2638" stroke-width="2"' : ''} filter="url(#knockout-shadow)"/>`);
    const mirrored = pill.chartSide === 'right';
    const labelWidth = pill.width - 24 - pill.scoreWidth - (pill.score ? scoreGap : 0);
    svg.push(bracketLabel(mirrored ? pill.x + pill.width - 12 : pill.x + 12, pill.y, name, labelWidth, { maximum: 26, minimum: 12, weight: 700, anchor: mirrored ? 'end' : 'start', color: nameColor }));
    svg.push(text(mirrored ? pill.x + 12 : pill.x + pill.width - 12, pill.y, pill.score, { size: 22, weight: winner ? 800 : 600, anchor: mirrored ? 'start' : 'end', color: eliminated ? '#f3f3f3' : winner ? '#a32636' : '#333333' }));
  }
  for (const node of details) {
    const legText = node.match.legs.map((leg, index) => leg.homeScore != null || leg.awayScore != null ? `${index === 0 ? '首回合' : '次回合'} ${leg.homeScore ?? ''}:${leg.awayScore ?? ''}` : '').filter(Boolean).join(' · ');
    svg.push(text(node.x + pillWidth / 2, node.centerY + 66, legText, { size: 14, color: '#777777' }));
  }
  svg.push(text(center, finalY, 'VS', { size: 56, weight: 700, color: '#b2b2b2' }));
  if (final.winnerName) svg.push(text(center, finalY + 70, `冠军 · ${final.winnerName}`, { size: 25, weight: 700, color: '#a32636' }));
  svg.push(text(width - 70, footerY, '北京大学足球协会竞赛部', { size: 20, anchor: 'end', color: '#333333' }));
  svg.push(text(width - 70, footerY + 34, formatChineseDate(bracket.date), { size: 20, anchor: 'end', color: '#333333' }));
  svg.push('</g></svg>');
  return { svg: svg.join(''), width, height };
}

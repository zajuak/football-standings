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

function bracketPath(x, top, bottom, direction) {
  const middle = (top + bottom) / 2;
  const bend = 10 * direction;
  const tip = 20 * direction;
  return `M ${x} ${top} C ${x + bend} ${top}, ${x + bend} ${top + 10}, ${x + bend} ${middle - 12} Q ${x + bend} ${middle}, ${x + tip} ${middle} Q ${x + bend} ${middle}, ${x + bend} ${middle + 12} C ${x + bend} ${bottom - 10}, ${x + bend} ${bottom}, ${x} ${bottom}`;
}

export function buildKnockoutPoster(knockout) {
  const bracket = getKnockoutBracket(knockout);
  const matches = new Map(bracket.rounds.flatMap(round => round.matches).map(match => [match.id, match]));
  const byes = new Map(bracket.rounds.flatMap(round => round.byes ?? []).map(bye => [bye.id, bye]));
  const final = bracket.rounds.at(-1).matches[0];
  const men = bracket.rounds.length === 4;
  const width = men ? 1800 : 1400;
  const center = width / 2;
  const pillWidth = 170;
  const pillHeight = 44;
  const finalPillWidth = 130;
  const top = men ? 190 : 220;
  const leafStride = 128;
  const xForLevel = (level, side) => {
    const offsets = men ? { 1: 250, 2: 450, 3: 650 } : { 1: 400 };
    const x = center - offsets[level] - (side === 'left' ? pillWidth : 0);
    return side === 'left' ? x : center + offsets[level];
  };
  const makeNode = (source, level, side) => {
    if (source?.bye) return { id: source.bye, kind: 'bye', bye: byes.get(source.bye), level, side };
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
    home: { x: center - 190, y: finalY },
    away: { x: center + 60, y: finalY },
  };
  const connectors = [];
  const pills = [];
  const badges = [];
  const details = [];
  const addPill = (x, y, width, match, side) => pills.push({ x, y, width, match, side });
  const connect = (node, targetX, targetY) => {
    const direction = node.side === 'left' ? 1 : -1;
    if (node.kind === 'bye') {
      const startX = node.x + (direction === 1 ? pillWidth + 8 : -8);
      const elbow = (startX + targetX) / 2;
      connectors.push(`<path d="M ${startX} ${node.centerY} H ${elbow} V ${targetY} H ${targetX}"/>`);
      return;
    }
    const baseX = node.x + (direction === 1 ? pillWidth + 8 : -8);
    const tipX = baseX + direction * 20;
    connectors.push(`<path d="${bracketPath(baseX, node.centerY - 26, node.centerY + 26, direction)}"/>`);
    const elbow = (tipX + targetX) / 2;
    connectors.push(`<path d="M ${tipX} ${node.centerY} H ${elbow} V ${targetY} H ${targetX}"/>`);
  };
  const layoutNode = node => {
    if (node.kind === 'bye') {
      badges.push(node);
      return;
    }
    addPill(node.x, node.centerY - 26, pillWidth, node.match, 'home');
    addPill(node.x, node.centerY + 26, pillWidth, node.match, 'away');
    if (node.match.legs.length === 2) details.push(node);
    node.children?.forEach((child, index) => {
      layoutNode(child);
      connect(child, node.x + (node.side === 'right' ? pillWidth : 0), node.centerY + (index === 0 ? -26 : 26));
    });
  };
  roots.forEach((root, index) => {
    layoutNode(root);
    const side = index === 0 ? 'home' : 'away';
    const target = finalPositions[side];
    connect(root, target.x + (root.side === 'right' ? finalPillWidth : 0), target.y);
  });
  addPill(finalPositions.home.x, finalY, finalPillWidth, final, 'home');
  addPill(finalPositions.away.x, finalY, finalPillWidth, final, 'away');
  const footerY = top + (men ? 4 * leafStride : 170) + 80;
  const height = footerY + 90;
  const svg = [];
  svg.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
  svg.push('<defs><linearGradient id="knockout-pill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f2f2f2"/><stop offset="1" stop-color="#cdcdcd"/></linearGradient><linearGradient id="knockout-out" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#999999"/><stop offset="1" stop-color="#707070"/></linearGradient><filter id="knockout-shadow" x="-30%" y="-50%" width="160%" height="220%"><feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#000000" flood-opacity=".22"/></filter></defs>');
  svg.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);
  svg.push('<g shape-rendering="geometricPrecision">');
  svg.push(text(center, 72, bracket.title, { size: fittedSize(bracket.title, width - 160, 40, 25), weight: 800, color: '#111111' }));
  const roundLabels = men
    ? [[xForLevel(3, 'left') + pillWidth / 2, bracket.rounds[0].name], [xForLevel(2, 'left') + pillWidth / 2, bracket.rounds[1].name], [xForLevel(1, 'left') + pillWidth / 2, bracket.rounds[2].name], [xForLevel(1, 'right') + pillWidth / 2, bracket.rounds[2].name], [xForLevel(2, 'right') + pillWidth / 2, bracket.rounds[1].name], [xForLevel(3, 'right') + pillWidth / 2, bracket.rounds[0].name]]
    : [[xForLevel(1, 'left') + pillWidth / 2, bracket.rounds[0].name], [xForLevel(1, 'right') + pillWidth / 2, bracket.rounds[0].name]];
  for (const [x, label] of roundLabels) svg.push(text(x, 146, label, { size: 18, weight: 600, color: '#777777' }));
  svg.push(text(center, finalY - 82, bracket.rounds.at(-1).name, { size: 18, weight: 600, color: '#777777' }));
  svg.push(`<g fill="none" stroke="#a84b55" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${connectors.join('')}</g>`);
  for (const pill of pills) {
    const team = pill.match[pill.side];
    const name = team.name || (team.source ? '待晋级' : '待填球队');
    const winner = pill.match.winnerName && pill.match.winnerName === team.name;
    const eliminated = pill.match.winnerName && team.name && !winner;
    const doubleLeg = pill.match.legs.length === 2;
    let score = '–';
    if (doubleLeg && pill.match.completed) score = pill.match[`${pill.side}Aggregate`];
    if (!doubleLeg && Number.isInteger(pill.match.legs[0][`${pill.side}Score`])) score = pill.match.legs[0][`${pill.side}Score`];
    const nameColor = eliminated ? '#f3f3f3' : team.name ? '#a32636' : '#888888';
    svg.push(`<rect x="${pill.x}" y="${pill.y - pillHeight / 2}" width="${pill.width}" height="${pillHeight}" rx="22" fill="url(#${eliminated ? 'knockout-out' : 'knockout-pill'})"${winner ? ' stroke="#ad2638" stroke-width="2"' : ''} filter="url(#knockout-shadow)"/>`);
    svg.push(bracketLabel(pill.x + 15, pill.y, name, pill.width - 62, { weight: 700, anchor: 'start', color: nameColor }));
    svg.push(text(pill.x + pill.width - 14, pill.y, score, { size: 18, weight: winner ? 800 : 600, anchor: 'end', color: eliminated ? '#f3f3f3' : winner ? '#a32636' : '#333333' }));
  }
  for (const badge of badges) {
    const name = badge.bye?.name || '待填轮空球队';
    svg.push(`<rect x="${badge.x}" y="${badge.centerY - pillHeight / 2}" width="${pillWidth}" height="${pillHeight}" rx="22" fill="url(#knockout-pill)" filter="url(#knockout-shadow)"/>`);
    svg.push(bracketLabel(badge.x + pillWidth / 2, badge.centerY, name, pillWidth - 24, { weight: 700, color: badge.bye?.name ? '#a32636' : '#888888' }));
  }
  for (const node of details) {
    const legText = node.match.legs.map((leg, index) => `${index === 0 ? '首回合' : '次回合'} ${leg.homeScore ?? '–'}:${leg.awayScore ?? '–'}`).join(' · ');
    svg.push(text(node.x + pillWidth / 2, node.centerY + 66, legText, { size: 14, color: '#777777' }));
  }
  svg.push(text(center, finalY, 'VS', { size: 56, weight: 700, color: '#b2b2b2' }));
  if (final.winnerName) svg.push(text(center, finalY + 70, `冠军 · ${final.winnerName}`, { size: 25, weight: 700, color: '#a32636' }));
  svg.push(text(width - 70, footerY, '北京大学足球协会竞赛部', { size: 20, anchor: 'end', color: '#333333' }));
  svg.push(text(width - 70, footerY + 34, formatChineseDate(bracket.date), { size: 20, anchor: 'end', color: '#333333' }));
  svg.push('</g></svg>');
  return { svg: svg.join(''), width, height };
}

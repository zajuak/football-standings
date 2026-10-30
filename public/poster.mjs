import { calculateCrossGroupStandings, calculateStandings, formatChineseDate, formatFairPlay } from './core.mjs';

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

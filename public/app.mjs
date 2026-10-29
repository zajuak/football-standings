import {
  STORAGE_KEY, calculateMatchFairPlay, calculateStandings, createId, createInitialState, createResult,
  formatFairPlay, getActiveCompetition, getMatchFairPlay, isValidState, migrateState, updateResult,
} from './core.mjs';
import { buildPoster, escapeXml } from './poster.mjs';
import { LocalHistory, LOCAL_QUEUE_KEY as SYNC_KEY } from './local-history.mjs';
import { validSnapshot } from './snapshot.mjs';
import { CloudSync } from './cloud-sync.mjs';

const $ = id => document.getElementById(id);
const elements = {
  saveStatus: $('save-status'), title: $('competition-title'), date: $('competition-date'),
  summary: $('competition-summary'), matchForm: $('match-form'), matchGroup: $('match-group'),
  homeTeam: $('home-team'), awayTeam: $('away-team'), homeScore: $('home-score'), awayScore: $('away-score'),
  formError: $('form-error'), addResult: $('add-result'), resultCount: $('result-count'),
  resultsList: $('results-list'), teamManagement: $('team-management'), poster: $('poster'),
  toast: $('toast'), downloadPng: $('download-png'),
};

function loadState() {
  try {
    const pending = JSON.parse(localStorage.getItem(SYNC_KEY) || 'null')?.at(-1)?.state;
    const saved = pending ?? JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    const currentRevision = saved?.revision === 2 || saved?.revision === 3;
    if (isValidState(saved) && currentRevision && saved.competitions.some(item => item.id === saved.activeCompetitionId)) {
      return migrateState(saved);
    }
  } catch (error) {
    console.warn('无法读取已保存的积分榜数据。', error);
  }
  return createInitialState();
}

let state = loadState();
let logoDataUri = '';
let currentPoster;
let toastTimer;
let editingMatchId = null;
let cardsTouched = { home: false, away: false };

function competition() {
  return getActiveCompetition(state);
}

const sync = new LocalHistory({
  storage: { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) },
  onStatus(message, error = false) {
    elements.saveStatus.classList.toggle('is-error', error);
    elements.saveStatus.replaceChildren();
    const dot = document.createElement('span'); dot.className = 'status-dot';
    elements.saveStatus.append(dot, document.createTextNode(message));
    if (!error && !sync.queue.length && $('history-panel').open) void showHistory();
    $('pending-count').textContent = sync.queue.length ? `本机还有 ${sync.queue.length} 次提交等待存档，关闭页面前请确认已保存到本机。` : '历史仅保存在当前浏览器；清理浏览器数据前请导出完整备份。';
  },
  onState(saved) {
    if (!validSnapshot(saved)) throw new Error('本机历史数据格式异常，请先导出备份');
    state = migrateState(saved);
    cancelEdit(); renderAll(true);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  },
});

const cloud = new CloudSync({
  storage: { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) },
  onStatus(message, error = false) {
    $('cloud-status').textContent = message;
    $('cloud-status').classList.toggle('is-error', error);
    $('cloud-conflict').hidden = !cloud.conflict;
    if (error || cloud.conflict) $('cloud-panel').open = true;
    if (!error && !cloud.queue.length && $('history-panel').open && $('history-source').value === 'cloud') void showHistory();
  },
});

function save(action = '修改赛事设置') {
  sync.enqueue(state, action);
  if (cloud.ready && cloud.selected) cloud.enqueue(state, action);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

function toast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add('is-visible');
  toastTimer = setTimeout(() => elements.toast.classList.remove('is-visible'), 2400);
}

function option(value, label, selected = false) {
  return `<option value="${escapeXml(value)}"${selected ? ' selected' : ''}>${escapeXml(label)}</option>`;
}

function renderPreview() {
  currentPoster = buildPoster(competition(), logoDataUri);
  elements.poster.innerHTML = currentPoster.svg;
}

function renderCompetition() {
  const current = competition();
  document.querySelectorAll('[data-competition]').forEach(button => {
    const active = button.dataset.competition === current.id;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  elements.title.value = current.title;
  elements.date.value = current.date;
  const teamCount = current.groups.reduce((total, selectedGroup) => total + selectedGroup.teams.length, 0);
  elements.summary.textContent = `${teamCount} 支球队 · ${current.matches.length} 场新增赛果`;
}

function renderMatchTeams(reset = false) {
  const selectedGroup = competition().groups.find(item => item.id === elements.matchGroup.value) ?? competition().groups[0];
  const teams = selectedGroup?.teams ?? [];
  const previousHome = reset ? '' : elements.homeTeam.value;
  const previousAway = reset ? '' : elements.awayTeam.value;
  elements.homeTeam.innerHTML = teams.length
    ? teams.map(item => option(item.id, item.name)).join('')
    : '<option value="">请先添加球队</option>';
  elements.awayTeam.innerHTML = teams.length
    ? teams.map(item => option(item.id, item.name)).join('')
    : '<option value="">请先添加球队</option>';
  elements.homeTeam.value = teams.some(item => item.id === previousHome) ? previousHome : (teams[0]?.id ?? '');
  elements.awayTeam.value = teams.some(item => item.id === previousAway) ? previousAway : (teams[1]?.id ?? teams[0]?.id ?? '');
  $('home-cards-team').textContent = `${teams.find(item => item.id === elements.homeTeam.value)?.name ?? '球队一'} · 红黄牌`;
  $('away-cards-team').textContent = `${teams.find(item => item.id === elements.awayTeam.value)?.name ?? '球队二'} · 红黄牌`;
  elements.homeTeam.disabled = teams.length < 2;
  elements.awayTeam.disabled = teams.length < 2;
  elements.homeScore.disabled = teams.length < 2;
  elements.awayScore.disabled = teams.length < 2;
  elements.addResult.disabled = teams.length < 2;
  updateCardPreviews();
}

function renderMatchForm(resetTeams = false) {
  const current = competition();
  const previousGroup = elements.matchGroup.value;
  const selectedGroup = current.groups.find(item => item.id === previousGroup) ?? current.groups[0];
  elements.matchGroup.innerHTML = current.groups.length
    ? current.groups.map(item => option(item.id, item.name)).join('')
    : '<option value="">请先添加小组</option>';
  if (selectedGroup) elements.matchGroup.value = selectedGroup.id;
  renderMatchTeams(resetTeams);
}

function renderResults() {
  const current = competition();
  elements.resultCount.textContent = `${current.matches.length} 场`;
  if (!current.matches.length) {
    elements.resultsList.innerHTML = '<div class="empty-results">尚未录入新赛果，当前显示 Word 中的初始数据</div>';
    return;
  }
  elements.resultsList.innerHTML = current.matches.slice().reverse().map(match => {
    const selectedGroup = current.groups.find(item => item.id === match.groupId);
    const home = selectedGroup?.teams.find(item => item.id === match.homeId);
    const away = selectedGroup?.teams.find(item => item.id === match.awayId);
    if (!selectedGroup || !home || !away) return '';
    return `<div class="result-item">
      <span class="result-group">${escapeXml(selectedGroup.name)}</span>
      <div class="result-teams"><span>${escapeXml(home.name)}</span><span>${escapeXml(away.name)}</span></div>
      <strong class="result-score">${match.homeScore} : ${match.awayScore}</strong>
      <div class="result-actions">
        <button class="result-edit" type="button" data-edit-match="${escapeXml(match.id)}" title="修改该场赛果" aria-label="修改 ${escapeXml(home.name)} 对 ${escapeXml(away.name)} 的赛果">修改</button>
        <button class="icon-button" type="button" data-delete-match="${escapeXml(match.id)}" title="删除该场赛果" aria-label="删除 ${escapeXml(home.name)} 对 ${escapeXml(away.name)} 的赛果">×</button>
      </div>
      <span class="result-fairplay">${match.round ? `${escapeXml(match.round)} · ` : ''}单场公平竞赛积分 ${formatFairPlay(getMatchFairPlay(match, 'home'))} : ${formatFairPlay(getMatchFairPlay(match, 'away'))}</span>
    </div>`;
  }).join('');
}

function renderManagement() {
  const current = competition();
  const rows = new Map(calculateStandings(current).flatMap(selectedGroup => selectedGroup.rows).map(row => [row.id, row]));
  elements.teamManagement.innerHTML = '<div class="manager-legend"><span>球队 / 当前总公平竞赛积分</span><span>纪律扣分</span><span>抽签顺序</span><span></span></div>' + current.groups.map(selectedGroup => `
    <section class="manager-group">
      <div class="manager-group-header">
        <input class="manager-group-name" data-group-name="${escapeXml(selectedGroup.id)}" value="${escapeXml(selectedGroup.name)}" aria-label="小组名称" maxlength="10">
        <button class="icon-button" type="button" data-delete-group="${escapeXml(selectedGroup.id)}" title="删除小组" aria-label="删除 ${escapeXml(selectedGroup.name)}">×</button>
      </div>
      ${selectedGroup.teams.length ? selectedGroup.teams.map(item => `
        <div class="manager-team-row">
          <div class="manager-team-main">
            <input data-team-name="${escapeXml(item.id)}" value="${escapeXml(item.name)}" aria-label="球队名称" maxlength="20">
            <span class="manager-fair-play">总公平竞赛积分 <strong class="fair-play-value">${formatFairPlay(rows.get(item.id).fairPlay)}</strong></span>
          </div>
          <input class="discipline-input" data-discipline="${escapeXml(item.id)}" type="number" min="0" max="99" step="1" value="${Number(item.disciplineDeduction) || 0}" aria-label="${escapeXml(item.name)}纪律处罚扣分" title="纪律处罚扣分">
          <input class="discipline-input" data-draw-order="${escapeXml(item.id)}" type="number" min="1" max="99" step="1" value="${item.drawOrder ?? ''}" placeholder="—" aria-label="${escapeXml(item.name)}抽签顺序" title="所有排名指标仍相同时使用的抽签顺序">
          <button class="icon-button" type="button" data-delete-team="${escapeXml(item.id)}" title="删除球队" aria-label="删除 ${escapeXml(item.name)}">×</button>
        </div>`).join('') : '<div class="manager-empty">该小组还没有球队</div>'}
      <button class="add-team" type="button" data-add-team="${escapeXml(selectedGroup.id)}">+ 添加球队</button>
    </section>`).join('');
}

function renderAll(resetTeams = false) {
  renderCompetition();
  renderMatchForm(resetTeams);
  renderResults();
  renderManagement();
  renderPreview();
}

function findTeam(teamId) {
  for (const selectedGroup of competition().groups) {
    const item = selectedGroup.teams.find(candidate => candidate.id === teamId);
    if (item) return { team: item, group: selectedGroup };
  }
  return {};
}

const CARD_IDS = {
  yellow: 'yellow',
  secondYellowRed: 'second-yellow-red',
  directRed: 'direct-red',
  yellowDirectRed: 'yellow-direct-red',
};

function readCards(prefix) {
  return Object.fromEntries(Object.entries(CARD_IDS).map(([key, id]) => [key, Number($(`${prefix}-${id}`).value) || 0]));
}

function editingMatch() {
  return competition().matches.find(match => match.id === editingMatchId);
}

function preservedFairPlay(side) {
  if (!editingMatchId || cardsTouched[side]) return undefined;
  const score = editingMatch()?.[`${side}FairPlay`];
  return Number.isFinite(score) ? score : undefined;
}

function updateCardPreviews() {
  for (const side of ['home', 'away']) {
    const preserved = preservedFairPlay(side);
    $(`${side}-fair-play`).textContent = formatFairPlay(preserved ?? calculateMatchFairPlay(readCards(side)));
  }
}

function resetMatchInputs() {
  elements.homeScore.value = '';
  elements.awayScore.value = '';
  document.querySelectorAll('.card-inputs input').forEach(input => { input.value = '0'; });
  updateCardPreviews();
}

function cancelEdit() {
  editingMatchId = null;
  cardsTouched = { home: false, away: false };
  $('edit-banner').hidden = true;
  $('edit-match-label').textContent = '';
  elements.addResult.textContent = '录入赛果并更新积分榜';
  resetMatchInputs();
}

function startEdit(matchId) {
  const match = competition().matches.find(item => item.id === matchId);
  if (!match) return;
  cancelEdit();
  editingMatchId = match.id;
  cardsTouched = { home: false, away: false };
  elements.matchGroup.value = match.groupId;
  for (const side of ['home', 'away']) {
    for (const [key, id] of Object.entries(CARD_IDS)) {
      $(`${side}-${id}`).value = match[`${side}Cards`]?.[key] ?? 0;
    }
  }
  renderMatchTeams(true);
  elements.homeTeam.value = match.homeId;
  elements.awayTeam.value = match.awayId;
  renderMatchTeams();
  elements.homeScore.value = match.homeScore;
  elements.awayScore.value = match.awayScore;
  const { team: home } = findTeam(match.homeId);
  const { team: away } = findTeam(match.awayId);
  $('edit-match-label').textContent = `${match.round ? `${match.round} · ` : ''}${home?.name ?? ''} ${match.homeScore} : ${match.awayScore} ${away?.name ?? ''}`;
  $('edit-banner').hidden = false;
  elements.addResult.textContent = '保存修改并更新积分榜';
  elements.formError.textContent = '';
  updateCardPreviews();
  elements.matchForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportName(extension) {
  const name = competition().title.replace(/[\\/:*?"<>|]/g, '_');
  return `${name}.${extension}`;
}

for (const button of document.querySelectorAll('[data-competition]')) {
  button.addEventListener('click', () => {
    if (button.dataset.competition === state.activeCompetitionId) return;
    state.activeCompetitionId = button.dataset.competition;
    elements.formError.textContent = '';
    cancelEdit();
    save('切换赛事');
    renderAll(true);
  });
}

elements.title.addEventListener('input', () => {
  competition().title = elements.title.value;
  save();
  renderPreview();
});
elements.date.addEventListener('input', () => {
  competition().date = elements.date.value;
  save();
  renderPreview();
});
elements.matchGroup.addEventListener('change', () => {
  elements.formError.textContent = '';
  if (editingMatchId) cardsTouched = { home: true, away: true };
  renderMatchTeams(true);
});
for (const [side, select] of [['home', elements.homeTeam], ['away', elements.awayTeam]]) {
  select.addEventListener('change', () => {
    elements.formError.textContent = '';
    if (editingMatchId) cardsTouched[side] = true;
    renderMatchTeams();
  });
}
document.querySelectorAll('.card-inputs input').forEach(input => input.addEventListener('input', () => {
  const side = input.id.startsWith('home-') ? 'home' : 'away';
  if (editingMatchId) cardsTouched[side] = true;
  updateCardPreviews();
}));
$('cancel-edit').addEventListener('click', cancelEdit);

elements.matchForm.addEventListener('submit', event => {
  event.preventDefault();
  try {
    const values = {
      groupId: elements.matchGroup.value,
      homeId: elements.homeTeam.value,
      awayId: elements.awayTeam.value,
      homeScore: elements.homeScore.value === '' ? NaN : Number(elements.homeScore.value),
      awayScore: elements.awayScore.value === '' ? NaN : Number(elements.awayScore.value),
      homeCards: readCards('home'),
      awayCards: readCards('away'),
      homeFairPlay: preservedFairPlay('home'),
      awayFairPlay: preservedFairPlay('away'),
    };
    const current = competition();
    const wasEditing = Boolean(editingMatchId);
    if (wasEditing) {
      const updated = updateResult(current, editingMatchId, values);
      current.matches = current.matches.map(match => match.id === editingMatchId ? updated : match);
    } else {
      current.matches.push(createResult(current, values));
    }
    cancelEdit();
    elements.formError.textContent = '';
    save(wasEditing ? '修改比赛赛果' : '录入比赛赛果');
    renderAll();
    toast(wasEditing ? '赛果修改已加入保存队列' : '赛果已更新，正在保存到本机');
  } catch (error) {
    elements.formError.textContent = error.message;
  }
});

elements.resultsList.addEventListener('click', event => {
  const editButton = event.target.closest('[data-edit-match]');
  if (editButton) {
    startEdit(editButton.dataset.editMatch);
    return;
  }
  const button = event.target.closest('[data-delete-match]');
  if (!button) return;
  const current = competition();
  current.matches = current.matches.filter(match => match.id !== button.dataset.deleteMatch);
  if (editingMatchId === button.dataset.deleteMatch) cancelEdit();
  save('删除比赛赛果');
  renderAll();
  toast('已撤销该场赛果');
});

elements.teamManagement.addEventListener('input', event => {
  const input = event.target;
  if (input.dataset.teamName) {
    const { team } = findTeam(input.dataset.teamName);
    if (team) team.name = input.value;
  } else if (input.dataset.discipline) {
    const { team } = findTeam(input.dataset.discipline);
    if (team) {
      team.disciplineDeduction = Math.max(0, Math.min(99, Number(input.value) || 0));
      const row = calculateStandings(competition()).flatMap(selectedGroup => selectedGroup.rows).find(item => item.id === team.id);
      const value = input.closest('.manager-team-row').querySelector('.fair-play-value');
      value.textContent = formatFairPlay(row.fairPlay);
    }
  } else if (input.dataset.drawOrder) {
    const { team } = findTeam(input.dataset.drawOrder);
    if (team) team.drawOrder = input.value === '' ? null : Math.max(1, Math.min(99, Math.round(Number(input.value) || 1)));
  } else if (input.dataset.groupName) {
    const selectedGroup = competition().groups.find(item => item.id === input.dataset.groupName);
    if (selectedGroup) selectedGroup.name = input.value;
  } else return;
  save();
  renderPreview();
});

elements.teamManagement.addEventListener('change', event => {
  if (event.target.dataset.teamName || event.target.dataset.groupName) {
    renderMatchForm();
    renderResults();
  }
});

elements.teamManagement.addEventListener('click', event => {
  const addButton = event.target.closest('[data-add-team]');
  const deleteButton = event.target.closest('[data-delete-team]');
  const groupButton = event.target.closest('[data-delete-group]');
  const current = competition();

  if (addButton) {
    const selectedGroup = current.groups.find(item => item.id === addButton.dataset.addTeam);
    if (!selectedGroup) return;
    const newTeam = {
      id: createId('team'), name: `新球队${selectedGroup.teams.length + 1}`,
      base: { played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 }, fairPlay: 5, disciplineDeduction: 0, drawOrder: null,
    };
    selectedGroup.teams.push(newTeam);
    save();
    renderAll();
    const input = elements.teamManagement.querySelector(`[data-team-name="${newTeam.id}"]`);
    input?.focus();
    input?.select();
  } else if (deleteButton) {
    const { team, group: selectedGroup } = findTeam(deleteButton.dataset.deleteTeam);
    if (!team) return;
    const relatedResults = current.matches.filter(match => match.homeId === team.id || match.awayId === team.id).length;
    if (!confirm(`确定删除“${team.name}”吗？${relatedResults ? `相关的 ${relatedResults} 场赛果也会删除。` : ''}`)) return;
    selectedGroup.teams = selectedGroup.teams.filter(item => item.id !== team.id);
    current.matches = current.matches.filter(match => match.homeId !== team.id && match.awayId !== team.id);
    if (editingMatchId && !editingMatch()) cancelEdit();
    save();
    renderAll(true);
  } else if (groupButton) {
    if (current.groups.length === 1) {
      toast('至少需要保留一个小组');
      return;
    }
    const selectedGroup = current.groups.find(item => item.id === groupButton.dataset.deleteGroup);
    if (!selectedGroup || !confirm(`确定删除“${selectedGroup.name}”及其中所有球队和赛果吗？`)) return;
    const teamIds = new Set(selectedGroup.teams.map(item => item.id));
    current.groups = current.groups.filter(item => item.id !== selectedGroup.id);
    current.matches = current.matches.filter(match => !teamIds.has(match.homeId) && !teamIds.has(match.awayId));
    if (editingMatchId && !editingMatch()) cancelEdit();
    save();
    renderAll(true);
  }
});

$('add-group').addEventListener('click', () => {
  const current = competition();
  const index = current.groups.length;
  const name = index < 26 ? `${String.fromCharCode(65 + index)}组` : `G${index + 1}组`;
  current.groups.push({ id: createId('group'), name, teams: [] });
  save();
  renderAll();
});

$('reset-competition').addEventListener('click', () => {
  const current = competition();
  if (!confirm(`确定将“${current.shortName}”恢复为初始数据吗？当前积分榜会恢复为初始数据，已有提交仍保留在历史记录中。`)) return;
  const initial = createInitialState().competitions.find(item => item.id === current.id);
  const index = state.competitions.findIndex(item => item.id === current.id);
  state.competitions[index] = initial;
  cancelEdit();
  save('恢复赛事初始数据');
  renderAll(true);
  toast('当前赛事已恢复，旧数据保留在历史记录中');
});

$('download-svg').addEventListener('click', () => {
  download(new Blob([currentPoster.svg], { type: 'image/svg+xml;charset=utf-8' }), exportName('svg'));
  toast('SVG 图片已导出');
});

elements.downloadPng.addEventListener('click', async () => {
  elements.downloadPng.disabled = true;
  try {
    const { svg, width, height } = currentPoster;
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    const image = new Image();
    const loaded = new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('图片渲染失败，请改用 SVG 导出。'));
    });
    image.src = url;
    await loaded;
    const scale = Math.min(2, 16384 / width, 16384 / height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器不支持 PNG 导出。');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('图片过大，请改用 SVG 导出。');
    download(blob, exportName('png'));
    toast('2 倍高清 PNG 已导出');
  } catch (error) {
    toast(error.message || '导出失败，请稍后重试');
  } finally {
    elements.downloadPng.disabled = false;
  }
});

renderAll(true);
void sync.init(state);
window.addEventListener('online', () => { void sync.retry(state); if (cloud.ready) void cloud.retry(); });
setInterval(() => { if (sync.queue.length) void sync.retry(state); if (cloud.ready && cloud.queue.length && !cloud.conflict) void cloud.retry(); }, 15000);
window.addEventListener('beforeunload', event => {
  if (sync.queue.length || cloud.queue.length) { event.preventDefault(); event.returnValue = ''; }
});
$('retry-sync').addEventListener('click', async () => {
  await sync.retry(state);
  if (!sync.queue.length) toast('本机历史存档已完成');
});
$('open-history').addEventListener('click', () => { $('history-panel').open = true; $('history-panel').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
let historyCursor = null;
function historySource() {
  if ($('history-source').value !== 'cloud') return sync;
  if (!cloud.ready) throw new Error('请先连接云端');
  return cloud;
}
$('history-source').addEventListener('change', () => { void showHistory(); });
async function showHistory(append = false) {
  const list = $('history-list');
  const button = $('more-history'); button.disabled = true;
  try {
    const page = await historySource().request(`?history=1${append && historyCursor ? `&before=${historyCursor}` : ''}`);
    if (!append) list.replaceChildren();
    if (!page.items.length && !append) list.textContent = '暂无本机历史记录。';
    for (const item of page.items) {
      const row = document.createElement('div'); row.className = 'history-item';
      const label = document.createElement('span');
      label.textContent = `版本 ${item.revision} · ${item.action}${item.applied ? '' : '（历史存档）'}`;
      const time = document.createElement('small'); time.textContent = new Date(item.created_at).toLocaleString('zh-CN', { hour12: false });
      const restore = document.createElement('button'); restore.type = 'button'; restore.className = 'button button-secondary'; restore.textContent = '恢复此版本';
      restore.addEventListener('click', async () => {
        if (sync.queue.length) { toast('请先等待当前修改保存完成'); return; }
        restore.disabled = true;
        try {
          const record = await historySource().request(`?revision=${item.revision}`);
          if (!isValidState(record.state)) throw new Error('历史数据格式异常');
          if (!confirm(`恢复到版本 ${item.revision}？当前版本也会继续保留在历史中。`)) return;
          state = migrateState(record.state); cancelEdit(); renderAll(true);
          if ($('history-source').value === 'cloud') cloud.selected = true;
          save(`恢复历史版本 ${item.revision}`);
          await sync.flush(); await showHistory();
        } catch (error) { toast(error.message); }
        finally { restore.disabled = false; }
      });
      const description = document.createElement('div'); description.append(label, time); row.append(description, restore); list.append(row);
    }
    historyCursor = page.next; button.hidden = !historyCursor;
  } catch (error) { if (!append) list.textContent = error.message; else toast(error.message); }
  finally { button.disabled = false; }
}
$('history-panel').addEventListener('toggle', () => { if ($('history-panel').open) void showHistory(); });
$('refresh-history').addEventListener('click', () => { void showHistory(); });
$('more-history').addEventListener('click', () => { void showHistory(true); });
$('export-current').addEventListener('click', () => {
  download(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }), '积分榜当前数据.json');
});
$('export-history').addEventListener('click', async () => {
  const button = $('export-history'); button.disabled = true;
  try {
    const items = []; let before = null;
    do {
      const page = await historySource().request(`?history=1&full=1${before ? `&before=${before}` : ''}`);
      items.push(...page.items); before = page.next;
    } while (before);
    const backup = { format: 'pku-football-history-v1', exportedAt: new Date().toISOString(), state, pending: [...sync.queue, ...cloud.queue], items };
    download(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }), '积分榜完整历史.json');
    toast(`已导出 ${items.length} 条历史及 ${sync.queue.length + cloud.queue.length} 条待存档提交`);
  } catch (error) { toast(`完整历史导出失败：${error.message}，可先导出当前数据`); }
  finally { button.disabled = false; }
});
$('import-data').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    const value = JSON.parse(await file.text()); const imported = value.state ?? value;
    if (!validSnapshot(imported)) throw new Error('请选择积分榜导出的 JSON 数据文件');
    const records = [...(value.items ?? []).slice().reverse(), ...(value.pending ?? [])];
    if (!records.every(record => validSnapshot(record.state))) throw new Error('备份中的历史数据格式不正确');
    if (!confirm(`导入当前数据${records.length ? `及 ${records.length} 条历史记录` : ''}？本机已有版本会继续保留。`)) return;
    await sync.importHistory(records);
    state = migrateState(imported); cancelEdit(); renderAll(true); save('导入本机 JSON 备份');
    toast('备份已载入，正在保存到本机');
  } catch (error) { toast(error.message); }
  finally { event.target.value = ''; }
});

async function cloudAction(action) {
  const main = document.querySelector('main');
  main.inert = true; $('reset-competition').disabled = true;
  try { await action(); }
  catch (error) { $('cloud-status').textContent = error.message; toast(error.message); }
  finally { main.inert = false; $('reset-competition').disabled = false; }
}
function useCloudState(saved) {
  if (!validSnapshot(saved)) throw new Error('云端数据格式不正确');
  state = migrateState(saved); cancelEdit(); renderAll(true);
  sync.enqueue(state, '读取云端积分榜');
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}
$('cloud-connect').addEventListener('click', () => { void cloudAction(async () => {
  const token = $('cloud-token').value.trim();
  if (token.length < 24) throw new Error('同步口令至少需要 24 位');
  await cloud.connect(token);
}); });
$('cloud-upload').addEventListener('click', () => { void cloudAction(async () => {
  if (!cloud.ready) throw new Error('请先输入口令并连接云端');
  if (sync.running || sync.queue.length) throw new Error('请先等待本机数据保存完成');
  if (!confirm('上传本机全部历史，并将本机当前积分榜设为云端最新版本？已有云端历史会继续保留。')) return;
  const records = []; let before = null;
  do {
    const page = await sync.request(`?history=1&full=1${before ? `&before=${before}` : ''}`);
    records.push(...page.items); before = page.next;
  } while (before);
  await cloud.migrate(records.reverse(), state);
}); });
$('cloud-load').addEventListener('click', () => { void cloudAction(async () => {
  if (!cloud.ready) throw new Error('请先连接云端');
  if (cloud.queue.length) throw new Error('请先完成同步或处理冲突');
  const latest = await cloud.request();
  if (!latest.state) throw new Error('云端暂无数据，请先上传本机历史');
  if (!confirm('读取云端最新积分榜？当前本机版本会保留在本机历史中。')) return;
  useCloudState(latest.state); cloud.revision = latest.revision; cloud.selected = true; cloud.persist();
  $('cloud-status').textContent = `已读取云端版本 ${latest.revision} · 后续修改自动同步`;
}); });
$('cloud-retry').addEventListener('click', () => { void cloudAction(async () => {
  if (!cloud.ready) throw new Error('请先连接云端'); await cloud.retry();
}); });
$('cloud-disconnect').addEventListener('click', () => { cloud.disconnect(); $('cloud-token').value = ''; });
for (const [id, local] of [['cloud-keep', true], ['cloud-read', false]]) {
  $(id).addEventListener('click', () => { void cloudAction(async () => {
    await cloud.resolve(local, useCloudState); renderAll(true);
  }); });
}

fetch('./public/pku-football-logo.png')
  .then(response => {
    if (!response.ok) throw new Error('标志加载失败');
    return response.blob();
  })
  .then(blob => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  }))
  .then(dataUri => {
    logoDataUri = dataUri;
    renderPreview();
  })
  .catch(error => console.warn(error));

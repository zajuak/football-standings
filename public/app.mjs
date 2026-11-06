import {
  STORAGE_KEY, calculateMatchFairPlay, calculateStandings, createId, createInitialState, createResult, createCompetition, createCompetitionSeason, resetCompetition,
  formatFairPlay, getActiveCompetition, getCompetitionSeason, getCompetitionSeasons, getCompetitionStage, getMatchFairPlay, isValidState, migrateState, updateResult,
} from './core.mjs';
import { buildKnockoutPoster, buildPoster, escapeXml } from './poster.mjs';
import { getKnockoutBracket, getKnockoutSummary, setKnockoutCards, setKnockoutDiscipline, setKnockoutScore, setKnockoutTeam, setKnockoutTiebreak, setKnockoutPenalties } from './knockout.mjs';
import { getSeasonFairPlay } from './fair-play.mjs';
import { validSnapshot } from './snapshot.mjs';
import { CloudSync } from './cloud-sync.mjs';
import { interactionState } from './interaction-state.mjs';

const VIEW_KEY = 'pku-football-active-competition-v1';
const AUTH_KEY = 'pku-football-editor-authenticated-v1';
const PASSCODE_SHA256 = '5c165cb2e7df0bfc1a090fad2e6e1fcd32f76b2d0eff4727ffa3e8db71e6a9a0';
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
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (validSnapshot(saved)) {
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
let previewMode = 'groups';
const activeStages = new Map();
const activeSeasons = new Map();
let editorAuthenticated = false;
try { editorAuthenticated = sessionStorage.getItem(AUTH_KEY) === '1'; } catch {}

function activeCompetition() {
  return getActiveCompetition(state);
}

function activeSeasonCompetition() {
  const current = activeCompetition();
  return getCompetitionSeason(current, activeSeasons.get(current.id));
}

function activeSeasonId() {
  return activeSeasonCompetition().season;
}

function activeStageKey() {
  return `${activeCompetition().id}:${activeSeasonId()}`;
}

function activeStageId() {
  const current = activeSeasonCompetition();
  const selected = activeStages.get(activeStageKey());
  return ['placement', 'knockout'].includes(selected) && current[selected] ? selected : 'group';
}

function competition() {
  return getCompetitionStage(activeSeasonCompetition(), activeStageId());
}

let saveTimer;
let cloudLoaded = false;
let cloudActionRunning = false;
function cacheState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); localStorage.setItem(VIEW_KEY, state.activeCompetitionId); } catch {}
}
function useCloudState(saved) {
  if (!validSnapshot(saved)) throw new Error('云端数据格式不正确');
  let preferred = state.activeCompetitionId;
  try { preferred = localStorage.getItem(VIEW_KEY) ?? preferred; } catch {}
  state = migrateState(structuredClone(saved));
  if (state.competitions.some(item => item.id === preferred)) state.activeCompetitionId = preferred;
  cancelEdit(); renderAll(true); cacheState();
}
const cloud = new CloudSync({
  storage: { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) },
  onState: useCloudState,
  canApplyState: () => canRefresh(),
  onStatus(message, error = false) {
    elements.saveStatus.classList.toggle('is-error', error);
    elements.saveStatus.textContent = message;
    $('cloud-status').textContent = message;
    $('cloud-status').classList.toggle('is-error', error);
    $('cloud-conflict').hidden = !cloud.conflict;
    $('pending-count').textContent = cloud.queue.length ? `还有 ${cloud.queue.length} 次修改待同步，请保持页面打开或导出备份。` : '所有已同步修改保存在云端，支持查看、恢复和导出。';
    if (!error && !cloud.queue.length && $('history-panel').open) void showHistory();
  },
});
function save(action = '修改赛事设置') {
  if (!editorAuthenticated || !cloudLoaded) return false;
  clearTimeout(saveTimer); saveTimer = null;
  cloud.enqueue(state, action); cacheState();
  return true;
}
function scheduleSave(action = '修改赛事设置') {
  if (!canEdit()) return;
  clearTimeout(saveTimer); cacheState();
  saveTimer = setTimeout(() => save(action), 500);
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

async function isCorrectPasscode(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return hash === PASSCODE_SHA256;
}

function permissions() {
  return interactionState({ authenticated: editorAuthenticated, cloudLoaded, busy: cloudActionRunning });
}
function canEdit() { return permissions().canEdit; }
function updatePermissions() {
  const access = permissions();
  document.querySelector('main').inert = access.browseBlocked;
  document.querySelector('main').setAttribute('aria-busy', String(cloudActionRunning));
  document.body.classList.toggle('is-read-only', !access.canEdit);
  $('permission-status').textContent = access.mode;
  $('permission-status').classList.toggle('is-editor', access.canEdit);
  $('auth-button').textContent = editorAuthenticated ? '退出编辑' : '口令登录';
  $('auth-button').disabled = cloudActionRunning;
  $('readonly-banner').textContent = access.notice;
  $('readonly-banner').hidden = !access.notice;
  $('team-manager').querySelector('.summary-action').textContent = access.canEdit ? '展开编辑' : '查看球队';
  for (const control of [elements.title, elements.date, $('add-competition'), $('add-season'), $('add-group'), $('import-data'), $('cloud-keep'), $('cloud-read')]) control.disabled = !access.canEdit;
  for (const form of [elements.matchForm, $('new-competition-form'), $('new-season-form')]) {
    for (const control of form.elements) control.disabled = !access.canEdit;
  }
  if (access.canEdit && activeStageId() !== 'knockout') renderMatchTeams();
  for (const control of elements.teamManagement.querySelectorAll('input, button')) control.disabled = !access.canEdit;
  for (const control of $('knockout-editor').querySelectorAll('input, select')) control.disabled = !access.canEdit || control.dataset.pending === 'true';
  for (const control of $('knockout-fair-play-list').querySelectorAll('input')) control.disabled = !access.canEdit;
  for (const control of elements.resultsList.querySelectorAll('button')) control.disabled = !access.canEdit;
  for (const control of document.querySelectorAll('[data-restore-history]')) control.disabled = !access.canEdit;
  $('import-data').closest('label').classList.toggle('is-disabled', !access.canEdit);
  $('reset-competition').disabled = !access.canEdit;
}

function renderPreview() {
  const current = competition();
  const knockout = activeStageId() === 'knockout';
  $('preview-title').textContent = knockout ? '淘汰赛晋级图预览' : '积分榜预览';
  $('preview-subtitle').textContent = knockout ? '按比赛轮次排列 · 自动显示晋级球队' : 'A4 竖版 · 与 Word 版式一致';
  $('preview-notes-label').textContent = knockout ? '晋级规则' : '排序规则';
  $('preview-notes-content').innerHTML = knockout
    ? '<p>胜者自动进入下一轮。女足四进二采用双回合总比分，决赛为单回合；平局时录入点球大战比分，图片以 1(4) 的形式显示。点球不计入比赛进球和公平竞赛场次。</p><p>修改前轮结果使后续参赛球队发生变化时，会清空受影响场次的旧比分、点球和红黄牌，请重新录入。</p>'
    : '<p>两队同分先比相互比赛积分；三队及以上先比相关球队间积分、净胜球、进球数，再比总净胜球、总进球和公平竞赛积分。</p><p>组间比较按积分、净胜球、进球数、公平竞赛积分排序；小组人数不等时，较多球队小组剔除与本组末位的比赛成绩，公平竞赛积分不剔除。</p>';
  elements.poster.setAttribute('aria-label', knockout ? '淘汰赛晋级图预览' : '积分榜图片预览');
  if (knockout) {
    previewMode = 'groups';
    $('preview-view-controls').hidden = true;
    $('comparison-hint').hidden = true;
    currentPoster = buildKnockoutPoster(current, logoDataUri);
    elements.poster.innerHTML = currentPoster.svg;
    return;
  }
  const comparisonAvailable = current.format !== 'league' && current.groups.length > 1;
  const positionCount = current.groups.length ? Math.min(...current.groups.map(group => group.teams.length)) : 0;
  if (!comparisonAvailable || !positionCount) previewMode = 'groups';
  const comparisonButton = document.querySelector('[data-preview-mode="cross-group"]');
  comparisonButton.disabled = !positionCount;
  $('comparison-hint').hidden = !comparisonAvailable || positionCount > 0;
  $('preview-view-controls').hidden = !comparisonAvailable;
  for (const button of document.querySelectorAll('[data-preview-mode]')) {
    const active = button.dataset.previewMode === previewMode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  currentPoster = buildPoster(current, logoDataUri, { mode: previewMode });
  elements.poster.innerHTML = currentPoster.svg;
}

function renderCompetition() {
  const selected = activeCompetition();
  const current = competition();
  const stage = activeStageId();
  $('season-select').innerHTML = getCompetitionSeasons(selected).map(item => option(item.season, `${item.season} 赛季`)).join('');
  $('season-select').value = activeSeasonId();
  $('competition-list').innerHTML = state.competitions.map(item => `<button class="competition-option${item.id === selected.id ? ' is-active' : ''}" type="button" data-competition="${escapeXml(item.id)}" aria-pressed="${item.id === selected.id}"><span class="competition-name">${escapeXml(item.shortName)}</span><span class="competition-subtitle">${item.format === 'league' ? '联赛 / 常规赛' : '小组赛'}</span></button>`).join('');
  const season = activeSeasonCompetition();
  $('stage-picker').hidden = !season.placement && !season.knockout;
  const stageNames = selected.id === 'women-pku-cup'
    ? { group: '常规赛', placement: '季后赛排位组', knockout: '淘汰赛' }
    : { group: '小组赛', placement: '排位赛', knockout: '淘汰赛' };
  for (const button of document.querySelectorAll('[data-stage]')) {
    button.hidden = !season[button.dataset.stage] && button.dataset.stage !== 'group';
    const active = button.dataset.stage === stage;
    button.textContent = stageNames[button.dataset.stage];
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  $('stage-hint').textContent = stage === 'knockout'
    ? '淘汰赛对阵与比分独立保存，不会影响其他阶段的积分榜。'
    : stage === 'group'
      ? `${stageNames.group}与其他阶段的分组、球队和赛果分别保存。`
      : current.groups.length ? `${stageNames.placement}数据独立保存，不会影响${stageNames.group}积分榜。` : '尚未进行抽签和分组，可先在下方添加小组与球队。';
  elements.title.value = current.title;
  elements.date.value = current.date;
  if (stage === 'knockout') {
    const summary = getKnockoutSummary(current);
    elements.summary.textContent = `${summary.total} 场对阵 · ${summary.played} 场已分胜负`;
  } else {
    const teamCount = current.groups.reduce((total, selectedGroup) => total + selectedGroup.teams.length, 0);
    elements.summary.textContent = `${teamCount} 支球队 · ${current.matches.length} 场赛果`;
  }
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
  elements.awayTeam.value = teams.some(item => item.id === previousAway && item.id !== elements.homeTeam.value) ? previousAway : (teams.find(item => item.id !== elements.homeTeam.value)?.id ?? teams[0]?.id ?? '');
  $('home-cards-team').textContent = `${teams.find(item => item.id === elements.homeTeam.value)?.name ?? '球队一'} · 红黄牌`;
  $('away-cards-team').textContent = `${teams.find(item => item.id === elements.awayTeam.value)?.name ?? '球队二'} · 红黄牌`;
  const disabled = !canEdit() || teams.length < 2;
  elements.homeTeam.disabled = disabled;
  elements.awayTeam.disabled = disabled;
  elements.homeScore.disabled = disabled;
  elements.awayScore.disabled = disabled;
  elements.addResult.disabled = disabled;
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
    elements.resultsList.innerHTML = `<div class="empty-results">${current.groups.length ? '尚未录入赛果，可在下方管理球队后录入' : '尚未进行抽签和分组，请先添加小组与球队'}</div>`;
    return;
  }
  elements.resultsList.innerHTML = current.matches.slice().reverse().map(match => {
    const selectedGroup = current.groups.find(item => item.id === match.groupId);
    const home = selectedGroup?.teams.find(item => item.id === match.homeId);
    const away = selectedGroup?.teams.find(item => item.id === match.awayId);
    if (!selectedGroup || !home || !away) return '';
    return `<div class="result-item">
      <span class="result-group">${escapeXml(selectedGroup.name)}</span>
      <div class="result-teams"><span class="result-team-home" title="${escapeXml(home.name)}">${escapeXml(home.name)}</span><strong class="result-score">${match.homeScore} : ${match.awayScore}</strong><span class="result-team-away" title="${escapeXml(away.name)}">${escapeXml(away.name)}</span></div>
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

function renderKnockoutFairPlay() {
  const rows = getSeasonFairPlay(activeSeasonCompetition());
  const groupLabel = activeCompetition().id === 'women-pku-cup' ? '常规赛' : '小组赛';
  $('fair-play-heading').textContent = `本赛季公平竞赛积分总表（${groupLabel}＋淘汰赛）`;
  let rank = 0;
  $('knockout-fair-play-list').innerHTML = rows.length ? `<table>
    <thead><tr><th>排名</th><th>球队</th><th>${groupLabel}场次</th><th>淘汰赛场次</th><th>合计场次</th><th>红黄牌后场均</th><th>${groupLabel}纪律扣分</th><th>淘汰赛纪律扣分</th><th>最终积分</th></tr></thead>
    <tbody>${rows.map(row => `<tr>
      <td>${row.played ? ++rank : '—'}</td><th>${escapeXml(row.name)}</th><td>${row.groupPlayed}</td><td>${row.knockoutPlayed}</td><td>${row.played}</td><td>${row.played ? formatFairPlay(row.beforeDiscipline) : '—'}</td><td>${formatFairPlay(row.groupDiscipline)}</td>
      <td>${row.hasKnockout ? `<input type="number" min="0" max="99" step="1" inputmode="numeric" data-knockout-discipline="${escapeXml(row.name)}" value="${row.knockoutDiscipline}" aria-label="${escapeXml(row.name)}纪律处罚扣分">` : '—'}</td>
      <td data-final-fairplay><strong>${row.played ? formatFairPlay(row.fairPlay) : '未出场'}</strong></td>
    </tr>`).join('')}</tbody>
  </table>` : '<div class="empty-results">填写本赛季球队后，在此查看公平竞赛积分总表。</div>';
}

function renderKnockoutEditor() {
  const bracket = getKnockoutBracket(competition());
  $('knockout-editor').innerHTML = bracket.rounds.map(round => `
    <section class="knockout-round">
      <h3>${escapeXml(round.name)}</h3>
      ${round.byes?.length ? `<div class="knockout-byes">${round.byes.map((bye, index) => `
        <label class="field"><span>轮空球队 ${index + 1}</span><input type="text" maxlength="30" data-knockout-bye="${escapeXml(bye.id)}" value="${escapeXml(bye.name)}" placeholder="待抽签"></label>`).join('')}</div>` : ''}
      <div class="knockout-matches">${round.matches.map((match, matchIndex) => `
        <article class="knockout-match" data-knockout-match="${escapeXml(match.id)}">
          <h4>对阵 ${matchIndex + 1}</h4>
          <div class="knockout-team-names">${['home', 'away'].map(side => {
            const team = match[side];
            const label = `${round.name} 对阵 ${matchIndex + 1} ${side === 'home' ? '球队一' : '球队二'}`;
            return team.editable
              ? `<input type="text" maxlength="30" data-knockout-team="${escapeXml(match.id)}" data-side="${side}" value="${escapeXml(team.name)}" placeholder="待填球队" aria-label="${escapeXml(label)}">`
              : `<div class="knockout-derived${team.name ? '' : ' is-pending'}" data-derived-side="${side}" title="由上一轮晋级球队决定">${escapeXml(team.name || '待晋级')}</div>`;
          }).join('')}</div>
          <div class="knockout-legs">${match.legs.map((leg, legIndex) => {
            const hasCards = ['home', 'away'].some(side => Object.values(leg[`${side}Cards`] ?? {}).some(value => Number(value) > 0));
            return `<div class="knockout-leg-entry">
              <div class="knockout-leg">
                <span>${match.legs.length === 1 ? '单回合' : legIndex === 0 ? '首回合' : '次回合'}</span>
                <div><input type="number" min="0" max="99" step="1" inputmode="numeric" data-knockout-score="${escapeXml(match.id)}" data-leg="${legIndex}" data-side="home" value="${leg.homeScore ?? ''}" aria-label="${escapeXml(match.home.name || '球队一')}比分"><b>:</b><input type="number" min="0" max="99" step="1" inputmode="numeric" data-knockout-score="${escapeXml(match.id)}" data-leg="${legIndex}" data-side="away" value="${leg.awayScore ?? ''}" aria-label="${escapeXml(match.away.name || '球队二')}比分"></div>
              </div>
              <details class="knockout-card-editor"${hasCards ? ' open' : ''}>
                <summary>红黄牌与公平竞赛积分</summary>
                <div class="knockout-card-grid">${['home', 'away'].map(side => {
                  const cards = leg[`${side}Cards`] ?? {};
                  return `<section class="knockout-card-side">
                    <strong data-card-team="${side}">${escapeXml(match[side].name || (side === 'home' ? '球队一' : '球队二'))}</strong>
                    <div class="card-inputs">${Object.entries(CARD_IDS).map(([key, id]) => `<label>${CARD_LABELS[key]}<input type="number" min="0" max="99" step="1" inputmode="numeric" data-knockout-cards="${escapeXml(match.id)}" data-leg="${legIndex}" data-side="${side}" data-card="${key}" value="${cards[key] ?? 0}"></label>`).join('')}</div>
                    <p>本场公平竞赛积分 <strong class="knockout-card-score">${formatFairPlay(calculateMatchFairPlay(cards))}</strong></p>
                  </section>`;
                }).join('')}</div>
              </details>
            </div>`;
          }).join('')}</div>
          <div class="knockout-penalties" hidden>
            <div class="knockout-leg"><span>点球大战</span><div>${['home', 'away'].map((side, index) => `${index ? '<b>:</b>' : ''}<input type="number" min="0" max="99" step="1" inputmode="numeric" data-knockout-penalties="${escapeXml(match.id)}" data-side="${side}" value="${match.penalties?.[`${side}Score`] ?? ''}" aria-label="${escapeXml(round.name)} 对阵 ${matchIndex + 1} ${side === 'home' ? '球队一' : '球队二'}点球比分">`).join('')}</div></div>
            <p>填写完整点球比分后自动晋级，点球数显示在比赛比分后的括号内。</p>
          </div>
          <label class="field knockout-tiebreak" hidden><span>未录点球时手动确认晋级（兼容已有记录）</span><select data-knockout-tiebreak="${escapeXml(match.id)}" aria-label="${escapeXml(round.name)} 对阵 ${matchIndex + 1} 平局晋级球队"></select></label>
          <p class="knockout-advancement${match.winnerName ? ' is-winner' : ''}">${match.winnerName
            ? `${match.legs.length === 2 ? `总比分 ${match.homeAggregate} : ${match.awayAggregate} · ` : ''}晋级：${escapeXml(match.winnerName)}`
            : match.completed && match.home.name && match.away.name && match.homeAggregate === match.awayAggregate
              ? `${match.legs.length === 2 ? '总比分' : '比分'}相同，暂未产生晋级球队`
              : '填写完整比分后自动确定晋级球队'}</p>
        </article>`).join('')}</div>
    </section>`).join('');
  refreshKnockoutEditor();
}

function refreshKnockoutEditor() {
  const matches = new Map(getKnockoutBracket(competition()).rounds.flatMap(round => round.matches).map(match => [match.id, match]));
  for (const article of $('knockout-editor').querySelectorAll('[data-knockout-match]')) {
    const match = matches.get(article.dataset.knockoutMatch);
    const pending = !match.home.name.trim() || !match.away.name.trim();
    for (const node of article.querySelectorAll('[data-derived-side]')) {
      const name = match[node.dataset.derivedSide].name;
      node.textContent = name || '待晋级';
      node.classList.toggle('is-pending', !name);
    }
    for (const node of article.querySelectorAll('[data-card-team]')) node.textContent = match[node.dataset.cardTeam].name || (node.dataset.cardTeam === 'home' ? '球队一' : '球队二');
    for (const input of article.querySelectorAll('[data-knockout-score], [data-knockout-cards]')) {
      const leg = match.legs[Number(input.dataset.leg)];
      const side = input.dataset.side;
      const value = input.dataset.knockoutScore ? leg[`${side}Score`] ?? '' : leg[`${side}Cards`]?.[input.dataset.card] ?? 0;
      if (input.value !== String(value)) input.value = value;
      if (input.dataset.knockoutScore) input.setAttribute('aria-label', `${match[side].name || (side === 'home' ? '球队一' : '球队二')}比分`);
      input.dataset.pending = String(pending);
    }
    for (const cardSide of article.querySelectorAll('.knockout-card-side')) {
      const input = cardSide.querySelector('[data-knockout-cards]');
      cardSide.querySelector('.knockout-card-score').textContent = formatFairPlay(calculateMatchFairPlay(match.legs[Number(input.dataset.leg)][`${input.dataset.side}Cards`] ?? {}));
    }
    const tied = !pending && match.completed && match.homeAggregate === match.awayAggregate;
    article.querySelector('.knockout-penalties').hidden = !tied;
    for (const input of article.querySelectorAll('[data-knockout-penalties]')) {
      const value = match.penalties?.[`${input.dataset.side}Score`] ?? '';
      if (input.value !== String(value)) input.value = value;
      input.dataset.pending = String(!tied);
    }
    const select = article.querySelector('[data-knockout-tiebreak]');
    select.closest('label').hidden = !tied || match.penaltiesStarted;
    const options = option('', '比赛决出胜负后选择') + ['home', 'away'].map(side => option(side, match[side].name, match.tiebreakWinner === side)).join('');
    if (select.innerHTML !== options) select.innerHTML = options;
    select.value = match.tiebreakWinner ?? '';
    const status = article.querySelector('.knockout-advancement');
    status.classList.toggle('is-winner', Boolean(match.winnerName));
    status.textContent = match.winnerName ? `${match.legs.length === 2 ? `总比分 ${match.homeAggregate} : ${match.awayAggregate} · ` : ''}${match.penaltiesCompleted ? `点球 ${match.penalties.homeScore} : ${match.penalties.awayScore} · ` : tied ? '平局决胜 · ' : ''}晋级：${match.winnerName}`
      : tied ? '比分相同，请填写决出胜负的点球大战比分' : pending ? '等待两支参赛球队确定' : '填写完整比分后自动确定晋级球队';
  }
  renderKnockoutFairPlay();
  updatePermissions();
}

function updateKnockoutSummary() {
  const summary = getKnockoutSummary(competition());
  elements.summary.textContent = `${summary.total} 场对阵 · ${summary.played} 场已分胜负`;
}

function renderAll(resetTeams = false) {
  const knockout = activeStageId() === 'knockout';
  renderCompetition();
  $('match-panel').hidden = knockout;
  $('knockout-panel').hidden = !knockout;
  $('team-manager').hidden = knockout;
  if (knockout) {
    renderKnockoutEditor();
  } else {
    renderMatchForm(resetTeams);
    renderResults();
    renderManagement();
  }
  renderPreview();
  updatePermissions();
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
const CARD_LABELS = { yellow: '黄牌', secondYellowRed: '两黄变红', directRed: '直接红牌', yellowDirectRed: '黄后直红' };

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
  elements.matchForm.querySelectorAll('.card-inputs input').forEach(input => { input.value = '0'; });
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

$('knockout-editor').addEventListener('input', event => {
  if (!canEdit()) return;
  const input = event.target;
  try {
    let result;
    if (input.dataset.knockoutTeam || input.dataset.knockoutBye) {
      result = setKnockoutTeam(competition(), {
        matchId: input.dataset.knockoutTeam,
        byeId: input.dataset.knockoutBye,
        side: input.dataset.side,
        name: input.value,
      });
    } else if (input.dataset.knockoutScore) {
      result = setKnockoutScore(competition(), input.dataset.knockoutScore, Number(input.dataset.leg), input.dataset.side, input.value);
    } else if (input.dataset.knockoutTiebreak) {
      result = setKnockoutTiebreak(competition(), input.dataset.knockoutTiebreak, input.value);
    } else if (input.dataset.knockoutPenalties) {
      result = setKnockoutPenalties(competition(), input.dataset.knockoutPenalties, input.dataset.side, input.value);
    } else if (input.dataset.knockoutCards) {
      const cardInputs = input.closest('.knockout-card-side').querySelectorAll('[data-card]');
      const cards = Object.fromEntries([...cardInputs].map(item => [item.dataset.card, item.value === '' ? 0 : Number(item.value)]));
      setKnockoutCards(competition(), input.dataset.knockoutCards, Number(input.dataset.leg), input.dataset.side, cards);
      input.closest('.knockout-card-side').querySelector('.knockout-card-score').textContent = formatFairPlay(calculateMatchFairPlay(cards));
      refreshKnockoutEditor();
      $('knockout-error').textContent = '';
      scheduleSave('录入淘汰赛红黄牌');
      return;
    } else return;
    $('knockout-error').textContent = '';
    scheduleSave('修改淘汰赛对阵');
    refreshKnockoutEditor();
    updateKnockoutSummary();
    renderPreview();
    if (result?.clearedMatches) toast(`参赛球队已变化，已清空 ${result.clearedMatches} 场受影响的旧赛果`);
  } catch (error) {
    $('knockout-error').textContent = error.message;
  }
});
$('knockout-editor').addEventListener('change', event => {
  if (!canEdit() || !event.target.matches('[data-knockout-team], [data-knockout-bye], [data-knockout-score], [data-knockout-penalties]')) return;
  const input = event.target;
  const current = competition();
  if (input.dataset.knockoutTeam) input.value = current.rounds.flatMap(round => round.matches).find(match => match.id === input.dataset.knockoutTeam)[`${input.dataset.side}Name`];
  if (input.dataset.knockoutBye) input.value = current.rounds.flatMap(round => round.byes ?? []).find(bye => bye.id === input.dataset.knockoutBye).name;
  refreshKnockoutEditor();
});
$('knockout-fair-play-list').addEventListener('input', event => {
  if (!canEdit() || !event.target.dataset.knockoutDiscipline) return;
  const input = event.target;
  try {
    setKnockoutDiscipline(competition(), input.dataset.knockoutDiscipline, input.value);
    const row = getSeasonFairPlay(activeSeasonCompetition()).find(item => item.name === input.dataset.knockoutDiscipline);
    input.closest('tr').querySelector('[data-final-fairplay] strong').textContent = row.played ? formatFairPlay(row.fairPlay) : '未出场';
    $('knockout-error').textContent = '';
    scheduleSave('修改淘汰赛纪律处罚');
  } catch (error) {
    $('knockout-error').textContent = error.message;
  }
});
$('knockout-fair-play-list').addEventListener('change', event => {
  if (!canEdit() || !event.target.dataset.knockoutDiscipline) return;
  requestAnimationFrame(() => {
    if (activeStageId() !== 'knockout') return;
    renderKnockoutFairPlay();
    updatePermissions();
  });
});

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
  const suffix = previewMode === 'cross-group' ? '-组间晋级比较' : '';
  return `${name}${suffix}.${extension}`;
}

$('auth-button').addEventListener('click', () => {
  if (cloudActionRunning) return;
  if (editorAuthenticated) {
    if (saveTimer) save();
    editorAuthenticated = false;
    try { sessionStorage.removeItem(AUTH_KEY); } catch {}
    cancelEdit();
    $('new-competition-form').reset(); $('new-competition-form').hidden = true;
    $('new-season-form').reset(); $('new-season-form').hidden = true;
    updatePermissions();
    toast('已退出编辑，当前为只读模式');
    return;
  }
  $('login-form').reset();
  $('login-error').textContent = '';
  $('login-dialog').showModal();
  $('passcode-input').focus();
});
$('cancel-login').addEventListener('click', () => $('login-dialog').close());
$('login-dialog').addEventListener('close', () => { $('passcode-input').value = ''; });
$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const submit = $('submit-login');
  submit.disabled = true;
  try {
    const correct = await isCorrectPasscode($('passcode-input').value);
    if (!$('login-dialog').open) return;
    if (!correct) {
      $('login-error').textContent = '口令不正确，请重新输入。';
      $('passcode-input').select();
      return;
    }
    editorAuthenticated = true;
    try { sessionStorage.setItem(AUTH_KEY, '1'); } catch {}
    $('login-dialog').close();
    updatePermissions();
    toast(cloudLoaded ? '登录成功，现在可以修改积分榜' : '口令正确，连接云端后可编辑；当前仍可浏览和导出');
  } catch (error) {
    $('login-error').textContent = '无法完成口令校验，请使用支持 HTTPS 的现代浏览器重试。';
  } finally {
    submit.disabled = false;
  }
});

$('competition-list').addEventListener('click', event => {
  const button = event.target.closest('[data-competition]');
  if (!button || button.dataset.competition === state.activeCompetitionId) return;
  if (saveTimer) save();
  state.activeCompetitionId = button.dataset.competition;
  elements.formError.textContent = ''; cancelEdit(); cacheState(); renderAll(true);
});
$('season-select').addEventListener('change', () => {
  if ($('season-select').value === activeSeasonId()) return;
  if (saveTimer) save();
  activeSeasons.set(activeCompetition().id, $('season-select').value);
  $('new-season-form').hidden = true;
  elements.formError.textContent = '';
  cancelEdit();
  renderAll(true);
});
$('add-season').addEventListener('click', () => {
  if (!canEdit()) return;
  $('new-season-form').hidden = false;
  $('new-season-year').value = '';
  $('new-season-year').focus();
});
$('cancel-new-season').addEventListener('click', () => { $('new-season-form').hidden = true; });
$('new-season-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!canEdit()) return;
  try {
    const current = activeCompetition();
    const created = createCompetitionSeason(current, $('new-season-year').value);
    activeSeasons.set(current.id, created.season);
    activeStages.delete(`${current.id}:${created.season}`);
    cancelEdit();
    save('新增赛季');
    renderAll(true);
    $('new-season-form').reset();
    $('new-season-form').hidden = true;
    toast(`${created.season} 赛季已创建`);
  } catch (error) { toast(error.message); }
});
$('stage-picker').addEventListener('click', event => {
  const button = event.target.closest('[data-stage]');
  if (!button || button.dataset.stage === activeStageId()) return;
  if (saveTimer) save();
  activeStages.set(activeStageKey(), button.dataset.stage);
  elements.formError.textContent = '';
  cancelEdit();
  renderAll(true);
});
$('add-competition').addEventListener('click', () => {
  if (!canEdit()) return;
  $('new-competition-form').hidden = false; $('new-competition-name').focus();
});
$('cancel-new-competition').addEventListener('click', () => { $('new-competition-form').hidden = true; });
$('new-competition-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!canEdit()) return;
  try {
    const current = createCompetition({ name: $('new-competition-name').value, format: $('new-competition-format').value, date: new Date().toLocaleDateString('en-CA') });
    state.competitions.push(current); state.activeCompetitionId = current.id;
    cancelEdit(); save('新增赛事'); renderAll(true);
    $('new-competition-form').reset(); $('new-competition-form').hidden = true;
    $('team-manager').open = true; toast('赛事已创建，请添加球队');
  } catch (error) { toast(error.message); }
});

elements.title.addEventListener('input', () => {
  if (!canEdit()) return;
  competition().title = elements.title.value;
  scheduleSave();
  renderPreview();
});
function changeDate(event) {
  if (!canEdit()) return;
  const value = elements.date.value;
  if (elements.date.validity.badInput || (value && !/^\d{4}-\d{2}-\d{2}$/.test(value))) return;
  competition().date = value;
  renderPreview();
  if (event.type === 'change') save('修改榜单日期');
  else scheduleSave('修改榜单日期');
}
elements.date.addEventListener('input', changeDate);
elements.date.addEventListener('change', changeDate);
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
  if (!canEdit()) return;
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
    toast(wasEditing ? '赛果修改已加入保存队列' : '赛果已更新，正在同步云端');
  } catch (error) {
    elements.formError.textContent = error.message;
  }
});

elements.resultsList.addEventListener('click', event => {
  if (!canEdit()) return;
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
  if (!canEdit()) return;
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
  scheduleSave();
  renderPreview();
});

elements.teamManagement.addEventListener('change', event => {
  if (event.target.dataset.teamName || event.target.dataset.groupName) {
    renderMatchForm();
    renderResults();
  }
});

elements.teamManagement.addEventListener('click', event => {
  if (!canEdit()) return;
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
  if (!canEdit()) return;
  const current = competition();
  const index = current.groups.length;
  const name = index < 26 ? `${String.fromCharCode(65 + index)}组` : `G${index + 1}组`;
  current.groups.push({ id: createId('group'), name, teams: [] });
  save();
  renderAll();
});

$('reset-competition').addEventListener('click', () => {
  if (!canEdit()) return;
  const current = activeCompetition();
  if (!confirm(`确定将“${current.shortName}”恢复为初始数据吗？所有赛季及比赛阶段都会恢复为初始数据，已有提交仍保留在历史记录中。`)) return;
  const initial = resetCompetition(current);
  const index = state.competitions.findIndex(item => item.id === current.id);
  state.competitions[index] = initial;
  activeSeasons.delete(current.id);
  for (const key of activeStages.keys()) if (key.startsWith(`${current.id}:`)) activeStages.delete(key);
  cancelEdit();
  save('恢复赛事初始数据');
  renderAll(true);
  toast('当前赛事已恢复，旧数据保留在历史记录中');
});

for (const button of document.querySelectorAll('[data-preview-mode]')) {
  button.addEventListener('click', () => {
    previewMode = button.dataset.previewMode;
    renderPreview();
  });
}
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
updatePermissions();
async function retrySync() {
  if (cloudActionRunning) return;
  if (saveTimer) save();
  const loaded = await cloud.retry(state);
  if (loaded) cloudLoaded = true;
  updatePermissions();
}
void retrySync();
function canRefresh() {
  return cloudLoaded && !cloudActionRunning && elements.date.value === competition().date && !saveTimer && !editingMatchId && !elements.homeScore.value && !elements.awayScore.value &&
    !document.activeElement?.matches('input, select, textarea') &&
    ![...elements.matchForm.querySelectorAll('.card-inputs input')].some(input => Number(input.value));
}
window.addEventListener('online', () => { void retrySync(); });
setInterval(() => {
  if (!cloudLoaded || cloud.queue.length) void retrySync();
  else if (canRefresh()) void cloud.refresh();
}, 15000);
window.addEventListener('focus', () => { if (canRefresh()) void cloud.refresh(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && canRefresh()) void cloud.refresh(); });
window.addEventListener('beforeunload', event => {
  if (saveTimer) save();
  if (cloud.queue.length) { event.preventDefault(); event.returnValue = ''; }
});
$('retry-sync').addEventListener('click', () => { void retrySync(); });
$('refresh-cloud').addEventListener('click', () => { if (cloud.queue.length || !cloudLoaded || canRefresh()) void retrySync(); else toast('请先完成当前录入，再刷新云端数据'); });
$('open-history').addEventListener('click', () => { $('history-panel').open = true; $('history-panel').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
let historyCursor = null;
function historySource() {
  if (!cloud.ready) throw new Error('正在连接云端，请稍后重试');
  return cloud;
}
async function showHistory(append = false) {
  const list = $('history-list');
  const button = $('more-history'); button.disabled = true;
  try {
    const page = await historySource().request(`?history=1&distinct=1${append && historyCursor ? `&before=${historyCursor}` : ''}`);
    if (!append) list.replaceChildren();
    if (!page.items.length && !append) list.textContent = '暂无云端历史记录。';
    for (const item of page.items) {
      const row = document.createElement('div'); row.className = 'history-item';
      const label = document.createElement('span');
      label.textContent = `版本 ${item.revision} · ${item.action}${item.applied ? '' : '（历史存档）'}${item.duplicateCount ? ` · 已合并 ${item.duplicateCount} 条重复记录` : ''}`;
      const time = document.createElement('small'); time.textContent = new Date(item.created_at).toLocaleString('zh-CN', { hour12: false });
      const restore = document.createElement('button'); restore.type = 'button'; restore.className = 'button button-secondary'; restore.textContent = '恢复此版本';
      restore.dataset.restoreHistory = String(item.revision);
      restore.disabled = !canEdit();
      restore.addEventListener('click', async () => {
        if (!canEdit()) return;
        if (saveTimer || cloud.queue.length) { toast('请先等待当前修改保存完成'); return; }
        restore.disabled = true;
        try {
          await cloudAction(async () => {
          const record = await historySource().request(`?revision=${item.revision}`);
          if (!isValidState(record.state)) throw new Error('历史数据格式异常');
          if (!confirm(`恢复到版本 ${item.revision}？当前版本也会继续保留在历史中。`)) return;
          useCloudState(record.state);
          save(`恢复历史版本 ${item.revision}`);
          await cloud.flush(); await showHistory();
          });
        } catch (error) { toast(error.message); }
        finally { restore.disabled = !canEdit(); }
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
    const backup = { format: 'pku-football-history-v1', exportedAt: new Date().toISOString(), state, pending: cloud.queue, items };
    download(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }), '积分榜完整历史.json');
    toast(`已导出 ${items.length} 条历史及 ${cloud.queue.length} 条待存档提交`);
  } catch (error) { toast(`完整历史导出失败：${error.message}，可先导出当前数据`); }
  finally { button.disabled = false; }
});
$('import-data').addEventListener('change', async event => {
  if (!canEdit()) return;
  const file = event.target.files[0]; if (!file) return;
  try {
    const value = JSON.parse(await file.text()); const imported = value.state ?? value;
    if (!validSnapshot(imported)) throw new Error('请选择积分榜导出的 JSON 数据文件');
    const records = [...(value.items ?? []).slice().reverse(), ...(value.pending ?? [])];
    if (!records.every(record => validSnapshot(record.state))) throw new Error('备份中的历史数据格式不正确');
    if (!confirm(`导入当前数据${records.length ? `及 ${records.length} 条历史记录` : ''}？云端已有版本会继续保留。`)) return;
    await cloudAction(async () => {
      if (saveTimer) save();
      await cloud.flush();
      await cloud.archiveRecords(records);
      useCloudState(imported); save('导入 JSON 备份');
    });
    toast('备份已载入，正在同步云端');
  } catch (error) { toast(error.message); }
  finally { event.target.value = ''; }
});

async function cloudAction(action) {
  if (!editorAuthenticated) throw new Error('请先输入口令登录后再修改数据');
  if (!cloudLoaded) throw new Error('请先连接云端，再修改数据');
  if (cloudActionRunning) throw new Error('请等待当前数据操作完成');
  cloudActionRunning = true; updatePermissions();
  const main = document.querySelector('main');
  main.inert = true; $('reset-competition').disabled = true;
  try { await action(); }
  catch (error) { $('cloud-status').textContent = error.message; toast(error.message); throw error; }
  finally { cloudActionRunning = false; updatePermissions(); }
}
for (const [id, local] of [['cloud-keep', true], ['cloud-read', false]]) {
  $(id).addEventListener('click', () => { void cloudAction(async () => {
    if (saveTimer) save(); await cloud.resolve(local); renderAll(true);
  }).catch(() => {}); });
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

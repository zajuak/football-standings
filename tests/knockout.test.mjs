import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createKnockoutStage, getKnockoutBracket, getKnockoutFairPlay, getKnockoutSummary, setKnockoutCards, setKnockoutDiscipline, setKnockoutScore, setKnockoutTeam,
} from '../public/knockout.mjs';
import { buildKnockoutPoster } from '../public/poster.mjs';
import { createInitialState, createCompetitionSeason, migrateState } from '../public/core.mjs';
import { validSnapshot } from '../public/snapshot.mjs';

function result(knockout, matchId, legIndex, homeScore, awayScore) {
  setKnockoutScore(knockout, matchId, legIndex, 'home', homeScore);
  setKnockoutScore(knockout, matchId, legIndex, 'away', awayScore);
}

test('男足淘汰赛包含四轮、四支轮空球队并自动晋级', () => {
  const knockout = createKnockoutStage('men-freshman-cup', '男足淘汰赛');
  assert.deepEqual(knockout.rounds.map(round => [round.name, round.matches.length]), [
    ['十二进八', 4], ['八进四', 4], ['半决赛', 2], ['决赛', 1],
  ]);
  assert.equal(knockout.rounds[0].byes.length, 4);
  setKnockoutTeam(knockout, { byeId: 'men-bye-1', name: '轮空甲' });
  setKnockoutTeam(knockout, { matchId: 'men-r12-1', side: 'home', name: '信科' });
  setKnockoutTeam(knockout, { matchId: 'men-r12-1', side: 'away', name: '城环' });
  result(knockout, 'men-r12-1', 0, 2, 1);
  let bracket = getKnockoutBracket(knockout);
  const quarter = bracket.rounds[1].matches[0];
  assert.equal(quarter.home.name, '轮空甲');
  assert.equal(quarter.away.name, '信科');
  result(knockout, 'men-r8-1', 0, 0, 3);
  bracket = getKnockoutBracket(knockout);
  assert.equal(bracket.rounds[2].matches[0].home.name, '信科');
  assert.equal(getKnockoutSummary(knockout).played, 2);
  result(knockout, 'men-r12-1', 0, 1, 4);
  bracket = getKnockoutBracket(knockout);
  assert.equal(bracket.rounds[1].matches[0].away.name, '城环');
  assert.equal(bracket.rounds[2].matches[0].home.name, '');
  assert.equal(bracket.rounds[1].matches[0].legs[0].homeScore, null);
  assert.equal(bracket.rounds[1].matches[0].legs[0].awayScore, null);
});

test('女足四进二按双回合总比分晋级，决赛为单回合', () => {
  const knockout = createKnockoutStage('women-pku-cup', '女足淘汰赛');
  assert.deepEqual(knockout.rounds.map(round => round.matches.map(match => match.legs.length)), [[2, 2], [1]]);
  for (const [matchId, home, away] of [['women-r4-1', '医学', '元培'], ['women-r4-2', '理叉地', '中历外']]) {
    setKnockoutTeam(knockout, { matchId, side: 'home', name: home });
    setKnockoutTeam(knockout, { matchId, side: 'away', name: away });
  }
  result(knockout, 'women-r4-1', 0, 2, 1);
  assert.equal(getKnockoutBracket(knockout).rounds[1].matches[0].home.name, '');
  result(knockout, 'women-r4-1', 1, 1, 1);
  assert.equal(getKnockoutBracket(knockout).rounds[1].matches[0].home.name, '医学');
  result(knockout, 'women-r4-2', 0, 1, 0);
  result(knockout, 'women-r4-2', 1, 0, 2);
  const final = getKnockoutBracket(knockout).rounds[1].matches[0];
  assert.equal(final.home.name, '医学');
  assert.equal(final.away.name, '中历外');
  assert.equal(final.legs.length, 1);
  result(knockout, 'women-final', 0, 2, 0);
  assert.equal(getKnockoutBracket(knockout).rounds[1].matches[0].winnerName, '医学');
});

test('双回合总比分相同不产生晋级球队，比分不能为空或负数', () => {
  const knockout = createKnockoutStage('women-pku-cup', '女足淘汰赛');
  setKnockoutTeam(knockout, { matchId: 'women-r4-1', side: 'home', name: '甲' });
  setKnockoutTeam(knockout, { matchId: 'women-r4-1', side: 'away', name: '乙' });
  result(knockout, 'women-r4-1', 0, 1, 0);
  result(knockout, 'women-r4-1', 1, 0, 1);
  const match = getKnockoutBracket(knockout).rounds[0].matches[0];
  assert.equal(match.homeAggregate, 1);
  assert.equal(match.awayAggregate, 1);
  assert.equal(match.winnerName, '');
  assert.throws(() => setKnockoutScore(knockout, 'women-r4-1', 0, 'home', -1), /比分/);
  assert.throws(() => setKnockoutScore(knockout, 'women-r4-1', 0, 'home', 1.5), /比分/);
});

test('旧赛事和新赛季都有独立淘汰赛且通过快照校验', () => {
  const state = createInitialState();
  for (const item of state.competitions) {
    assert.ok(item.knockout);
    delete item.knockout;
  }
  migrateState(state);
  assert.ok(state.competitions.every(item => item.knockout));
  const men = state.competitions[0];
  const created = createCompetitionSeason(men, '2027-28');
  assert.notEqual(created.knockout, men.knockout);
  assert.match(created.knockout.title, /2027-28赛季/);
  setKnockoutTeam(created.knockout, { matchId: 'men-r12-1', side: 'home', name: '新赛季球队' });
  assert.equal(men.knockout.rounds[0].matches[0].homeName, '');
  assert.equal(validSnapshot(state), true);
});

test('淘汰赛按每场红黄牌计算平均公平竞赛积分并扣除纪律处罚', () => {
  const knockout = createKnockoutStage('men-freshman-cup', '男足淘汰赛');
  setKnockoutTeam(knockout, { matchId: 'men-r12-1', side: 'home', name: '信科' });
  setKnockoutTeam(knockout, { matchId: 'men-r12-1', side: 'away', name: '城环' });
  setKnockoutCards(knockout, 'men-r12-1', 0, 'home', { yellow: 2 });
  setKnockoutCards(knockout, 'men-r12-1', 0, 'away', { directRed: 1 });
  result(knockout, 'men-r12-1', 0, 2, 1);
  setKnockoutDiscipline(knockout, '信科', 1);
  const rows = getKnockoutFairPlay(knockout);
  assert.equal(rows.find(row => row.name === '信科').played, 1);
  assert.equal(rows.find(row => row.name === '信科').beforeDiscipline, 3);
  assert.equal(rows.find(row => row.name === '信科').fairPlay, 2);
  assert.equal(rows.find(row => row.name === '城环').fairPlay, 1);
  setKnockoutTeam(knockout, { matchId: 'men-r12-1', side: 'home', name: '信科一队' });
  assert.equal(getKnockoutFairPlay(knockout).find(row => row.name === '信科一队').disciplineDeduction, 1);
  const state = createInitialState();
  state.competitions[0].knockout = knockout;
  assert.equal(validSnapshot(state), true);
  knockout.rounds[0].matches[0].legs[0].homeCards.yellow = -1;
  assert.equal(validSnapshot(state), false);
});

test('女足双回合公平竞赛积分按两场计，且不进入对阵图', () => {
  const knockout = createKnockoutStage('women-pku-cup', '女足淘汰赛');
  setKnockoutTeam(knockout, { matchId: 'women-r4-1', side: 'home', name: '医学' });
  setKnockoutTeam(knockout, { matchId: 'women-r4-1', side: 'away', name: '元培' });
  setKnockoutCards(knockout, 'women-r4-1', 0, 'home', { yellow: 1 });
  setKnockoutCards(knockout, 'women-r4-1', 1, 'home', { secondYellowRed: 1 });
  result(knockout, 'women-r4-1', 0, 1, 0);
  result(knockout, 'women-r4-1', 1, 1, 0);
  const row = getKnockoutFairPlay(knockout).find(item => item.name === '医学');
  assert.equal(row.played, 2);
  assert.equal(row.beforeDiscipline, 3);
  const poster = buildKnockoutPoster(knockout);
  assert.doesNotMatch(poster.svg, /公平竞赛|纪律扣分|knockout-discipline/);
});

test('修改晋级球队会逐轮清空受影响赛果，胜者不变时保留后续赛果', () => {
  const stage = createKnockoutStage('women-pku-cup', '女足');
  for (const [id, a, b] of [['women-r4-1','甲','乙'], ['women-r4-2','丙','丁']]) {
    setKnockoutTeam(stage, { matchId:id, name:a });
    setKnockoutTeam(stage, { matchId:id, side:'away', name:b });
    result(stage,id,0,2,0); result(stage,id,1,1,0);
  }
  result(stage,'women-final',0,2,1);
  setKnockoutCards(stage,'women-final',0,'home',{yellow:2});
  assert.equal(setKnockoutScore(stage,'women-r4-1',0,'home',3).clearedMatches,0);
  assert.equal(stage.rounds[1].matches[0].legs[0].homeScore,2);
  assert.equal(setKnockoutScore(stage,'women-r4-1',0,'away',5).clearedMatches,1);
  assert.deepEqual(stage.rounds[1].matches[0].legs[0],{homeScore:null,awayScore:null,homeCards:{yellow:0,secondYellowRed:0,directRed:0,yellowDirectRed:0},awayCards:{yellow:0,secondYellowRed:0,directRed:0,yellowDirectRed:0}});
  assert.equal(getKnockoutBracket(stage).rounds[1].matches[0].home.name,'乙');
  assert.equal(getKnockoutFairPlay(stage).find(row=>row.name==='乙').played,2);
});

test('平局决胜可以指定晋级，改分后撤销旧选择且不会套用后续比分', async () => {
  const { setKnockoutTiebreak } = await import('../public/knockout.mjs');
  const stage=createKnockoutStage('women-pku-cup','女足');
  for (const [id,a,b] of [['women-r4-1','甲','乙'],['women-r4-2','丙','丁']]) {
    setKnockoutTeam(stage,{matchId:id,name:a});setKnockoutTeam(stage,{matchId:id,side:'away',name:b});
    result(stage,id,0,1,1);result(stage,id,1,0,0);
    assert.equal(getKnockoutBracket(stage).rounds[0].matches.find(match=>match.id===id).winnerName,'');
    setKnockoutTiebreak(stage,id,'home');
  }
  result(stage,'women-final',0,0,0);setKnockoutTiebreak(stage,'women-final','away');
  assert.match(buildKnockoutPoster(stage).svg,/冠军 · 丙/);
  setKnockoutTiebreak(stage,'women-r4-1','away');
  assert.equal(stage.rounds[1].matches[0].tiebreakWinner,undefined);
  assert.equal(stage.rounds[1].matches[0].legs[0].awayScore,null);
  setKnockoutScore(stage,'women-r4-1',0,'home',2);
  assert.equal(stage.rounds[0].matches[0].tiebreakWinner,undefined);
  const state=createInitialState();state.competitions[1].knockout=stage;
  assert.equal(validSnapshot(state),true);
  assert.throws(()=>setKnockoutTiebreak(stage,'women-r4-1','away'),/平局/);
});

test('拒绝重复球队、未知对阵和未确定参赛球队的预填比分', () => {
  const stage=createKnockoutStage('men-freshman-cup','男足');
  setKnockoutTeam(stage,{byeId:'men-bye-1',name:'甲'});
  assert.throws(()=>setKnockoutTeam(stage,{matchId:'men-r12-1',name:' 甲 '}),/已在淘汰赛/);
  assert.throws(()=>setKnockoutScore(stage,'men-r8-1',0,'home',2),/两支球队/);
  assert.throws(()=>setKnockoutTeam(stage,{matchId:'men-r12-1',side:'other',name:'乙'}),/球队/);
});

test('轮空球队仅在八进四展示，移除十二进八轮空卡片并转义球队名称', () => {
  const stage=createKnockoutStage('men-freshman-cup','男足');
  for(let n=1;n<=4;n++)setKnockoutTeam(stage,{byeId:`men-bye-${n}`,name:`轮空${n}`});
  setKnockoutTeam(stage,{matchId:'men-r12-1',name:'<script>&甲'});
  const {svg}=buildKnockoutPoster(stage);
  assert.doesNotMatch(svg,/<circle|>[ABCD]<|<script>/);
  for(let n=1;n<=4;n++)assert.equal(svg.split(`轮空${n}`).length - 1, 2); // One card: title and visible text.
  assert.doesNotMatch(buildKnockoutPoster(createKnockoutStage('men-freshman-cup','男足')).svg,/待填轮空球队/);
  assert.ok(svg.includes('&lt;script&gt;&amp;甲'));
});

test('自定义赛事重置清空淘汰赛成绩、红黄牌及决胜选择，保留参赛球队', async () => {
  const {createCompetition,resetCompetition}=await import('../public/core.mjs');
  const {setKnockoutTiebreak}=await import('../public/knockout.mjs');
  const item=createCompetition({name:'校内赛',date:'2026-11-06'});
  item.knockout=createKnockoutStage(item.id,'校内淘汰赛');
  setKnockoutTeam(item.knockout,{matchId:'men-r12-1',name:'甲'});setKnockoutTeam(item.knockout,{matchId:'men-r12-1',side:'away',name:'乙'});
  result(item.knockout,'men-r12-1',0,0,0);setKnockoutTiebreak(item.knockout,'men-r12-1','home');
  setKnockoutCards(item.knockout,'men-r12-1',0,'home',{yellow:1});setKnockoutDiscipline(item.knockout,'甲',2);
  const reset=resetCompetition(item);
  assert.equal(reset.knockout.rounds[0].matches[0].homeName,'甲');
  assert.equal(reset.knockout.rounds[0].matches[0].legs[0].homeScore,null);
  assert.equal(reset.knockout.rounds[0].matches[0].legs[0].homeCards.yellow,0);
  assert.equal(reset.knockout.rounds[0].matches[0].tiebreakWinner,undefined);
  assert.deepEqual(reset.knockout.disciplineDeductions,{});
  assert.equal(item.knockout.rounds[0].matches[0].legs[0].homeScore,0);
  const season=createCompetitionSeason(item,'2027-28');assert.equal(typeof season.knockout.title,'string');
});

test('点球比分单独保存，平局时自动晋级且不增加公平竞赛场次', async () => {
  const {setKnockoutPenalties}=await import('../public/knockout.mjs');
  const stage=createKnockoutStage('men-freshman-cup','男足');
  setKnockoutTeam(stage,{matchId:'men-r12-1',name:'甲'});setKnockoutTeam(stage,{matchId:'men-r12-1',side:'away',name:'乙'});
  result(stage,'men-r12-1',0,1,1);
  setKnockoutPenalties(stage,'men-r12-1','home',4);
  assert.equal(getKnockoutBracket(stage).rounds[0].matches[0].winnerName,'');
  setKnockoutPenalties(stage,'men-r12-1','away',4);
  assert.equal(getKnockoutBracket(stage).rounds[0].matches[0].winnerName,'');
  setKnockoutPenalties(stage,'men-r12-1','away',3);
  assert.equal(getKnockoutBracket(stage).rounds[1].matches[0].away.name,'甲');
  assert.equal(stage.rounds[0].matches[0].legs[0].homeScore,1);
  assert.equal(getKnockoutFairPlay(stage).find(row=>row.name==='甲').played,1);
  const {svg}=buildKnockoutPoster(stage);assert.ok(svg.includes('1(4)'));assert.ok(svg.includes('1(3)'));
  setKnockoutScore(stage,'men-r12-1',0,'home',2);
  assert.equal(stage.rounds[0].matches[0].penalties,undefined);
  assert.throws(()=>setKnockoutPenalties(stage,'men-r12-1','home',5),/平局/);
  result(stage,'men-r12-1',0,2,2);
  for(const value of [-1,100,1.5])assert.throws(()=>setKnockoutPenalties(stage,'men-r12-1','home',value),/点球比分/);
});

test('更改点球胜者清空后轮比分与点球，清空点球后不保留手动晋级', async () => {
  const {setKnockoutPenalties,setKnockoutTiebreak}=await import('../public/knockout.mjs');
  const stage=createKnockoutStage('men-freshman-cup','男足');
  setKnockoutTeam(stage,{byeId:'men-bye-1',name:'丙'});
  setKnockoutTeam(stage,{matchId:'men-r12-1',name:'甲'});setKnockoutTeam(stage,{matchId:'men-r12-1',side:'away',name:'乙'});
  result(stage,'men-r12-1',0,0,0);setKnockoutTiebreak(stage,'men-r12-1','home');
  setKnockoutPenalties(stage,'men-r12-1','home',4);setKnockoutPenalties(stage,'men-r12-1','away',3);
  assert.equal(stage.rounds[0].matches[0].tiebreakWinner,undefined);
  result(stage,'men-r8-1',0,1,1);setKnockoutPenalties(stage,'men-r8-1','home',3);setKnockoutPenalties(stage,'men-r8-1','away',5);
  assert.equal(setKnockoutPenalties(stage,'men-r12-1','away',5).clearedMatches,1);
  assert.equal(stage.rounds[1].matches[0].penalties,undefined);
  assert.equal(stage.rounds[1].matches[0].legs[0].homeScore,null);
  setKnockoutPenalties(stage,'men-r12-1','home','');setKnockoutPenalties(stage,'men-r12-1','away','');
  assert.equal(stage.rounds[0].matches[0].penalties,undefined);
  assert.equal(getKnockoutBracket(stage).rounds[0].matches[0].winnerName,'');
});

test('晋级图保留空白气泡、隐藏赛段标题，左右比分镜像且仅用直角连线', () => {
  const stage=createKnockoutStage('men-freshman-cup','男足');
  let {svg}=buildKnockoutPoster(stage);
  assert.doesNotMatch(svg,/待晋级|待填球队|待填轮空球队|>–</);
  assert.equal([...svg.matchAll(/<rect\b[^>]*\brx="22"/g)].length,22);
  assert.doesNotMatch(svg,/>十二进八<|>八进四<|>半决赛<|>决赛</);
  const paths=[...svg.matchAll(/<path d="([^"]+)"/g)].map(match=>match[1]);
  assert.ok(paths.length>0);assert.ok(paths.every(path=>!/[CQASLT]/i.test(path)));
  setKnockoutTeam(stage,{matchId:'men-r12-1',name:'左队'});setKnockoutTeam(stage,{matchId:'men-r12-1',side:'away',name:'左客'});
  setKnockoutTeam(stage,{matchId:'men-r12-3',name:'右队'});setKnockoutTeam(stage,{matchId:'men-r12-3',side:'away',name:'右客'});
  result(stage,'men-r12-1',0,2,0);result(stage,'men-r12-3',0,3,1);
  ({svg}=buildKnockoutPoster(stage));
  const texts=[...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>([^<]*)<\/text>/g)].map(([,x,y,value])=>({x:Number(x),y:Number(y),value}));
  for(const [name,score,mirrored] of [['左队','2',false],['右队','3',true]]){
    const label=texts.find(t=>t.value===name&&(mirrored?t.x>1400:t.x<200));const value=texts.find(t=>t.value===score&&t.y===label.y&&(mirrored?t.x>800:t.x<800));
    assert.ok(value);assert.equal(value.x<label.x,mirrored);
  }
});

test('男女足每条晋级线的出口都对齐两队中点，端点精确落在气泡边缘', () => {
  for(const id of ['men-freshman-cup','women-pku-cup']) {
    const stage=createKnockoutStage(id,'对齐验收');
    for(const populated of [false,true]) {
      if(populated){
        const first=stage.rounds[0].matches[0];
        setKnockoutTeam(stage,{matchId:first.id,name:'测试长队名以验证气泡宽度变化'});
        setKnockoutTeam(stage,{matchId:first.id,side:'away',name:'客队'});
        result(stage,first.id,0,2,1);
      }
      const {svg}=buildKnockoutPoster(stage);
      const bubbles=[...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="22"/g)]
        .map(([,x,y,width,height])=>({x:Number(x),y:Number(y)+Number(height)/2,width:Number(width)}));
      const paths=[...svg.matchAll(/<path d="([^"]+)"/g)].map(match=>match[1]);
      assert.equal(paths.length,id==='men-freshman-cup'?10:2);
      const onBubble=(x,y)=>bubbles.some(b=>b.y===y&&(Math.abs(b.x-x)<1e-8||Math.abs(b.x+b.width-x)<1e-8));
      for(const path of paths){
        const n=path.match(/[\d.]+/g).map(Number);
        // Two horizontal input arms, one vertical join, one horizontal output.
        const sourceX=n[0],upperY=n[1],otherX=n[3],lowerY=n[4],outputY=n[10],targetX=n[11];
        assert.equal(n.length,12);
        assert.equal(sourceX,otherX);
        assert.equal(outputY,(upperY+lowerY)/2,'晋级气泡必须位于上一场两队正中');
        assert.ok(onBubble(sourceX,upperY),'上队连线应接在气泡边缘');
        assert.ok(onBubble(sourceX,lowerY),'下队连线应接在气泡边缘');
        assert.ok(onBubble(targetX,outputY),'晋级横线应接在下一轮气泡中心');
      }
    }
  }
});

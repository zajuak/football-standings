import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,createCompetitionSeason,createResult} from '../public/core.mjs';
import {createKnockoutStage,setKnockoutTeam,setKnockoutScore,setKnockoutCards,setKnockoutDiscipline,setKnockoutPenalties} from '../public/knockout.mjs';
import {getSeasonFairPlay} from '../public/fair-play.mjs';

const stats={played:0,wins:0,draws:0,losses:0,goalsFor:0,goalsAgainst:0};
const team=(id,name)=>({id,name,base:{...stats},fairPlay:5,disciplineDeduction:0});

test('总表按小组赛和淘汰赛全部场次加权，包含已被淘汰球队并分别扣除纪律分',()=>{
  const season={groups:[{id:'g',name:'A组',teams:[team('a','甲'),team('b','乙'),team('c','丙'),team('d','未出场')]}],matches:[],knockout:createKnockoutStage('men-freshman-cup','男足')};
  const group=season.groups[0];group.teams[0].disciplineDeduction=1;
  for(const awayId of ['b','c'])season.matches.push(createResult(season,{groupId:'g',homeId:'a',awayId,homeScore:1,awayScore:0,homeCards:{yellow:2},awayCards:{}}));
  setKnockoutTeam(season.knockout,{matchId:'men-r12-1',name:'甲'});setKnockoutTeam(season.knockout,{matchId:'men-r12-1',side:'away',name:'乙'});
  setKnockoutScore(season.knockout,'men-r12-1',0,'home',1);setKnockoutScore(season.knockout,'men-r12-1',0,'away',1);
  setKnockoutCards(season.knockout,'men-r12-1',0,'home',{directRed:1});setKnockoutDiscipline(season.knockout,'甲',2);
  setKnockoutPenalties(season.knockout,'men-r12-1','home',4);setKnockoutPenalties(season.knockout,'men-r12-1','away',3);
  const rows=getSeasonFairPlay(season),a=rows.find(row=>row.name==='甲');
  assert.equal(a.groupPlayed,2);assert.equal(a.knockoutPlayed,1);assert.equal(a.played,3);
  assert.equal(a.beforeDiscipline,7/3);assert.equal(a.groupDiscipline,1);assert.equal(a.knockoutDiscipline,2);assert.equal(a.fairPlay,7/3-3);
  assert.equal(rows.find(row=>row.name==='丙').knockoutPlayed,0);assert.equal(rows.find(row=>row.name==='丙').played,1);
  assert.equal(rows.at(-1).name,'未出场');assert.equal(rows.at(-1).played,0);
  season.placement={groups:[{id:'p',name:'排位赛',teams:[team('p','甲')]}],matches:[]};
  assert.deepEqual(getSeasonFairPlay(season),rows);
});

test('总表包含历史基础场次、双回合两场，不混入其他赛季',()=>{
  const state=createInitialState(),season=state.competitions[1];
  season.groups[0].teams[0].base={played:2,wins:1,draws:1,losses:0,goalsFor:3,goalsAgainst:1};
  season.groups[0].teams[0].fairPlay=4;
  const name=season.groups[0].teams[0].name;
  setKnockoutTeam(season.knockout,{matchId:'women-r4-1',name});setKnockoutTeam(season.knockout,{matchId:'women-r4-1',side:'away',name:'对手'});
  for(const i of [0,1]){setKnockoutScore(season.knockout,'women-r4-1',i,'home',2);setKnockoutScore(season.knockout,'women-r4-1',i,'away',0)}
  const prior=getSeasonFairPlay(season).find(row=>row.name===name);
  assert.equal(prior.knockoutPlayed,2);assert.ok(prior.groupPlayed>=2);
  const created=createCompetitionSeason(season,'2027-28');
  assert.deepEqual(getSeasonFairPlay(created),[]);
  assert.equal(getSeasonFairPlay(season).find(row=>row.name===name).fairPlay,prior.fairPlay);
});

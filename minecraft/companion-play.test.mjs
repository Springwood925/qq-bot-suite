import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCompanionPlay} from './companion-play.mjs';

function vec(x,y,z){return {x,y,z,floored(){return vec(Math.floor(x),Math.floor(y),Math.floor(z));},offset(a,b,c){return vec(x+a,y+b,z+c);},distanceTo(p){return Math.hypot(x-p.x,y-p.y,z-p.z);}};}
function setup(){
 const bot={entity:{position:vec(0,64,0)},players:{owner:{entity:{position:vec(0,64,0)}}},entities:{},health:20,blockAt:p=>p.y===63?{name:'grass',boundingBox:'block'}:{name:'air'}};
 const calls=[]; let complete;
 const actions={follow:n=>calls.push(['follow',n]),gotoXYZ:(...v)=>{calls.push(['goto',...v]);return new Promise(r=>{complete=r;});},stopMoving:()=>calls.push(['stop'])};
 const play=createCompanionPlay({bot,actions,owner:'owner',intervalMs:999999,random:()=>0});
 return {bot,calls,play,complete:(v)=>complete(v)};
}
test('探索后记录结果并回到跟随',async()=>{
 const x=setup(); x.play.start(); const task=x.play.tick();
 assert.equal(x.play.status().phase,'moving'); assert.deepEqual(x.calls[1],['goto',5,64,0,1]);
 x.complete(true); await task;
 assert.equal(x.play.status().lastResult.ok,true); assert.equal(x.play.status().phase,'following');
 assert.equal(x.calls.filter(c=>c[0]==='follow').length,2); x.play.stop();
});
test('停止后异步探索结束不会恢复跟随',async()=>{
 const x=setup(); x.play.start(); const task=x.play.tick(); x.play.stop(); x.complete(true); await task;
 assert.equal(x.play.status().phase,'stopped'); assert.equal(x.calls.filter(c=>c[0]==='follow').length,1);
 assert.equal(x.calls.filter(c=>c[0]==='stop').length,1);
});
test('玩家不在视野、低血量或有敌人时仍会探索',async()=>{
 const x=setup(); x.play.start(); x.bot.health=8; x.bot.players.owner.entity=null;
 x.bot.entities.enemy={name:'creeper',position:vec(2,64,0)};
 const task=x.play.tick(); assert.equal(x.play.status().phase,'moving'); x.complete(true); await task;
 assert.equal(x.play.status().lastResult.ok,true); assert.equal(x.play.status().phase,'waiting'); x.play.stop();
});

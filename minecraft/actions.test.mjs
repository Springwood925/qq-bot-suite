import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createActions} from './actions.mjs';

function fakeBot() {
  const pending = [], goals = [];
  const position = {x:0,y:64,z:0,clone(){return this;},distanceTo(p){return Math.abs(p.x-this.x);}};
  const bot = {entity:{position},players:{owner:{entity:{position:{x:10,y:64,z:0}}}},game:{},
    pathfinder:{goto(goal){goals.push(goal); return new Promise(resolve=>pending.push(resolve));},setGoal(goal){goals.push(goal);}},
    clearControlStates(){},setControlState(){}};
  return {bot,pending,goals};
}

test('停止跟随后旧移动完成不会取消新命令或恢复跟随', async () => {
  const {bot,pending,goals}=fakeBot();
  const actions=createActions(bot,()=>{});
  actions.follow('owner');
  assert.equal(pending.length,1);
  const move=actions.gotoXYZ(15,64,0);
  assert.equal(pending.length,2);
  const before=goals.length;
  pending[0]();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(goals.length,before);
  assert.equal(actions.status().following,null);
  pending[1]();
  assert.equal(await move,true);
});

test('停止跟随会取消尚未完成的移动', async () => {
  const {bot,pending}=fakeBot();
  const actions=createActions(bot,()=>{});
  actions.follow('owner');
  actions.stopFollow();
  pending[0]();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(actions.status().following,null);
});

test('状态只报告附近可见的掉落物位置', () => {
  const {bot}=fakeBot(); bot.entities={
    near:{name:'item',position:{x:4,y:64,z:1}},
    far:{name:'item',position:{x:30,y:64,z:1}},
    player:{name:'player',position:{x:2,y:64,z:1}}
  };
  const drops=createActions(bot,()=>{}).status().nearbyDrops;
  assert.equal(drops.length,1);
  assert.deepEqual(drops[0],{x:4,y:64,z:1,distance:4});
});

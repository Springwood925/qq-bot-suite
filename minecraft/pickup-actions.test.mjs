import {test} from 'node:test';import assert from 'node:assert/strict';import {createActions} from './actions.mjs';
test('移动到掉落物中心坐标时使用所在方块，不向隔壁四舍五入',async()=>{
 let goal;const pos={x:154,y:64,z:141,clone(){return this},distanceTo(){return 2}};
 const b={entity:{position:pos},players:{},game:{},pathfinder:{goto(g){goal=g;return Promise.resolve()},setGoal(){}},clearControlStates(){}};
 const ok=await createActions(b,()=>{}).gotoXYZ(152.5,61.5,140.5,0);
 assert.equal(ok,true);assert.equal(goal.x,152);assert.equal(goal.y,61);assert.equal(goal.z,140);assert.equal(goal.rangeSq,0);
});

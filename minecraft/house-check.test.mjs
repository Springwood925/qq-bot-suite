import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectHouse,planHouse} from './house-check.mjs';

const vec=(x,y,z)=>({x,y,z,offset(dx,dy,dz){return vec(x+dx,y+dy,z+dz)}});
test('房屋检查和蓝图标出内部占用物，不修改世界',()=>{
 const origin=vec(10,64,20),calls=[];
 const bot={blockAt(p){calls.push(p);return p.x===11&&p.y===64&&p.z===21?{name:'chest',boundingBox:'block'}:{name:'air',boundingBox:'empty'}}};
 const expected=[{x:11,y:64,z:21,block:'chest'}];
 const plan=planHouse(bot,origin,{width:3,depth:3,height:2});
 const check=inspectHouse(bot,origin,{width:3,depth:3,height:2});
 assert.equal(plan.interiorBlocked,1);assert.deepEqual(plan.interiorExamples,expected);
 assert.equal(check.insideBlocked,1);assert.deepEqual(check.interiorExamples,expected);
 assert.ok(calls.length>0);
});

test('屋内火把不会误判堵塞，水仍会列出',()=>{
 const origin=vec(10,64,20);
 const bot={blockAt(p){
  if(p.x===11&&p.z===21&&p.y===64)return {name:'torch',boundingBox:'empty'};
  if(p.x===11&&p.z===21&&p.y===65)return {name:'water',boundingBox:'empty'};
  return {name:'air',boundingBox:'empty'};
 }};
 for(const result of [planHouse(bot,origin,{width:3,depth:3,height:2}),inspectHouse(bot,origin,{width:3,depth:3,height:2})]) {
  assert.deepEqual(result.interiorExamples,[{x:11,y:65,z:21,block:'water'}]);
 }
});

test('有床和箱子但入口可通行的完整房屋可以验收',()=>{
 const origin=vec(10,64,20),solid={name:'planks',boundingBox:'block'},air={name:'air',boundingBox:'empty'};
 const bot={blockAt(p){
  const x=p.x-10,y=p.y-64,z=p.z-20;
  if(y===-1 || y===3)return solid;
  if(y>=0&&y<3&&(x===0||x===4||z===0||z===4))return z===0&&x===2&&y<2?air:solid;
  if(y===0&&x===1&&z===2)return {name:'chest',boundingBox:'block'};
  if(y===0&&x===3&&(z===2||z===3))return {name:'bed',boundingBox:'block'};
  return air;
 }};
 const result=inspectHouse(bot,origin,{width:5,depth:5,height:3});
 assert.equal(result.insideBlocked,3);
 assert.equal(result.complete,true);
 assert.ok(result.interiorReachable>0);
});
test('家具堵死入口时仍不能验收',()=>{
 const origin=vec(10,64,20),solid={name:'planks',boundingBox:'block'},air={name:'air',boundingBox:'empty'};
 const bot={blockAt(p){const x=p.x-10,y=p.y-64,z=p.z-20;
  if(y===-1||y===3)return solid;
  if(y>=0&&y<3&&(x===0||x===2||z===0||z===2))return z===0&&x===1&&y<2?air:solid;
  if(y===0&&x===1&&z===1)return {name:'chest',boundingBox:'block'};
  return air;
 }};
 const result=inspectHouse(bot,origin,{width:3,depth:3,height:3});
 assert.equal(result.complete,false);assert.match(result.issues.join(' '),/入口没有连接/);
});

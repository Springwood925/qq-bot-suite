import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildBox,runSequence} from './buildseq.mjs';
import {Vec3} from 'vec3';

function makeBot(obstructed=false){
 let placed=0;const map=new Map(),item={name:'planks',type:5,count:64};
 const bot={inventory:{items:()=>[item]},registry:{blocksByName:{planks:{id:5}}},equip:async function(){this.heldItem=item},heldItem:item,entity:{position:new Vec3(0,64,0)},
  blockAt(p){assert.equal(typeof p.floored,'function');if(p.y===63)return {name:'stone',type:1,boundingBox:'block',position:p}; if(p.y===64 && obstructed)return {name:'chest',type:54,boundingBox:'block',position:p}; return map.get(p.toString())||{name:'air',type:0,boundingBox:'empty',position:p};},
  placeBlock:async(ref,face)=>{assert.equal(typeof face.offset,'function');placed++;const pos=ref.position.plus(face);map.set(pos.toString(),{name:'planks',type:5,boundingBox:'block',position:pos});},pathfinder:{goto:async()=>{},setGoal(){}}};
 return {bot,count:()=>placed};
}
test('成功放置后报告建造完成',async()=>{const x=makeBot();const r=await buildBox(x.bot,{x:0,y:64,z:0,width:1,height:1,depth:1,item:'planks'});assert.equal(r.complete,true);assert.equal(x.count(),1);});
test('其他方块占位时不报告建造完成',async()=>{const x=makeBot(true);const r=await buildBox(x.bot,{x:0,y:64,z:0,width:1,height:1,depth:1,item:'planks'});assert.equal(r.complete,false);assert.equal(r.failed,1);assert.equal(x.count(),0);});
test('顺序动作在目标格放置并验证结果',async()=>{const x=makeBot();const r=await runSequence(x.bot,[{type:'place',x:0,y:64,z:0,item:'planks'}]);assert.equal(r.results[0].ok,true);assert.equal(r.results[0].result.target.y,64);assert.equal(x.count(),1)});
test('顺序动作移动超时时停止寻路并报告失败',async()=>{const x=makeBot();let stopped=false;x.bot.pathfinder.goto=()=>new Promise(()=>{});x.bot.pathfinder.setGoal=g=>{if(g===null)stopped=true};const r=await runSequence(x.bot,[{type:'move',x:1,y:64,z:1,budgetMs:5}]);assert.equal(r.results[0].ok,false);assert.equal(stopped,true)});

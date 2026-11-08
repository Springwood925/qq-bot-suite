import {test} from 'node:test';import assert from 'node:assert/strict';import {inspectWaterArea} from './water-area.mjs';
const v=(x,y,z)=>({x,y,z,offset(dx,dy,dz){return v(x+dx,y+dy,z+dz)}});
test('统计指定平面水量和露天水面而不是把最近一格当全部',()=>{
 const bot={blockAt(p){if(p.y===63)return {name:'air'};return {name:p.x<=1?'water':'sand'}}};
 const r=inspectWaterArea(bot,v(1,62,0),1);assert.equal(r.waterAtLevel,6);assert.equal(r.openSurface,6);
});
test('未加载的区块单独计数',()=>{const bot={blockAt:()=>null};const r=inspectWaterArea(bot,v(0,62,0),1);assert.equal(r.unknown,9);assert.equal(r.openSurface,0)});

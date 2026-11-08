import {test} from 'node:test';import assert from 'node:assert/strict';import {createActions} from './actions.mjs';
test('掉落物列表优先显示最近目标，不被先发现的远处物品挤掉',()=>{
 const pos={x:0,y:64,z:0,distanceTo:p=>Math.abs(p.x)};
 const bot={entity:{position:pos},players:{},game:{},registry:{entitiesByName:{}},entities:{},pathfinder:{},clearControlStates(){}};
 for(let i=0;i<12;i++)bot.entities['far'+i]={name:'item',position:{x:10+i,y:64,z:0}};
 bot.entities.near={name:'item',position:{x:1,y:64,z:0},getDroppedItem:()=>({name:'cobblestone',type:4,count:1,metadata:0})};
 const list=createActions(bot,()=>{}).status().nearbyDrops;
 assert.equal(list.length,12);assert.equal(list[0].distance,1);assert.equal(list[0].item.name,'cobblestone');
});

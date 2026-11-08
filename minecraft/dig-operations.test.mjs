import {test} from 'node:test';import assert from 'node:assert/strict';
import {digWithHarvestCheck} from './dig-operations.mjs';
const instant=async()=>{};
function fake(items,held=null){return {game:{gameMode:'survival'},heldItem:held,inventory:{items:()=>items},equip:async function(i){this.heldItem=i},dig:async function(){this.dug=true},blockAt:()=>({name:'air'})};}
const stone={name:'stone',position:{x:1,y:2,z:3},harvestTools:{270:true,274:true}};
test('石头会自动装备合适镐子，但不把未拾取当作掉落',async()=>{const b=fake([{name:'wooden_pickaxe',type:270,count:1}]);const r=await digWithHarvestCheck(b,stone,{wait:instant});assert.equal(r.ok,true);assert.equal(r.tool,'wooden_pickaxe');assert.equal(r.pickupObserved,false);assert.equal(b.dug,true)});
test('没有合适等级工具时不挖掉矿石',async()=>{const b=fake([{name:'wooden_pickaxe',type:270,count:1}]);const r=await digWithHarvestCheck(b,{...stone,name:'iron_ore',harvestTools:{274:true}},{wait:instant});assert.equal(r.ok,false);assert.equal(b.dug,undefined)});
test('背包出现增量才确认获得了物品',async()=>{const items=[{name:'wooden_pickaxe',type:270,count:1}],b=fake(items);b.dig=async()=>items.push({name:'cobblestone',type:4,count:1});const r=await digWithHarvestCheck(b,stone,{wait:instant});assert.equal(r.pickupObserved,true);assert.equal(r.gained[0].name,'cobblestone')});

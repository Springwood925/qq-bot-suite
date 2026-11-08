import {test} from 'node:test';import assert from 'node:assert/strict';import {digWithHarvestCheck} from './dig-operations.mjs';
test('工具耐久变化不误判为获得了新工具',async()=>{
 const tool={name:'wooden_pickaxe',type:270,metadata:5,maxDurability:59,count:1};
 const bot={game:{gameMode:'survival'},heldItem:tool,inventory:{items:()=>[tool]},dig:async()=>{tool.metadata=6},blockAt:()=>({name:'air'})};
 const v=await digWithHarvestCheck(bot,{name:'stone',position:{},harvestTools:{270:true}},{wait:async()=>{}});
 assert.deepEqual(v.gained,[]);assert.equal(v.pickupObserved,false);
});

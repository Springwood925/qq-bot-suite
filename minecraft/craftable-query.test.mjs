import {test} from 'node:test';import assert from 'node:assert/strict';import {queryCraftable} from './craftable-query.mjs';
function fake(){const items=[{name:'apple',id:1},{name:'stone_pickaxe',id:2},{name:'torch',id:3}];return {registry:{itemsArray:items,itemsByName:Object.fromEntries(items.map(i=>[i.name,i])),blocksByName:{crafting_table:{id:58}}},findBlock:()=>null,recipesFor:id=>id===1||id===2?[{}]:[]};}
test('具体物品查询不受列表截断影响',()=>{const b=fake();assert.equal(queryCraftable(b,{name:'stone_pickaxe'}).canCraft,true);assert.equal(queryCraftable(b,{name:'torch'}).canCraft,false);assert.equal(queryCraftable(b,{name:'missing'}).ok,false)});
test('可合成列表被截断时明确提示',()=>{const v=queryCraftable(fake(),{limit:1});assert.equal(v.can.length,1);assert.equal(v.truncated,true)});

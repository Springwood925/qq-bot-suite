import {test} from 'node:test';import assert from 'node:assert/strict';
import {createFoodOperations} from './food-operations.mjs';
const fake=()=>{let item={name:'apple',type:260,metadata:0,count:2};return {food:14,registry:{foodsByName:{apple:{}}},inventory:{items:()=>item?[item]:[]},equip:async()=>{},consume:async function(){item.count--;this.food=18}}};
test('核实饥饿值和食物数量变化后确认进食',async()=>{const b=fake(),r=await createFoodOperations().eat(b,'apple');assert.equal(r.ok,true);assert.equal(r.afterCount,1);assert.equal(r.afterFood,18)});
test('饱食或无法确认的食物不会被使用',async()=>{const b=fake();b.food=20;assert.equal((await createFoodOperations().eat(b,'apple')).ok,false);b.food=10;assert.equal((await createFoodOperations().eat(b,'unknown')).ok,false)});
test('服务端没有确认变化时不误报成功',async()=>{const b=fake();b.consume=async()=>{};assert.equal((await createFoodOperations().eat(b,'apple')).ok,false)});

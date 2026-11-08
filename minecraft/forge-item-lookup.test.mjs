import {test} from 'node:test';import assert from 'node:assert/strict';
import {currentLocalWorld,createForgeItemLookup} from './forge-item-lookup.mjs';
test('仅使用当前仍在运行的本机存档，拒绝危险路径',()=>{
 const start='Starting integrated minecraft server';
 assert.equal(currentLocalWorld(`${start}\nSaving chunks for level '测试'\/overworld`),'测试');
 assert.equal(currentLocalWorld(`${start}\nSaving chunks for level '测试'\/overworld\nStopping server`),null);
 assert.equal(currentLocalWorld(`${start}\nSaving chunks for level '..\\other'\/overworld`),null);
});
test('只给真实存在的 Forge 编号提供命名空间名称',async()=>{
 const lookup=createForgeItemLookup({gameDir:'x',readFile:async p=>p.endsWith('latest.log')?"Starting integrated minecraft server\nSaving chunks for level 'test'/overworld":Buffer.from('x'),parse:async()=>({FML:{Registries:{'minecraft:items':{ids:[{V:4427,K:'animania:animania_manual'}]}}}})});
 const map=await lookup([{name:'unknown'}]);assert.deepEqual(map.get(4427),{registryName:'animania:animania_manual',registryWorld:'test'});assert.equal(map.has(9999),false);
});

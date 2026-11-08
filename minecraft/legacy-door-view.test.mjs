import {test} from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {installLegacyDoorView} from './legacy-door-view.mjs';
const require=createRequire(import.meta.url);const data=require('minecraft-data')('1.13.2'),Block=require('prismarine-block')(data),id=data.blocksByName.oak_door.id;
const shapeFor=p=>Block.fromProperties(id,{...p,open:String(p.open),powered:'false'},0).shapes;
function pos(y){return {y,offset(_x,dy){return pos(y+dy)}}}
test('组合 1.12 门上下半状态，修正两半碰撞且不修改世界方块',()=>{
 let lower={name:'wooden_door',metadata:5,position:pos(64),shapes:[[1]],getProperties:()=>({facing:'south',open:'true'})};
 let upper={name:'wooden_door',metadata:8,position:pos(65),shapes:[[2]],getProperties:()=>({hinge:'left',open:'false'})};
 const bot={version:'1.12.2',blockAt:p=>p.y===64?lower:p.y===65?upper:null};installLegacyDoorView(bot,{shapeFor});
 assert.deepEqual(bot.blockAt(pos(64)).shapes,[[.8125,0,0,1,1,1]]);assert.deepEqual(bot.blockAt(pos(65)).shapes,[[.8125,0,0,1,1,1]]);
 assert.deepEqual(upper.shapes,[[2]]);assert.equal(upper.metadata,8);
 lower.metadata=1;assert.deepEqual(bot.blockAt(pos(65)).shapes,[[0,0,0,1,1,.1875]]);
});
test('缺少另一半或非目标版本时保留原视图',()=>{const original={name:'wooden_door',metadata:8,position:pos(65),shapes:[[2]]},bot={version:'1.12.2',blockAt:p=>p.y===65?original:null};installLegacyDoorView(bot,{shapeFor});assert.equal(bot.blockAt(pos(65)),original);assert.equal(installLegacyDoorView({version:'1.20',blockAt:()=>null},{shapeFor}),false)});

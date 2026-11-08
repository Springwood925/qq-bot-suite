import {test} from 'node:test';import assert from 'node:assert/strict';
import {createCombatOperations,nearbyHostiles} from './combat-operations.mjs';
const p=(x,y,z)=>({x,y,z,distanceTo(other){return Math.hypot(x-other.x,y-other.y,z-other.z)}});
function fake(){const bot={username:'bot',entity:{position:p(0,64,0)},entities:{},registry:{entitiesByName:{zombie:{category:'Hostile mobs'},cow:{category:'Passive mobs'}}},attack(e){this.attacked=e}};bot.entities={z:{id:1,name:'zombie',position:p(2,64,0)},c:{id:2,name:'cow',position:p(1,64,0)},o:{id:3,username:'owner',name:'player',position:p(1,64,1)}};return bot;}
test('列出并明确选择可见敌怪，攻击结果不伪称伤害',()=>{const b=fake(),c=createCombatOperations();assert.deepEqual(nearbyHostiles(b).map(x=>x.name),['zombie']);const r=c.attack(b,{name:'zombie'});assert.equal(r.ok,true);assert.equal(r.damageConfirmed,false);assert.equal(b.attacked.id,1)});
test('无目标、被动动物或过远时不误攻',()=>{const b=fake(),c=createCombatOperations();assert.equal(c.attack(b,{}).ok,false);assert.equal(c.attack(b,{name:'cow'}).ok,false);b.entities.z.position=p(9,64,0);assert.equal(c.attack(b,{name:'zombie'}).ok,false);assert.equal(b.attacked,undefined)});

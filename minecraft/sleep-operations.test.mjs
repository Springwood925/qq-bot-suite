import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {sleepOnBed,wakeFromBed} from './sleep-operations.mjs';
function fake(){const b=new EventEmitter();b.game={dimension:'overworld'};b.isSleeping=false;b.sleep=async()=>{b.isSleeping=true};b.wake=async()=>{b.isSleeping=false;b.emit('wake')};return b;}
test('服务端确认后才报告睡觉和起床成功',async()=>{const b=fake();assert.equal((await sleepOnBed(b,{name:'bed'})).ok,true);assert.equal((await wakeFromBed(b)).sleeping,false)});
test('下界和非床拒绝操作，服务端拒绝不误报成功',async()=>{const b=fake();b.game.dimension='the_nether';assert.equal((await sleepOnBed(b,{name:'bed'})).ok,false);b.game.dimension='overworld';assert.equal((await sleepOnBed(b,{name:'stone'})).ok,false);b.sleep=async()=>{throw Error('not night')};assert.equal((await sleepOnBed(b,{name:'bed'})).ok,false)});
test('起床未被服务器确认时报告失败',async()=>{const b=fake();b.isSleeping=true;b.wake=async()=>{};assert.equal((await wakeFromBed(b,5)).ok,false)});

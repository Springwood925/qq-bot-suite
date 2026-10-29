import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recordTurnFailure,errorNoticeAllowed,failureRetryAt} from '../src/turn-failure-policy.js';
const terminal=(seq,status=400,code='INVALID_REQUEST')=>({seq,data:{reason:{kind:'error',error:{status,code}}}});
test('400第一次允许轮换，重复回放不消耗恢复额度且不会移动退避时间',()=>{const d={};assert.equal(recordTurnFailure(d,'s',terminal(10),100000).rotate,true);const before=JSON.stringify(d);assert.equal(recordTurnFailure(d,'s',terminal(10),200000).duplicate,true);assert.equal(JSON.stringify(d),before);});
test('新会话仍400时十分钟退避，三十分钟内不再创建会话',()=>{const d={};recordTurnFailure(d,'s',terminal(10),100000);assert.equal(recordTurnFailure(d,'s2',terminal(20),110000).rotate,false);assert.equal(failureRetryAt(d),710000);assert.equal(recordTurnFailure(d,'s2',terminal(30),720000).rotate,false);assert.equal(recordTurnFailure(d,'s2',terminal(40),2000000).rotate,true);});
test('临时错误指数退避有上限且不轮换，JSON持久化后仍保留限制',()=>{let d={};for(let i=0;i<20;i++)assert.equal(recordTurnFailure(d,'s',terminal(i,503,'SERVER'),100000).rotate,false);assert.equal(failureRetryAt(d),100000+15*60000);d=JSON.parse(JSON.stringify(d));assert.equal(failureRetryAt(d),100000+15*60000);});
test('管理员相同会话告警十五分钟最多一次，重载后仍限制',()=>{const d={};assert.equal(errorNoticeAllowed(d,100000),true);assert.equal(errorNoticeAllowed(JSON.parse(JSON.stringify(d)),100001),false);assert.equal(errorNoticeAllowed(d,100000+15*60000),true);});

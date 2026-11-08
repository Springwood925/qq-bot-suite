import {test} from 'node:test';import assert from 'node:assert/strict';import {readManualMode,writeManualMode} from './mc-mode-state.mjs';
test('开关可重启后恢复，未知值不伪称开或关',()=>{let value;writeManualMode(true,v=>value=v,123);assert.deepEqual(readManualMode(value),{manual:true,manualAt:123});assert.equal(readManualMode({manual:'false'}).manual,null);writeManualMode(false,v=>value=v,124);assert.equal(readManualMode(value).manual,false)});
test('保存失败不返回已提交状态',()=>assert.throws(()=>writeManualMode(true,()=>{throw Error('disk')})));

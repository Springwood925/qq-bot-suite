import {test} from 'node:test';
import assert from 'node:assert/strict';
import {transcribeLocal} from './local-asr.mjs';
const script=new URL('./local-asr.mjs',import.meta.url).pathname;
const existing=process.platform==='win32'?decodeURIComponent(script).replace(/^\//,''):decodeURIComponent(script);

test('优先使用本地 SenseVoice，保持识别结果',async()=>{
 const calls=[];
 const result=await transcribeLocal({wav:'sample.wav',whisper:{cli:'whisper'},model:'model',script:existing,run:async(cmd,args)=>{calls.push(cmd);return {stdout:'薯条群\n'}}});
 assert.equal(result,'薯条群');assert.deepEqual(calls,['python']);
});
test('SenseVoice 故障时回退 Whisper，挂断时不回退',async()=>{
 const calls=[];
 const run=async(cmd)=>{calls.push(cmd);if(cmd==='python')throw Error('unavailable');return {stdout:'识别结果\n'}};
 assert.equal(await transcribeLocal({wav:'sample.wav',whisper:{cli:'whisper'},model:'model',script:existing,run}),'识别结果');
 assert.deepEqual(calls,['python','whisper']);
 const controller=new AbortController();controller.abort();calls.length=0;
 await assert.rejects(transcribeLocal({wav:'sample.wav',whisper:{cli:'whisper'},model:'model',script:existing,run,signal:controller.signal}));
 assert.deepEqual(calls,['python']);
});

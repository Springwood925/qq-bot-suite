import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {createBackgroundAudio} from './background-audio.mjs';

function fixture(){
 const commands=[],child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.killed=false;
 child.stdin=new Writable({write(chunk,_encoding,done){commands.push(JSON.parse(String(chunk)));done();}});
 child.kill=()=>{child.killed=true;};
 const engine=createBackgroundAudio({root:process.cwd(),spawn:()=>child,transcribe:async()=>'',respond:async()=>'',synthesize:async()=>'',decode:async()=>Buffer.alloc(0)});
 return {engine,child,commands};
}
test('仅接通时开启后台收音，挂机或状态失联立即停止',()=>{
 const {engine,commands}=fixture();
 engine.setCallState('idle');engine.setCallState('ringing');assert.equal(commands.length,0);
 engine.setCallState('active');assert.equal(commands.at(-1).type,'start');
 engine.setCallState('unknown');assert.equal(commands.at(-1).type,'stop');
 engine.setCallState('active');assert.equal(commands.at(-1).type,'start');
 engine.setCallState('idle');assert.equal(commands.at(-1).type,'stop');engine.close();
});
test('手动停止后不因重复活动状态自行恢复，下一通才重置',()=>{
 const {engine,commands}=fixture();engine.setCallState('active');engine.control('stop');
 const count=commands.length;engine.setCallState('active');assert.equal(commands.length,count);
 engine.setCallState('idle');engine.setCallState('active');assert.equal(commands.at(-1).type,'start');engine.close();
});
test('后台收到音频后依次识别、回复、播放，面板无需打开',async()=>{
 const commands=[],child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.killed=false;
 child.stdin=new Writable({write(chunk,_encoding,done){commands.push(JSON.parse(String(chunk)));done();}});child.kill=()=>{child.killed=true;};
 const engine=createBackgroundAudio({root:process.cwd(),spawn:()=>child,transcribe:async()=> '你好',respond:async()=> '在呢',synthesize:async()=> 'voice.wav',decode:async()=>Buffer.from('pcm')});
 engine.setCallState('active');child.stdout.write(JSON.stringify({type:'audio',data:Buffer.from('audio').toString('base64')})+'\n');
 await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));
 const play=commands.find(x=>x.type==='play');assert.ok(play);assert.equal(Buffer.from(play.data,'base64').toString(),'pcm');
 child.stdout.write(JSON.stringify({type:'play_done',id:play.id,status:'done'})+'\n');
 await new Promise(r=>setImmediate(r));assert.equal(engine.status().log[0].text,'在呢');
 engine.setCallState('idle');engine.close();
});

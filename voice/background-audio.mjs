import {spawn as spawnProcess} from 'node:child_process';
import readline from 'node:readline';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import {createTurnController} from './turn-controller.mjs';

export function createBackgroundAudio({root,transcribe,respond,synthesize,decode,spawn=spawnProcess}) {
  let worker=null,callState='unknown',paused=false,started=false,controller=null,closed=false,retryTimer=null;
  let lastError='',phase='等待 QQ 语音通话',devices={inputs:[],outputs:[],input:'Voicemeeter Out B1',output:'Voicemeeter AUX Input',threshold:.025};
  const settingsFile=path.join(root,'audio-devices.json');let restored=false;
  const log=[],pending=new Map();
  const add=(who,text)=>{log.unshift({who,text:String(text||'').slice(0,500)});log.splice(30);};
  function send(message){if(worker&&!worker.killed&&worker.stdin.writable)worker.stdin.write(JSON.stringify(message)+'\n');}
  function interrupt(){send({type:'interrupt'});}
  function createController(){return createTurnController({
    transcribe:(audio,{signal})=>transcribe(audio,signal),
    respond:(text,{signal})=>respond(text,signal),
    speak:async(text,{signal})=>{
      const file=await synthesize(text,signal);if(signal.aborted)throw new DOMException('通话已结束','AbortError');
      const pcm=await decode(file,signal);if(signal.aborted)throw new DOMException('通话已结束','AbortError');
      const id=crypto.randomUUID();
      await new Promise((resolve,reject)=>{
        const abort=()=>{pending.delete(id);interrupt();reject(new DOMException('通话已结束','AbortError'));};
        pending.set(id,{resolve:()=>{signal.removeEventListener('abort',abort);resolve();},reject:e=>{signal.removeEventListener('abort',abort);reject(e);}});
        signal.addEventListener('abort',abort,{once:true});
        if(signal.aborted){abort();return;}
        send({type:'play',id,data:pcm.toString('base64')});
      });
    },
    onEvent:({type,...detail})=>{
      if(type==='heard'){add('你',detail.text);phase='小鲸鱼在想…';}
      else if(type==='speaking'){add('小鲸鱼',detail.text);phase='小鲸鱼在说话';}
      else if(type==='transcribing')phase='听你说…';
      else if(type==='idle'||type==='silence'||type==='interrupted')phase=callState==='active'&&!paused?'正在听':'等待 QQ 语音通话';
      else if(type==='error'){lastError=String(detail.message||'通话处理失败');phase='出错：'+lastError;}
    }
  });}
  function handle(message){
    if(message.type==='devices'){
      devices={...devices,...message,type:undefined};
      if(!restored){restored=true;try{
        const saved=JSON.parse(fs.readFileSync(settingsFile,'utf8'));
        if(devices.inputs.includes(saved.input)&&devices.outputs.includes(saved.output)&&Number.isFinite(saved.threshold)&&saved.threshold>=.005&&saved.threshold<=.12)
          send({type:'configure',input:saved.input,output:saved.output,threshold:saved.threshold});
      }catch{}}
    }
    else if(message.type==='state'){
      if(message.state==='listening')phase='正在听';
      else if(callState!=='active'||paused)phase='等待 QQ 语音通话';
    }else if(message.type==='error'){lastError=String(message.message||'音频服务异常');phase='出错：'+lastError;}
    else if(message.type==='speech'&&callState==='active'&&!paused){controller?.interrupt();}
    else if(message.type==='audio'&&callState==='active'&&!paused&&controller){
      const audio=Buffer.from(String(message.data||''),'base64');
      if(audio.length&&audio.length<4*1024*1024)void controller.submit(audio).catch(()=>{});
    }else if(message.type==='play_done'){
      const value=pending.get(message.id);if(value){pending.delete(message.id);message.status==='error'?value.reject(Error('语音播放失败')):value.resolve();}
    }
  }
  function launch(){
    if(closed||worker)return;
    worker=spawn('python',['-u',path.join(root,'audio-worker.py')],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONIOENCODING:'utf-8'}});
    const current=worker;
    current.stdin.on('error',()=>{});
    readline.createInterface({input:current.stdout}).on('line',line=>{try{handle(JSON.parse(line));}catch{}});
    current.on('error',()=>{lastError='后台音频服务无法启动';phase='出错：'+lastError;});
    current.on('exit',()=>{
      if(worker!==current)return;worker=null;started=false;controller?.close();controller=null;
      for(const p of pending.values())p.reject(Error('音频服务已退出'));pending.clear();
      if(!closed){lastError='后台音频服务已退出，正在重试';phase='出错：'+lastError;
        retryTimer=setTimeout(()=>{retryTimer=null;launch();if(callState==='active'&&!paused)setCallState('active');},5000);retryTimer.unref();}
    });
    current.stderr.on('data',()=>{});
  }
  function stop(){if(controller){controller.close();controller=null;}interrupt();send({type:'stop'});started=false;}
  function setCallState(next){
    if(closed)return;
    if(next!=='active'){
      if(callState==='active'||started)stop();
      if(next==='idle')paused=false;
      callState=next;phase=!worker&&lastError?'出错：'+lastError:next==='ringing'?'QQ 来电，正在接听':next==='unknown'?'通话状态不可用，已停止监听':'等待 QQ 语音通话';return;
    }
    callState=next;
    if(!paused&&!started&&worker){lastError='';controller=createController();started=true;phase='正在准备音频…';send({type:'start'});}
  }
  function control(action,values={}){
    if(action==='stop'){paused=true;stop();phase='已停止监听';return;}
    if(action==='start'){if(started&&!paused)return;paused=false;started=false;setCallState(callState);return;}
    if(action==='interrupt'){controller?.interrupt();interrupt();return;}
    if(action==='devices'){send({type:'devices'});return;}
    if(action==='configure'){
      if(started)throw Error('请在通话结束后修改音频设备');
      const input=String(values.input||devices.input),output=String(values.output||devices.output),threshold=Number(values.threshold);
      if(!devices.inputs.includes(input)||!devices.outputs.includes(output)||!Number.isFinite(threshold)||threshold<.005||threshold>.12)throw Error('音频设备或阈值无效');
      fs.writeFileSync(settingsFile,JSON.stringify({input,output,threshold},null,2));
      devices={...devices,input,output,threshold};send({type:'configure',input,output,threshold});return;
    }
    throw Error('未知操作');
  }
  function status(){return {callState,paused,started,phase,error:lastError,devices,log};}
  function close(){closed=true;if(retryTimer)clearTimeout(retryTimer);stop();worker?.stdin.end();worker?.kill();worker=null;}
  launch();return {setCallState,control,status,close};
}

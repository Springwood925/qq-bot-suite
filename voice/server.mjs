import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile,spawn } from 'node:child_process';
import readline from 'node:readline';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import {createDshDialogue} from './dsh-dialogue.mjs';
import {recallCallMemory,recentGroupContext} from './memory-context.mjs';
import {transcribeLocal} from './local-asr.mjs';
import {createBackgroundAudio} from './background-audio.mjs';


const root=import.meta.dirname, bridge=path.resolve(process.env.QQ_BRIDGE_DIR || path.join(root,'..','bridge')), cfg=JSON.parse(fs.readFileSync(path.join(bridge,'config.json'),'utf8'));
const {discoverRunningDshUrl}=await import(pathToFileURL(path.join(bridge,'src','dsh-client.js')).href);
const {synthesizeToFile}=await import(pathToFileURL(bridge+'/src/tts-minimax.js'));
const token=process.env.CALL_LOCAL_TOKEN||crypto.randomBytes(32).toString('hex'),exec=promisify(execFile),voiceCache=path.join(root,'voice-cache');
const whisper=cfg.whisper,ffmpeg=process.env.MC_FFMPEG || 'ffmpeg';
// 通话单独使用较强的本地识别模型，不改动 QQ 机器人自身的 Whisper 配置。
const callWhisperModel=process.env.CALL_WHISPER_MODEL || whisper?.model;
const ds=cfg.tts?.minimax||cfg.tts?.dashscope||{},ttsKey=cfg.tts?.minimax?.apiKey||cfg.tts?.dashscope?.apiKey||cfg.qwen?.apiKey||'';
const persona=()=>fs.readFileSync(bridge+'/我的提示词.md','utf8').replace(/<!--[\s\S]*?-->/g,'').split('## 情绪、兴趣和连续性')[0] + '\n【通话中的连续性】结合已提供的真实经历与当前心情自然接话；没有依据时不编造经历。';
const dialogue=createDshDialogue({root,config:cfg,persona});
let callState='unknown',callStateAt=0;
const observedCallState=()=>Date.now()-callStateAt<3000?callState:'unknown';
const audio=createBackgroundAudio({root,
 transcribe:(input,signal)=>transcribeAudio(input,signal),
 respond:(text,signal)=>replyToCall(text,signal),
 synthesize:(text,signal)=>synthesizeVoice(text,signal),
 decode:async(file,signal)=>(await exec(ffmpeg,['-nostdin','-hide_banner','-loglevel','error','-i',file,'-f','s16le','-ar','48000','-ac','2','pipe:1'],{encoding:'buffer',timeout:45000,windowsHide:true,maxBuffer:16*1024*1024,signal})).stdout
});
const callWatch=spawn('python',[path.join(root,'callwatch.py')],{windowsHide:true,stdio:['ignore','pipe','pipe']});
readline.createInterface({input:callWatch.stdout}).on('line',line=>{try{const v=JSON.parse(line);callState=['idle','ringing','active','unknown'].includes(v.state)?v.state:'unknown';callStateAt=Date.now();}catch{callState='unknown';}audio.setCallState(observedCallState());});
callWatch.on('error',()=>{callState='unknown';audio.setCallState('unknown');});callWatch.on('exit',()=>{callState='unknown';audio.setCallState('unknown');});
const audioWatchdog=setInterval(()=>audio.setCallState(observedCallState()),1000);audioWatchdog.unref();
process.on('exit',()=>{audio.close();callWatch.kill();});
function response(res,status,value,type='application/json'){res.writeHead(status,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(type==='application/json'?JSON.stringify(value):value);}
async function body(req,max=5*1024*1024){let chunks=[],size=0;for await(const c of req){size+=c.length;if(size>max)throw Error('输入音频过大');chunks.push(c);}return Buffer.concat(chunks);}
async function mcState(){try{const r=await fetch('http://127.0.0.1:63200/status',{signal:AbortSignal.timeout(1000)});if(!r.ok)return null;const v=await r.json();return {online:true,position:v.pos,health:v.health,food:v.food,dimension:v.dimension,mode:v.mode,following:v.following,players:v.players,companionActivity:v.companionActivity||null,autonomy:v.auto?{enabled:v.auto.enabled,lastAction:v.auto.lastAction}:null};}catch{return null;}}
async function globalStyle(){
 const token=cfg.consoleToken||fs.readFileSync(bridge+'/state/console-token','utf8').trim();
 const endpoint=`http://127.0.0.1:${cfg.consolePort||3100}/api/self-learning`,key='private:'+cfg.ownerQQ;
 const call=async action=>{const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json','x-console-token':token},body:JSON.stringify({key,action,...action==='growth_list'?{status:'active',limit:20}: {}}),signal:AbortSignal.timeout(5000)});const v=await r.json();if(!r.ok||v.ok===false)throw Error('读取全局成长失败');return v;};
 const diag=await call('diagnostics');if(!diag.configuredEnabled||!diag.globalGrowth?.enabled)return [];
 const data=await call('growth_list'),out=[];let used=0;
 for(const item of data.entries||[]){if(item.status!=='active'||item.kind!=='style')continue;const content=String(item.content||'');if(used+content.length>(diag.globalGrowth.injectBudget||480))continue;out.push(content);used+=content.length;if(out.length>=(diag.globalGrowth.maxItems||3))break;}
 return out;
}
async function transcribeAudio(input,signal){
 const tmp=fs.mkdtempSync(path.join(root,'audio-')),src=path.join(tmp,'input.webm'),wav=path.join(tmp,'input.wav');
 try{fs.writeFileSync(src,input);await exec(ffmpeg,['-nostdin','-hide_banner','-loglevel','error','-i',src,'-ar','16000','-ac','1','-c:a','pcm_s16le',wav],{timeout:30000,windowsHide:true,signal});
  return await transcribeLocal({wav,whisper,model:callWhisperModel,run:exec,signal});
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
}
async function replyToCall(text,signal){
 const memoryToken=cfg.consoleToken||fs.readFileSync(bridge+'/state/console-token','utf8').trim();
 const [mc,globalStyles,memories,groupContext]=await Promise.all([mcState(),globalStyle(),recallCallMemory({config:cfg,token:memoryToken,text,signal}),recentGroupContext({config:cfg,token:memoryToken,text,signal})]);
 return dialogue.reply(text,{游戏:mc,全局表达参考:globalStyles,相关记忆:memories,群聊上下文:groupContext},signal);
}
async function synthesizeVoice(text,signal){
 const result=await synthesizeToFile({apiKey:ttsKey,baseUrl:ds.baseUrl||'https://api.minimaxi.com',model:ds.model||'speech-02-turbo',voice:ds.voice||'female-shaonv',text,format:'wav',sampleRate:Number(ds.sampleRate)||32000,speed:Number(ds.speed)||1,cacheDir:voiceCache,timeoutMs:60000});
 if(signal?.aborted)throw new DOMException('通话已结束','AbortError');return result.file;
}
const server=http.createServer(async(req,res)=>{
 const u=new URL(req.url,'http://127.0.0.1');
 if(req.method==='GET'&&u.pathname==='/'){return response(res,200,fs.readFileSync(root+'/index.html'),'text/html; charset=utf-8');}
 if(req.method==='GET'&&u.pathname==='/panel-bootstrap'){
  const origin=String(req.headers.origin||''),dsh=discoverRunningDshUrl();
  if(origin!=='dsh-app://app'&&(!dsh||origin!==dsh))return response(res,403,{error:'仅限本机 DSH 面板'});
  res.setHeader('access-control-allow-origin',origin);res.setHeader('vary','Origin');
  return response(res,200,{ok:true,state:observedCallState(),url:`http://127.0.0.1:${server.address().port}/#${token}`});
 }
 const dshOrigin=req.headers.origin==='dsh-app://app';
 if(dshOrigin){res.setHeader('access-control-allow-origin','dsh-app://app');res.setHeader('vary','Origin');}
 if(req.method==='OPTIONS'){
  if(!dshOrigin)return response(res,403,{error:'未授权的来源'});
  res.setHeader('access-control-allow-methods','GET, POST, OPTIONS');
  res.setHeader('access-control-allow-headers','content-type, x-call-token');
  res.writeHead(204,{'cache-control':'no-store'});return res.end();
 }
 const expectedOrigin=`http://127.0.0.1:${server.address().port}`;
 const trustedOrigin=dshOrigin||req.headers.origin===expectedOrigin||(req.method==='GET'&&!req.headers.origin&&req.headers['sec-fetch-site']==='same-origin');
 if(req.headers['x-call-token']!==token||!trustedOrigin)return response(res,403,{error:'未授权的本地请求'});
 const clientAbort=new AbortController();res.on('close',()=>{if(!res.writableEnded)clientAbort.abort();});
 try{
  if(req.method==='GET'&&u.pathname==='/status')return response(res,200,{whisper:!!(whisper?.enabled&&fs.existsSync(whisper.cli)&&callWhisperModel&&fs.existsSync(callWhisperModel)),chat:!!discoverRunningDshUrl(),tts:!!ttsKey,mc:await mcState()});
  // 停止旧网页的浏览器采集，避免与后台服务重复收音和回复。
  if(req.method==='GET'&&u.pathname==='/call-state')return response(res,200,{state:'unknown',actualState:observedCallState()});
  if(req.method==='GET'&&u.pathname==='/audio-state')return response(res,200,audio.status());
  if(req.method==='POST'&&u.pathname==='/audio-control'){
   const v=JSON.parse((await body(req,10000)).toString());audio.control(String(v.action||''),v);return response(res,200,{ok:true,...audio.status()});
  }
  if(req.method==='POST'&&u.pathname==='/transcribe'){
   const input=await body(req);const text=await transcribeAudio(input,clientAbort.signal);return response(res,200,{text});
  }
  if(req.method==='POST'&&u.pathname==='/reply'){
   const v=JSON.parse((await body(req,100000)).toString()),text=String(v.text||'').trim().slice(0,500);if(!text)throw Error('对话内容为空');
   const result=await replyToCall(text,clientAbort.signal);return response(res,200,{text:result});
  }
  if(req.method==='POST'&&u.pathname==='/speak'){
   const v=JSON.parse((await body(req,10000)).toString()),text=String(v.text||'').trim().slice(0,300);if(!text)throw Error('没有可朗读的内容');
   const file=await synthesizeVoice(text,clientAbort.signal);
   return response(res,200,fs.readFileSync(file),'audio/wav');
  }
  response(res,404,{error:'未知接口'});
 }catch(e){response(res,500,{error:String(e.message||e)});}
});
server.listen(Number(process.env.CALL_LOCAL_PORT)||59281,'127.0.0.1',()=>{const port=server.address().port;console.log(`通话控制台：http://127.0.0.1:${port}/#${token}`);});

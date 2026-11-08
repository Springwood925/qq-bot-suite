import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const readJson=async (path,read=readFile)=>{try{return JSON.parse((await read(path,'utf8')).replace(/^\uFEFF/,''))}catch{return null}};
const cleanText=(x,max=600)=>typeof x==='string'?x.slice(0,max):'';
const point=p=>p&&['x','y','z'].every(k=>Number.isFinite(p[k]))?{x:p.x,y:p.y,z:p.z}:null;
const item=i=>i&&typeof i.name==='string'?{name:i.name,displayName:cleanText(i.displayName,80)||i.name,count:Number(i.count)||0,metadata:Number(i.metadata)||0}:null;
export async function readMcProject({bridgeDir,fetcher=fetch,read=readFile}={}) {
 const [config,plan,home,mode]=await Promise.all(['config.json','state/mc-play-plan.json','state/mc-home-context.json','state/mc-self-play.json'].map(p=>readJson(join(bridgeDir,p),read)));
 const rawPort=Number(config?.minecraft?.port),port=Number.isInteger(rawPort)&&rawPort>0&&rawPort<=65535?rawPort:63200;
 const local=async (path,init={})=>{try{const r=await fetcher(`http://127.0.0.1:${port}${path}`,{...init,signal:AbortSignal.timeout(4000)});return await r.json()}catch{return null}};
 const [status,inventory]=await Promise.all([local('/api/mc/status'),local('/api/mc/inventory',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})]);
 const connected=!!(status?.ok&&point(status.pos));
 const equipment=inventory?.equipment?.available?Object.fromEntries(['head','torso','legs','feet'].map(k=>[k,item(inventory.equipment[k])])):null;
 return {ok:true,at:Date.now(),connected,serviceReachable:!!status,savedManual:typeof mode?.manual==='boolean'?mode.manual:null,
  status:connected?{pos:point(status.pos),health:status.health??null,food:status.food??null,dimension:cleanText(status.dimension,60),inWater:!!status.inWater,selfPlay:typeof status.selfPlay?.enabled==='boolean'?status.selfPlay.enabled:null,heldItem:item(status.heldItem),equipment}:null,
  inventory:connected&&Array.isArray(inventory?.items)?inventory.items.slice(0,100).map(item).filter(Boolean):null,
  plan:plan?{longTerm:cleanText(plan.longTerm),goal:cleanText(plan.goal),progress:cleanText(plan.progress),next:cleanText(plan.next),outcome:cleanText(plan.outcome),completion:cleanText(plan.completion),updatedAt:Number(plan.updatedAt)||null}:null,
  home:home?{world:cleanText(home.world,80),home:point(home.home),house:point(home.houseOrigin),mineEntrance:point(home.mineEntrance),mineRoute:Array.isArray(home.mineRoute)?home.mineRoute.slice(0,12).map(x=>({...point(x),note:cleanText(x.note,100)})).filter(x=>Number.isFinite(x.x)):[]}:null};
}

// Pause both planning and any outstanding path; never resume on malformed input.
export async function setMcPlaying({on,bridge,fetcher=fetch,port=63200}={}) {
 if(typeof on!=='boolean')return {ok:false,error:'需要明确指定自主游玩开关'};
 const result=await bridge(on);
 if(!result?.ok)return {ok:false,error:result?.error||'自主规划开关未确认'};
 if(!on){try{const r=await fetcher(`http://127.0.0.1:${port}/api/mc/stop`,{method:'POST',headers:{'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(4000)});const value=await r.json();if(!r.ok||!value?.ok)throw Error('stop not confirmed');}catch{return {ok:false,paused:true,error:'自主规划已暂停，但当前移动停止未确认'};}}
 return {ok:true,enabled:on};
}

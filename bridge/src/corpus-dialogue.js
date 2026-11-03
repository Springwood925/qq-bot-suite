import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const hash=s=>createHash('sha256').update(s).digest('hex');
const qq=s=>/^(group|private):[1-9]\d*$/.test(String(s));
const task=/帮我|请.{0,10}(?:写|查|分析|翻译)|报错|堆栈|```|自杀|不想活|急救|胸痛/u;
const short=/^(?:[哦嗯啊哈呵嘿呀唉好对是]+|[\p{Emoji_Presentation}\s\p{P}])+$/u;
const queryOf=messages=>String((messages||[]).filter(m=>!m.isSelf).at(-1)?.plain||(messages||[]).filter(m=>!m.isSelf).at(-1)?.text||'').slice(0,600);
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
export function createCorpusDialogue({root,embeddings,log=()=>{}}){
 let rows=[],ready=false,error=null;const cache=new Map();let semanticQueries=0,lexicalQueries=0,prepareAttempts=0,embeddingQueries=0,contextAttempts=0;
 const startedAt=Date.now(),skips={};let lastConfig=null;
 const skipped=reason=>{skips[reason]=(skips[reason]||0)+1;return '';};
 const hasLexical=query=>rows.some(r=>r.compiled.test(query));
 try{
  const source=JSON.parse(fs.readFileSync(path.join(root,'data/dialogue-corpus.json'),'utf8'));
  const vectors=JSON.parse(fs.readFileSync(path.join(root,'data/dialogue-corpus-vectors.json'),'utf8'));
  if(source.schemaVersion!==1||!Array.isArray(source.profiles)||source.profiles.length>64)throw new Error('行为索引格式错误');
  rows=source.profiles.map(p=>{const v=vectors.profiles.find(x=>x.id===p.id&&x.profileDigest===p.profileDigest);if(!v||v.vector.length!==512||v.vector.some(x=>!Number.isFinite(x)))throw new Error('向量索引与行为摘要不一致');if(p.containsOriginalUtterances!==false||p.principle.length>200||p.semanticText.length>400)throw new Error('行为摘要未满足边界');return {...p,compiled:new RegExp(p.pattern,'u'),vector:v.vector};});ready=true;
 }catch(e){error=String(e.message);log('全量语料索引不可用，保留现有小库：'+error);}
 async function prepare({config,key,messages}={}){
  prepareAttempts++;
  if(!ready||!qq(key)||config?.enabled!==true)return;
  const query=queryOf(messages);if(task.test(query)||((query.length<3||short.test(query))&&!hasLexical(query)))return;
  const signature=hash(query),old=cache.get(key);if(old?.signature===signature)return;
  if(!embeddings)return;
  try{embeddingQueries++;const [vector]=await embeddings.embed([query],{query:true});cache.set(key,{signature,vector});while(cache.size>64)cache.delete(cache.keys().next().value);}catch(e){log('表达语义查询保留关键词：'+String(e.message).slice(0,80));}
 }
 function context({config,key,messages,recent=[]}={}){
  contextAttempts++;lastConfig=config;
  if(!ready||!qq(key)||config?.enabled!==true)return skipped('disabled-or-unavailable');
  const query=queryOf(messages);if(task.test(query))return skipped('task');
  if((query.length<3||short.test(query))&&!hasLexical(query))return skipped('short-without-intent');
  const cached=cache.get(key);const vector=cached?.signature===hash(query)?cached.vector:null;
  const ranked=rows.map(r=>({row:r,lexical:r.compiled.test(query),score:vector?dot(vector,r.vector):0})).sort((a,b)=>Number(b.lexical)-Number(a.lexical)||b.score-a.score||a.row.id.localeCompare(b.row.id));
  // Positive intent cue or a clear semantic margin; no random example rotation.
  let top=ranked[0];const farewell=ranked.find(x=>x.row.id==='farewell'&&x.lexical);if(farewell)top=farewell;
  if(!top.lexical&&(!vector||top.score<(config.minScore??0.55)||top.score-(ranked[1]?.score||0)<(config.minMargin??0.045)))return skipped(vector?'low-confidence':'vector-not-ready');
  const block='【语料表达观察，仅作低优先级参考】\n'+JSON.stringify({行为:top.row.title,取舍:top.row.principle})+'\n这是对本地语料的行为归纳，不是对方的事实或你的经历；当前人格、实际话意和明确请求优先。不必模仿句型，不要求发言。\n';
  if(block.length>Math.min(600,config.maxChars||450))return skipped('budget');
  if(top.lexical)lexicalQueries++;else semanticQueries++;
  return block;
 }
 return {prepare,context,noteSkip:reason=>skipped(reason),diagnostics:({config=lastConfig}={})=>({ready,error,profiles:rows.length,semanticQueries,lexicalQueries,prepareAttempts,embeddingQueries,contextAttempts,skips:{...skips},startedAt,countersResetOnRestart:true,counterMeaning:'命中计数表示选入参考，包含管理端预览；不是检索尝试或真实回复质量评分',minScore:config?.minScore??0.55,minMargin:config?.minMargin??0.045,sourceCandidates:10718,originalDialogueInjected:false})};
}

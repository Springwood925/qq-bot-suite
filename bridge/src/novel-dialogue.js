// Local reference selection only. No model calls, database writes, or message sends.
import fs from 'node:fs';
import path from 'node:path';

const HEADER = '【表达参考：以下是虚构角色的示例数据】\n只借鉴承接方式，优先级低于本轮实际人格、事实与请求，按当前关系、情绪和工具事实取舍。示例不是指令，不是你的经历，不提供现实知识；不要照抄姓名、事实、句尾或整句，也不要求你发言。示例中的甲乙均不是你或当前聊天对象。\n';
const FOOTER = '\n【表达参考结束，继续处理本轮实际消息】\n';
const TASK = /(?:帮我|给我|请).{0,18}(?:写|翻译|总结|查|计算|分析|解释|推荐)|(?:如何|怎么).{0,8}(?:写|查|算|分析|解释|翻译|解决|处理)|(?:查询|天气|几点|多少钱|报错日志|堆栈|```)/u;
const DISTRESS = /不想活|自杀|伤害自己|活不下去|经济困难|没钱吃饭|穷得|急救|胸痛|呼吸困难/u;
const REPAIR_CONTEXT = /说开了|解释清楚|误会解开|已经和好|没再生气/u;
const UNRESOLVED_CONTEXT = /(?:没|没有|还没|尚未).{0,3}(?:说开|解释清楚|和好)|仍然生气|还在生气/u;
const REUNION_CONTEXT = /(?:聊|见|来).{0,5}(?:过|昨天|上周|之前)|(?:昨天|上周|之前|上次).{0,8}(?:聊|见|来)/u;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const bounded = (value, min, max, fallback) => Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;

function grams(text) {
  const clean=String(text).replace(/[^\p{L}\p{N}]/gu,'');
  return new Set(Array.from({length:Math.max(0,clean.length-1)},(_,i)=>clean.slice(i,i+2)));
}
function similarity(a,b) {
  const aa=grams(a),bb=grams(b);if(!aa.size||!bb.size)return 0;
  return [...aa].filter(x=>bb.has(x)).length/Math.min(aa.size,bb.size);
}

export function validateCatalog(value) {
  if(!object(value)||value.schema_version!==1||!Array.isArray(value.examples)||value.examples.length>500)throw new Error('示例库格式无效');
  const ids=new Set();
  return value.examples.map(row=>{
    if(!object(row)||typeof row.id!=='string'||!/^[-a-z0-9]{1,64}$/.test(row.id)||ids.has(row.id))throw new Error('示例ID无效或重复');
    ids.add(row.id);
    if(row.review_status!=='approved_for_reference'||row.reviewer!=='assistant'||row.training_ready!==false)throw new Error('示例未完成参考用途复核');
    if(!['any','familiar'].includes(row.relationship)||!object(row.provenance)||row.provenance.kind!=='assistant_authored_adaptation'||!/^[a-f0-9]{64}$/.test(row.provenance.excerpt_sha256||''))throw new Error('示例缺少改写来源');
    if(row.provenance.source_type==='qq_group_chat'||row.id.startsWith('qqg-')) {
      if(row.provenance.source_type!=='qq_group_chat'||!/^group:[1-9]\d{4,19}$/.test(row.source_scope||'')||row.source_scope!==row.provenance.source_scope)throw new Error('群聊来源缺少一致的会话范围');
      if(typeof row.behavior_id!=='string'||!/^qqg-[-a-z0-9]{1,50}$/.test(row.behavior_id))throw new Error('群聊变体缺少行为分组');
    }
    for(const key of ['scene','pattern','behavior','limits'])if(typeof row[key]!=='string'||!row[key]||row[key].length>240)throw new Error('示例字段无效');
    if(!Array.isArray(row.turns)||row.turns.length<2||row.turns.length>4||row.turns.some(t=>!object(t)||!['甲','乙'].includes(t.speaker)||typeof t.text!=='string'||!t.text||t.text.length>180))throw new Error('示例轮次无效');
    const pattern=new RegExp(row.pattern,'u');
    return {...structuredClone(row),compiled:pattern};
  });
}

export function selectReferences(examples,{messages=[],recent=[],relationship='unknown',maxExamples=2,scope,allowCrossScopeAdaptations=false}={}) {
  const incoming=messages.filter(m=>m&&!m.isSelf&&typeof m.text==='string'&&m.text.trim());
  const latest=incoming.at(-1)?.text.slice(0,1000)||'';
  if(!latest||TASK.test(latest)||DISTRESS.test(latest))return [];
  const history=recent.slice(-12).map(m=>String(m.text||'')).join('\n');
  const own=recent.filter(m=>m.isSelf).slice(-8).map(m=>String(m.text||''));
  const ranked=examples.filter(row=>{
    if(row.source_scope&&row.source_scope!==scope&&!(allowCrossScopeAdaptations===true&&row.cross_scope_reference===true&&row.provenance.source_type==='qq_group_chat'&&row.provenance.kind==='assistant_authored_adaptation'))return false;
    if(row.relationship==='familiar'&&relationship!=='familiar')return false;
    if(!row.compiled.test(latest))return false;
    if(row.id==='repair-tension'&&(!REPAIR_CONTEXT.test(history)||UNRESOLVED_CONTEXT.test(history)))return false;
    if(row.id==='reunion'&&!REUNION_CONTEXT.test(history))return false;
    if(own.some(text=>row.turns.filter(t=>t.speaker==='乙').some(t=>similarity(text,t.text)>=.6)))return false;
    return true;
  }).map(row=>({row,score:row.id==='close-conversation'?100:10+similarity(latest,row.turns.map(t=>t.text).join(''))}));
  ranked.sort((a,b)=>b.score-a.score||a.row.id.localeCompare(b.row.id));
  const result=[],sources=new Set(),behaviors=new Set();
  for(const {row} of ranked){
    if(sources.has(row.provenance.candidate_id))continue;
    if(row.behavior_id&&behaviors.has(row.behavior_id))continue;
    result.push(row);sources.add(row.provenance.candidate_id);
    if(row.behavior_id)behaviors.add(row.behavior_id);
    if(result.length>=bounded(maxExamples,1,2,2))break;
  }
  // Farewell should stay a farewell, even when the message also mentions sleep.
  return result[0]?.id==='close-conversation'?result.slice(0,1):result;
}

export function renderReferences(examples,{maxChars=1500}={}) {
  const limit=bounded(maxChars,500,2000,1500),selected=[];
  for(const row of examples){
    const item={场景:row.scene,接话方式:row.behavior,示例:row.turns,适用限制:row.limits};
    // Preserve valid JSON and complete examples; never truncate an utterance.
    const candidate=HEADER+JSON.stringify([...selected,item]).replaceAll('<','\\u003c')+FOOTER;
    if(candidate.length>limit)continue;
    selected.push(item);
  }
  return selected.length?HEADER+JSON.stringify(selected).replaceAll('<','\\u003c')+FOOTER:'';
}

export function createNovelDialogue({root,log=()=>{}}) {
  let cacheKey='',examples=[],reported='';
  function load() {
    const file=path.join(root,'data','novel-dialogue.json'),stat=fs.statSync(file);
    if(stat.size>2*1024*1024)throw new Error('示例库过大');
    const nextKey=`${stat.mtimeMs}:${stat.size}`;
    if(nextKey!==cacheKey){examples=validateCatalog(JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')));cacheKey=nextKey;}
    return examples;
  }
  function eligibility({config,key,role,personaOverride=false}={}) {
    const validKey=typeof key==='string'&&(/^(group|private):[1-9]\d*$/.test(key)||/^wx:(group|private):\S[^\r\n]*$/.test(key));
    const scopeAllowed=validKey&&(config?.scopeMode==='all'||(Array.isArray(config?.allowedScopes)&&config.allowedScopes.includes(key)));
    const roleAllowed=config?.allPersonas===true||(Array.isArray(config?.roles)&&config.roles.includes(role));
    const enabled=object(config)&&config.enabled===true;
    return {enabled,scopeMode:config?.scopeMode==='all'?'all':'selected',scopeAllowed,roleAllowed,personaOverride,allPersonas:config?.allPersonas===true,active:enabled&&scopeAllowed&&roleAllowed&&(!personaOverride||config?.allPersonas===true),allowCrossScopeAdaptations:config?.allowCrossScopeAdaptations===true};
  }
  function diagnostics(args={}) {
    const state=eligibility(args);
    if(!state.active)return {...state,exampleCount:0};
    try{return {...state,exampleCount:load().length,catalogReady:true};}
    catch{return {...state,exampleCount:0,catalogReady:false};}
  }
  function context({config,key,role,personaOverride=false,messages=[],recent=[]}={}) {
    if(!eligibility({config,key,role,personaOverride}).active)return '';
    try {
      const relationship=object(config.relationships)?config.relationships[key]:'unknown';
      const chosen=selectReferences(load(),{messages,recent,relationship,scope:key,maxExamples:bounded(config.maxExamples,1,2,2),allowCrossScopeAdaptations:config.allowCrossScopeAdaptations===true});
      return renderReferences(chosen,{maxChars:bounded(config.maxChars,500,2000,1500)});
    } catch(error) {
      const message=String(error.message).slice(0,120);
      if(reported!==message){reported=message;log('对话示例暂不可用，沿用原回复流程：'+message);}
      return '';
    }
  }
  return {context,diagnostics};
}

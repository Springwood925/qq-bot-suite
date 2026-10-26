// 二、三期验收：真实本地嵌入、版本/关联/遗忘、管理端隔离；全部使用虚构数据。
import assert from 'node:assert/strict';
import {test,before,after} from 'node:test';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {createMemoryTree} from '../src/memory-tree.js';
import {createLocalEmbeddings} from '../src/memory-embeddings.js';
import {handleMemoryRoute} from '../src/memory-routes.js';
const ROOT=path.resolve(import.meta.dirname,'..'),A='group:11111',B='private:11111',NOW=1800000000000;
const message=(seq,plain='我正在检查模组依赖',userId='11111')=>({seq,plain,userId,sender:'虚构甲',messageId:String(-3000-seq),time:NOW+seq,isSelf:false});
const messages=[message(1),message(2,'我修好了'),message(3,'没必要每句都问'),message(4,'对呀','22222'),message(5,'到这就行'),message(6,'请忘掉这件事')];
const request=(content,extra={})=>({kind:'event',content,factKey:'test:'+content,sourceSeq:1,evidence:'statement',...extra});
let embeddings;
before(async()=>{embeddings=createLocalEmbeddings({runtimeDir:process.env.QQ_MEMORY_RUNTIME||path.join(ROOT,'local-memory-runtime'),modelDir:process.env.QQ_MEMORY_MODEL||path.join(ROOT,'models/bge-small-zh-v1.5')});await embeddings.ready;});
after(async()=>{await embeddings.close();});
function fixture(t,semantic=false,extra={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-memory23-test-')),file=path.join(dir,'memory.sqlite');
  const tree=createMemoryTree({file,now:()=>NOW+100,embeddings:semantic?embeddings:undefined,...extra});
  tree.observe(A,messages);
  t.after(()=>{tree.close();assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(dir).startsWith('qq-memory23-test-'));fs.rmSync(dir,{recursive:true,force:true});});
  return {tree,file};
}
test('自身经历与图片观察不能由机器人手写假冒，真实失败结果不登记',t=>{
  const {tree}=fixture(t);
  for(const kind of ['experience','observation','goal'])assert.throws(()=>tree.store(A,request('我真的出门吃饭了',{kind}),{messages}),/真实工具/);
  assert.equal(tree.recordExperience(A,{tool:'web_search',ok:false,result:'断网'}).skipped,true);
  assert.equal(tree.recordExperience(A,{tool:'qq_send_message',result:'普通发言'}).skipped,true);
  assert.equal(tree.recordExperience(A,{tool:'web_fetch',result:'{"ok":false,"error":"失败"}'}).skipped,true);
  const result=tree.recordExperience(A,{tool:'web_search',callId:'real-test-call',result:'找到一份关于依赖版本的资料'});
  assert.equal(result.record.evidence,'tool');assert.equal(result.record.subjectUserId,'self');
  assert.match(result.record.source.messageRef,/real-test-call/);
  assert.equal(tree.recordExperience(A,{tool:'web_search',callId:'real-test-call',result:'找到一份关于依赖版本的资料'}).duplicate,true);
});
test('图片观察保留原消息引用、文字和不确定性，不据推测确立人物身份',t=>{
  const {tree}=fixture(t);const value={status:'ok',images:[{index:1,description:'蓝色衣服的人物站在门口',visible_text:['下午三点'],uncertain:['无法确认人物身份']}],answer:'文字是下午三点'};
  const record=tree.recordObservation(A,{messageId:'-88',vision:value,images:[{data:'virtual-image'}]}).record;
  assert.equal(record.kind,'observation');assert.equal(record.metadata.messageRef,'-88');assert.deepEqual(record.uncertain,['无法确认人物身份']);
  assert.deepEqual(tree.recall(A,{id:record.id})[0].metadata.visibleText,['下午三点']);
  assert.equal(tree.recall(A,{q:'下午三点'})[0].id,record.id);
  assert.equal(tree.recordObservation(A,{messageId:'-88',vision:{status:'failed'}}).skipped,true);
  assert.equal(tree.recall(B,{q:'下午三点'}).length,0);
});
test('目标状态保持版本与下一步，完成后无待办，遗忘同时清除上游目标状态',async t=>{
  let forgotten=[];const {tree}=fixture(t,false,{onForgetGoals:(scope,ids)=>{assert.equal(scope,A);forgotten=ids;}});
  const goal={id:'g1',title:'核实模组依赖',motivation:'想解决闪退',nextStep:'查看兼容表',status:'active',updatedAt:NOW,expiresAt:NOW+10000};
  const first=tree.syncGoals(A,[goal])[0];assert.equal(first.kind,'goal');assert.equal(first.nextStep,'查看兼容表');
  const done=tree.syncGoals(A,[{...goal,status:'done',updatedAt:NOW+10}])[0];assert.equal(done.previousId,first.id);assert.equal(done.status,'done');assert.equal(done.nextStep,'');
  await assert.rejects(()=>tree.admin(A,{action:'revise',id:done.id,patch:{content:'假进度'}}),/目标请通过/);
  tree.forget(A,done.id);assert.deepEqual(forgotten,['g1']);assert.equal(tree.syncGoals(A,[goal]).length,0);
});
test('表达习惯需多来源，始终先待核实；管理员确认后只影响当前会话',async t=>{
  const {tree}=fixture(t);assert.throws(()=>tree.store(A,request('少写套话',{kind:'style'}),{messages}),/至少需要3条/);
  const value=tree.store(A,request('意思到了就停，没有自然的问题不硬加问句。',{kind:'style',sourceSeqs:[1,3,4],tags:['承接','节奏']}),{messages}).record;
  assert.equal(value.status,'unverified');assert.equal(value.metadata.sampleSources.length,3);
  assert.doesNotMatch(tree.format(A,{messages}),/本会话表达参考/);
  const confirmed=await tree.admin(A,{action:'confirm',id:value.id,reason:'管理员核对虚构样本'});
  assert.equal(confirmed.record.evidence,'admin');assert.match(tree.format(A,{messages}),/本会话表达参考/);
  assert.doesNotMatch(tree.format(B,{messages}),/本会话表达参考/);
  await tree.admin(A,{action:'archive',id:confirmed.record.id});assert.doesNotMatch(tree.format(A,{messages}),/本会话表达参考/);
  const rejected=tree.store(A,request('不要反复换说法补同一个意思。',{kind:'style',factKey:'style.other',sourceSeqs:[1,3,4]}),{messages}).record;
  const archived=await tree.admin(A,{action:'archive',id:rejected.id});assert.equal(archived.record.verified,false);
  assert.ok(!tree.recall(A).some(r=>r.id===archived.record.id));
});
test('普通关联不随来源遗忘被误删，依赖摘要及其版本会一起撤下；关联不得跨群或成环',async t=>{
  const {tree}=fixture(t);const a=tree.store(A,request('事件甲'),{messages}).record;
  const b=tree.store(A,request('事件乙'),{messages}).record;
  const c=tree.store(A,request('派生摘要'),{messages}).record;
  await tree.admin(A,{action:'link',fromId:b.id,toId:a.id,relation:'follows'});
  await tree.admin(A,{action:'link',fromId:c.id,toId:a.id,relation:'supports'});
  await assert.rejects(()=>tree.admin(A,{action:'link',fromId:a.id,toId:c.id,relation:'supports'}),/不能形成环/);
  const other=tree.store(B,request('私聊事项'),{messages}).record;
  await assert.rejects(()=>tree.admin(A,{action:'link',fromId:b.id,toId:other.id,relation:'related'}),/找不到/);
  const updated=tree.store(A,request('事件甲澄清',{factKey:a.factKey,replacesId:a.id,sourceSeq:2}),{messages}).record;
  assert.equal(tree.recall(A,{id:b.id})[0].relations[0].id,updated.id);
  const edited=await tree.admin(A,{action:'revise',id:b.id,patch:{content:'事件乙补充'}});
  tree.forget(A,updated.id);
  assert.equal(tree.recall(A,{id:c.id}).length,0);assert.equal(tree.recall(A,{id:edited.record.id}).length,1);
});
test('本地语义能找回不同措辞，其他会话、失效版本与未核实推断不会混入',async t=>{
  const {tree}=fixture(t,true);
  const crash=tree.store(A,request('装完模组后游戏会闪退，正在检查依赖版本',{factKey:'crash'}),{messages}).record;
  tree.store(A,request('晚饭吃了牛肉面',{factKey:'noodles'}),{messages});
  tree.store(B,request('游戏崩溃需要重新安装驱动',{factKey:'private'}),{messages});
  const fake=tree.store(A,request('游戏退回桌面可能是显卡坏了',{factKey:'guess',evidence:'inference'}),{messages}).record;
  const result=await tree.search(A,{q:'玩一会儿就退回桌面怎么办',limit:5});
  assert.equal(result.method,'hybrid');assert.equal(result.records[0].id,crash.id);assert.ok(!result.records.some(r=>r.id===fake.id));
  assert.ok(result.records.every(r=>r.content!=='游戏崩溃需要重新安装驱动'));
  const wrong=await tree.search(A,{q:'退回桌面',person:'99999'});assert.equal(wrong.records.length,0);
});
test('纠正与遗忘会使旧向量失效；重开后不能由语义索引复活',async t=>{
  const {tree,file}=fixture(t,true);const first=tree.store(A,request('不吃辣',{kind:'fact',factKey:'spice'}),{messages}).record;
  await tree.reindex(A);const next=tree.store(A,request('微辣可以，重辣不行',{kind:'fact',factKey:'spice',sourceSeq:2,replacesId:first.id}),{messages}).record;
  const result=await tree.search(A,{q:'有没有不放辣椒的菜'});assert.ok(!result.records.some(r=>r.id===first.id));
  assert.ok(result.records.some(r=>r.id===next.id));
  await tree.admin(A,{action:'case',q:'吃饭要不要辣',expectedIds:[next.id]});
  tree.forget(A,next.id);assert.equal((await tree.search(A,{q:'清淡口味',includeUnverified:true})).records.length,0);
  const db=new DatabaseSync(file,{readOnly:true});try{assert.equal(db.prepare('SELECT count(*) AS n FROM memory_vectors').get().n,0);assert.equal(db.prepare('SELECT count(*) AS n FROM retrieval_cases').get().n,0);}finally{db.close();}
});
test('准备的自动召回仍复核当前状态，保持长度上限，并排除未审核表达候选',async t=>{
  const {tree}=fixture(t,true);const event=tree.store(A,request('装完模组后游戏会闪退，正在检查依赖版本'),{messages}).record;
  const incoming=[message(7,'玩一会儿就退回桌面怎么办')];await tree.prepare(A,incoming);assert.match(tree.format(A,{messages:incoming}),/模组/);
  tree.forget(A,event.id);assert.doesNotMatch(tree.format(A,{messages:incoming}),/正在检查依赖/);
  const formatted=tree.format(A,{messages:incoming});assert.ok([...formatted].reduce((n,c)=>n+(c.codePointAt(0)>127?2:.4),0)<1000);
});
test('管理界面可以分人、分页、看来源和历史并修正，无来源旧记录不会自动转正',async t=>{
  const {tree}=fixture(t);tree.migrate(A,{recentMessages:messages,activeTopics:[{text:'旧话题'}],memberImpressions:{}});
  let list=await tree.admin(A,{action:'list',status:'unverified'});assert.equal(list.total,1);
  const id=list.records[0].id;const read=await tree.admin(A,{action:'read',id});assert.equal(read.record.source,null);
  const next=await tree.admin(A,{action:'revise',id,patch:{content:'核实后的话题',confirmed:true,reason:'管理员核实'}});
  assert.equal(next.record.status,'active');assert.equal(next.record.evidence,'admin');
  const detail=await tree.admin(A,{action:'read',id:next.record.id});assert.equal(detail.versions.length,2);assert.equal(detail.reviews[0].action,'revise');
  list=await tree.admin(A,{action:'list',limit:1,offset:0});assert.equal(list.records.length,1);assert.equal(list.total,1);
});
test('管理端点拒绝 agent 令牌；旧 JSON 入口也拒绝伪造管理 action',async t=>{
  const {tree}=fixture(t);const state={memoryScope:A,recentMessages:messages};
  const run=async(token,body)=>{let response;await handleMemoryRoute({req:{method:'POST',headers:token===undefined?{}:{'x-agent-token':token}},url:new URL('http://localhost/api/socialV2/memory-admin'),readBody:async()=>body,sendJson:(data,status=200)=>{response={data,status};},tree,getState:()=>state,tokenOk:()=>true,sessionAllowed:()=>true,toolEnabled:()=>true});return response;};
  assert.equal((await run('agent',{action:'overview'})).status,403);assert.equal((await run('',{action:'overview'})).status,403);
  assert.equal((await run(undefined,{action:'overview'})).status,200);
  assert.throws(()=>tree.legacyAppend(A,'activeTopic',JSON.stringify({_memoryTree:1,action:'settings',settings:{semantic:false}}),{},{messages}),/只支持/);
});
test('语义功能关闭或本地模型不可用时保留关键词，不转向网络服务',async t=>{
  const {tree}=fixture(t,true);tree.store(A,request('正在修模组闪退'),{messages});await tree.admin('',{action:'settings',settings:{semantic:false}});
  const result=await tree.search(A,{q:'模组'});assert.equal(result.method,'keyword');assert.equal(result.records.length,1);
  assert.equal(embeddings.status().state,'ready');
});
test('检索诊断样例只在当前会话运行，统计有实际样例数，不伪造成功率',async t=>{
  const {tree}=fixture(t,true);assert.equal((await tree.admin(A,{action:'evaluate'})).hitAt5,null);
  const row=tree.store(A,request('装完模组后游戏会闪退，正在检查依赖版本'),{messages}).record;
  await tree.admin(A,{action:'case',q:'玩一会儿就退回桌面怎么办',expectedIds:[row.id]});
  const result=await tree.admin(A,{action:'evaluate'});assert.equal(result.hitAt5,1);assert.equal(result.cases.length,1);
  assert.equal((await tree.admin(B,{action:'evaluate'})).cases.length,0);
});

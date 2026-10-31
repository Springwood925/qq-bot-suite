// 虚构数据：跨会话、换轮、纠错、遗忘、预算、异步检索和原文留存。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createMemoryTree} from '../src/memory-tree.js';
import {checkConsoleMemoryAccess} from '../src/console-memory-access.js';
const NOW=1800000000000,A='group:12345',B='private:12345';
const msg=(seq,plain='正在修模组闪退')=>({seq,userId:'12345',sender:'甲',plain,time:NOW+seq,messageId:'-'+seq});
const cost=s=>[...s].reduce((n,c)=>n+(c.codePointAt(0)>127?2:.4),0);
function fixture(t,extra={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'memory-continuity-')),file=path.join(dir,'tree.sqlite');let at=NOW+100;
  const tree=createMemoryTree({file,now:()=>at,...extra});
  t.after(()=>{tree.close();const resolved=path.resolve(dir);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('memory-continuity-'));fs.rmSync(resolved,{recursive:true,force:true});});
  const store=(content='正在修模组闪退',patch={},message=msg(1))=>tree.store(A,{kind:'event',sourceSeq:message.seq,factKey:'mod',content,nextStep:'检查依赖版本',...patch},{messages:[message]}).record;
  return {tree,file,store,tick:v=>at=v};
}
test('跨轮交接直接给出进展和下一步，并按引用追随纠错，已完成事项不再交接',async t=>{
  const {tree,store}=fixture(t);const first=store();tree.handoff(A,'old');
  const incoming=[msg(2,'终于找到原因了')];
  assert.match(tree.format(A,{messages:incoming}),/上次交接.*正在修模组闪退.*检查依赖版本/);
  const next=store('确认是依赖版本不匹配',{replacesId:first.id,nextStep:'升级依赖'},msg(3));
  const prompt=tree.format(A,{messages:incoming});assert.match(prompt,/上次交接.*确认是依赖版本不匹配.*升级依赖/);assert.doesNotMatch(prompt,/正在修模组闪退/);
  const done=await tree.admin(A,{action:'done',id:next.id});
  const view=await tree.admin(A,{action:'diagnostics'});assert.equal(view.handoff.records.length,0);
  assert.doesNotMatch(tree.format(A,{messages:incoming}),/上次交接/);assert.equal(done.record.status,'done');
});
test('交接不把转述、冲突、过期事项或旧版目标当当前事实',async t=>{
  const {tree,store,tick}=fixture(t);store('听说已经修好',{factKey:'rumor',evidence:'reported'});
  const a=store('正在修依赖',{factKey:'a'}),b=store('没有修依赖',{factKey:'b'});
  await tree.admin(A,{action:'link',fromId:a.id,toId:b.id,relation:'contradicts'});
  tree.handoff(A,'old',[{id:'g',title:'查模组文档',nextStep:'核对版本',status:'active',updatedAt:NOW,expiresAt:NOW+1000}]);
  assert.equal((await tree.admin(A,{action:'diagnostics'})).handoff.records.length,1);
  tick(NOW+1001);assert.equal((await tree.admin(A,{action:'diagnostics'})).handoff.records.length,0);
});
test('交接、表达参考和回忆提示合并受同一预算限制，诊断说明淘汰原因且无落盘写入',async t=>{
  const {tree,store,file}=fixture(t);for(let i=0;i<15;i++)store(('模组事件'+i+'的详细经历').repeat(25),{factKey:'e'+i});
  const style=tree.store(A,{kind:'style',content:'避免无谓追问',sourceSeq:1,sourceSeqs:[1,2,3],factKey:'style'},{messages:[msg(1),msg(2),msg(3)]}).record;
  await tree.admin(A,{action:'confirm',id:style.id});
  tree.handoff(A,'old');const db=new DatabaseSync(file);db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
  const prompt=tree.format(A,{messages:[msg(2,'还记得模组吗')]}),diag=await tree.admin(A,{action:'diagnostics'});
  assert.match(prompt,/本会话表达参考/);assert.ok(cost(prompt.slice(prompt.indexOf('【记忆树】')))<=900);assert.ok(diag.trace.usedTokens<=diag.trace.budget);assert.ok(diag.trace.candidates.some(n=>n.excluded==='budget'));
  assert.equal(fs.statSync(file+'-wal').size,0);db.close();
});
test('重开后交接仍从有效记录恢复；遗忘清除交接、原文和诊断，禁止原来源重提取',async t=>{
  const {tree,store,file}=fixture(t);const n=store();tree.handoff(A,'old');tree.format(A,{messages:[msg(1)]});
  const reopened=createMemoryTree({file,now:()=>NOW+200});
  try{
    assert.match(reopened.format(A,{messages:[msg(2,'继续')]}),/上次交接/);
    reopened.forget(A,n.id);assert.equal(reopened.execute(A,{action:'evidence',id:n.id}).forgotten,true);
    assert.equal((await reopened.admin(A,{action:'diagnostics'})).trace,null);
    assert.doesNotMatch(reopened.format(A,{messages:[msg(2,'继续')]}),/正在修模组闪退/);
    assert.throws(()=>reopened.store(A,{kind:'event',sourceSeq:1,content:'重新记住它',factKey:'again'},{messages:[msg(1)]}),/遗忘/);
    const db=new DatabaseSync(file,{readOnly:true});assert.equal(db.prepare('SELECT count(*) n FROM memory_source_text').get().n,0);db.close();
  }finally{reopened.close();}
});
test('原文留存保留段落，按码点分页、限长，明确标示旧记录只有摘录',t=>{
  const {tree,store,file}=fixture(t);const original='原话第一段\n'+('细节🐳'.repeat(900))+'\n结尾';const n=store('修模组事件',{},msg(1,original));
  const part=tree.execute(A,{action:'evidence',id:n.id});assert.equal(part.records[0].source.completeOriginal,true);assert.match(part.records[0].source.text,/原话第一段\n/);
  const next=tree.execute(A,{action:'evidence',id:n.id,offset:part.records[0].source.nextOffset});assert.equal(part.records[0].source.text+next.records[0].source.text,original);
  assert.throws(()=>tree.execute(A,{action:'evidence',id:n.id,offset:-1}),/offset/);
  const db=new DatabaseSync(file);db.exec('DELETE FROM memory_source_text');db.close();
  const legacy=tree.execute(A,{action:'evidence',id:n.id}).records[0].source;assert.equal(legacy.excerptOnly,true);assert.equal(legacy.completeOriginal,false);
});
test('原文最大留存64000字并标明截断；只记录接纳的来源，sanitize 同样生效',t=>{
  const {tree,store,file}=fixture(t,{sanitize:v=>String(v).replaceAll('secret-value','***')});
  assert.throws(()=>store('伪造来源',{sourceSeq:99}),/真实收到/);
  const n=store('长事件',{},msg(1,'secret-value'+('内容🐳'.repeat(23000))));
  const source=tree.execute(A,{action:'evidence',id:n.id}).records[0].source;
  assert.equal(source.storedTruncated,true);assert.equal(source.completeOriginal,false);assert.equal(source.totalChars,64000);assert.doesNotMatch(source.text,/secret-value/);
  const db=new DatabaseSync(file,{readOnly:true});assert.equal(db.prepare('SELECT count(*) n FROM memory_source_text').get().n,1);db.close();
});
test('原文回查跟随本人纠正，关联仅限本会话，旧协议可调用，不能伪造诊断管理动作',async t=>{
  const {tree,store}=fixture(t);const old=store('旧结论');const next=store('微辣可以',{replacesId:old.id},msg(2,'我更正一下：微辣可以'));
  const related=store('共同事件',{factKey:'shared',relatedIds:[next.id]},msg(3,'一起点餐'));
  const result=tree.legacyAppend(A,'activeTopic',JSON.stringify({_memoryTree:1,action:'evidence',id:old.id}),{},{});
  assert.equal(result.resolvedId,next.id);assert.equal(result.records[0].source.text,'我更正一下：微辣可以');
  assert.equal(tree.execute(A,{action:'evidence',id:related.id,related:true}).records.length,2);
  assert.throws(()=>tree.execute(B,{action:'evidence',id:next.id}),e=>e.statusCode===404);
  assert.equal((await tree.admin(B,{action:'diagnostics'})).handoff.records.length,0);
  assert.throws(()=>tree.execute(A,{action:'diagnostics'}),/只支持/);
  checkConsoleMemoryAccess({method:'GET',headers:{}},'diagnostics');checkConsoleMemoryAccess({method:'GET',headers:{}},'evidence');
  assert.throws(()=>checkConsoleMemoryAccess({method:'GET',headers:{'x-agent-token':'agent'}},'diagnostics'),e=>e.statusCode===403);
});
test('关闭自动注入也关闭交接注入，并留下明确诊断',async t=>{
  const {tree,store}=fixture(t);store();tree.handoff(A,'old');await tree.admin('',{action:'settings',settings:{autoInject:false}});
  assert.doesNotMatch(tree.format(A,{messages:[msg(2)]}),/上次交接/);assert.equal((await tree.admin(A,{action:'diagnostics'})).trace.disabled,true);
});
test('管理员纠正不把旧原话伪装成新结论的依据，历史来源明确标示',async t=>{
  const {tree,store}=fixture(t);const old=store('旧结论',{},msg(1,'当时还没修好'));
  const changed=await tree.admin(A,{action:'revise',id:old.id,patch:{content:'目前已经修好',confirmed:true}});
  const read=tree.execute(A,{action:'evidence',id:old.id});
  assert.equal(read.resolvedId,changed.record.id);assert.equal(read.records[0].record.content,'目前已经修好');
  assert.equal(read.records[0].source.historical,true);assert.equal(read.records[0].source.text,'当时还没修好');
});
test('向量查询等待期间遗忘，结果与准备缓存都不能带回已删除内容',async t=>{
  let entered,release;const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
  const vector=()=>Array.from({length:512},(_,i)=>i===0?1:0);
  const embeddings={status:()=>({model:'fake'}),embed:async(texts,options)=>{if(options?.query){entered();await gate;}return texts.map(vector);}};
  const {tree,store}=fixture(t,{embeddings});const n=store();await tree.reindex(A);
  const pending=tree.search(A,{q:'模组'});await started;tree.forget(A,n.id);release();
  assert.deepEqual((await pending).records,[]);
});

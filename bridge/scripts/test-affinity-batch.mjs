import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createMemoryTree} from '../src/memory-tree.js';
import {explicitAttitude} from '../src/affinity.js';
import {handleMemoryRoute} from '../src/memory-routes.js';
const A='group:11111',B='group:22222',OWNER='123456789',NOW=Date.now(),DAY=86400000;
const msg=(seq,plain='小鲸鱼谢谢你',extra={})=>({seq,plain,userId:'11111',sender:'同名',messageId:'test-'+seq,time:NOW-10000+seq,isSelf:false,...extra});
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'affinity-batch-')),file=path.join(dir,'memory.sqlite');let owner=OWNER;const tree=createMemoryTree({file,now:()=>NOW,ownerQQ:()=>owner});t.after(()=>{tree.close();assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true});});return {tree,file,setOwner:v=>owner=v};}
const affinity=async(tree,scope=A,id='11111')=>(await tree.admin(scope,{action:'affinity'})).people.find(p=>p.userId===id);
function pending(tree,scope=A,seq=1,extra={}){const messages=[msg(seq)];tree.observe(scope,messages);return tree.store(scope,{kind:'fact',content:'小鲸鱼很友好 '+seq,evidence:'inference',factKey:'fact-'+seq,sourceSeq:seq,...extra},{messages}).record;}
test('管理员跨会话和昵称始终100；关闭记忆自动注入仍显示真实身份',async t=>{
  const {tree,setOwner}=fixture(t);tree.observe(A,[msg(1,'小鲸鱼闭嘴',{userId:OWNER}),msg(2,'小鲸鱼谢谢你')]);
  assert.equal((await affinity(tree,A,OWNER)).score,100);assert.equal((await affinity(tree,B,OWNER)).score,100);
  assert.match(tree.format(A,{messages:[msg(1)]}),/123456789 是管理员本人/);
  await tree.admin('',{action:'settings',settings:{autoInject:false}});assert.match(tree.format(B),/固定 100\/100/);
  setOwner('22222');assert.equal((await affinity(tree,A,'22222')).score,100);assert.equal((await affinity(tree,A,OWNER)).isAdmin,false);
});
test('真实定向互动升分；普通群聊旁观、自发言不计；同名QQ独立且会话隔离',async t=>{
  const {tree}=fixture(t);tree.observe(A,[msg(1,'谢谢大家'),msg(2,'谢谢你',{isSelf:true}),msg(3,'谢谢你',{userId:'22222'})]);
  assert.equal((await affinity(tree)).score,50);assert.equal((await affinity(tree,A,'22222')).score,50);
  tree.observe(A,[msg(4,'谢谢你',{directToBot:true})]);assert.ok((await affinity(tree)).score>50);
  assert.equal(await affinity(tree,B),undefined);
});
test('重放、重启、刷屏受限；多天互动增加熟悉度，明确恶意降分',async t=>{
  const {tree,file}=fixture(t);const spam=Array.from({length:100},(_,i)=>msg(i+1));tree.observe(A,spam);const first=await affinity(tree);tree.observe(A,spam);assert.deepEqual(await affinity(tree),first);assert.equal(first.interactions,1);assert.equal(first.positive,1);
  const reopened=createMemoryTree({file,now:()=>NOW,ownerQQ:()=>OWNER});assert.deepEqual(await affinity(reopened),first);reopened.close();
  tree.observe(A,Array.from({length:10},(_,i)=>msg(200+i,'小鲸鱼谢谢你',{time:NOW-(i+1)*DAY})));assert.ok((await affinity(tree)).score>first.score);assert.ok((await affinity(tree)).score<=95);
  tree.observe(B,Array.from({length:10},(_,i)=>msg(400+i,'小鲸鱼你这个废物',{time:NOW-(i+1)*DAY})));assert.ok((await affinity(tree,B)).score<50);
});
test('引用、反问、否定及第三方态度描述不误判',()=>{for(const text of ['他说小鲸鱼是废物','小鲸鱼不是废物','小鲸鱼你真棒？','“小鲸鱼谢谢你”','小鲸鱼我不讨厌你','小鲸鱼，小明是废物','刚才那个人态度恶劣','今天老板很友好','谢谢群主','老师辛苦了'])assert.equal(explicitAttitude(text),0,text);assert.equal(explicitAttitude('小鲸鱼谢谢你，你这个废物'),0);});
test('清空后重放旧聊天不恢复好感度互动记录',async t=>{const {tree}=fixture(t);const messages=[msg(1)];tree.observe(A,messages);assert.ok((await affinity(tree)).interactions>0);tree.clear(A);tree.migrate(A,{recentMessages:messages});assert.equal((await affinity(tree)).interactions,0);});
test('历史记忆只使用有效且有依据的态度；核实换版不重复计分，遗忘会撤销来源互动',async t=>{
  const {tree}=fixture(t);const messages=[msg(1,'小鲸鱼谢谢你',{time:NOW-40*DAY})];tree.observe(A,messages);
  const item=tree.store(A,{kind:'fact',content:'小鲸鱼很友好',factKey:'attitude',sourceSeq:1},{messages}).record;
  assert.equal((await affinity(tree)).memoryEvidence,1);assert.ok((await affinity(tree)).attitudeBonus>0);
  const confirmed=(await tree.admin(A,{action:'confirm',id:item.id})).record;assert.equal((await affinity(tree)).memoryEvidence,1);
  tree.forget(A,confirmed.id);assert.equal((await affinity(tree)).memoryEvidence,0);
  const current=pending(tree,A,2);assert.equal((await affinity(tree)).positive,1);
  const c=(await tree.admin(A,{action:'confirm',id:current.id})).record;assert.equal((await affinity(tree)).positive,1);assert.equal((await affinity(tree)).memoryEvidence,0);
  tree.forget(A,c.id);assert.equal((await affinity(tree)).positive,0);tree.observe(A,[msg(2)]);assert.equal((await affinity(tree)).positive,0);
});
test('转述、旧未核实记忆、已归档和过期记忆不计入态度',async t=>{
  const {tree}=fixture(t);const old=msg(1,'小鲸鱼是废物',{time:NOW-40*DAY});tree.observe(A,[old]);tree.store(A,{kind:'fact',content:'小鲸鱼是废物',sourceSeq:1,evidence:'reported'},{messages:[old]});assert.equal((await affinity(tree)).score,50);
  const fact=tree.store(A,{kind:'fact',content:'小鲸鱼很友好',sourceSeq:1,factKey:'positive',validUntil:NOW-1},{messages:[old]}).record;assert.equal((await affinity(tree)).memoryEvidence,0);
  await tree.admin(A,{action:'archive',id:fact.id});assert.equal((await affinity(tree)).memoryEvidence,0);
});
test('批量确认形成可追溯版本；批量拒绝不进入有效召回',async t=>{
  const {tree}=fixture(t);const records=[pending(tree,A,1),pending(tree,A,2)];const result=await tree.admin(A,{action:'batchReview',decision:'confirm',ids:records.map(r=>r.id)});assert.equal(result.reviewed,2);
  for(const record of result.records){assert.equal(record.verified,true);assert.equal(record.status,'active');assert.ok(records.some(r=>r.id===record.previousId));assert.equal((await tree.admin(A,{action:'read',id:record.id})).reviews.length,1);}
  const rejected=pending(tree,A,3);const r=await tree.admin(A,{action:'batchReview',decision:'reject',ids:[rejected.id]});assert.equal(r.records[0].status,'archived');assert.equal(r.records[0].verified,false);assert.ok(!tree.recall(A).some(item=>item.id===r.records[0].id));
});
test('批量拒绝跨会话、重放、重复ID和过期选择，其他记录保持原状',async t=>{
  const {tree}=fixture(t);const a=pending(tree,A,1),b=pending(tree,B,2);
  for(const ids of [[a.id,b.id],[a.id,a.id],[],[a.id,'missing']])await assert.rejects(tree.admin(A,{action:'batchReview',decision:'confirm',ids}));
  assert.equal(tree.recall(A,{id:a.id})[0].status,'unverified');await tree.admin(A,{action:'confirm',id:a.id});await assert.rejects(tree.admin(A,{action:'batchReview',decision:'confirm',ids:[a.id]}),/已变化/);
});
test('批量审核中途存储失败回滚全部版本、来源状态及审核日志',async t=>{
  const {tree,file}=fixture(t);const a=pending(tree,A,1),b=pending(tree,A,2);const db=new DatabaseSync(file);
  db.exec(`CREATE TRIGGER test_abort BEFORE INSERT ON nodes WHEN NEW.previous_id='${b.id}' BEGIN SELECT RAISE(ABORT,'fixture write failure'); END;`);
  await assert.rejects(tree.admin(A,{action:'batchReview',decision:'confirm',ids:[a.id,b.id]}),/fixture write failure/);
  assert.equal(tree.recall(A,{id:a.id})[0].status,'unverified');assert.equal(db.prepare('SELECT count(*) n FROM nodes').get().n,2);assert.equal(db.prepare('SELECT count(*) n FROM memory_reviews').get().n,0);db.close();
});
test('依赖记录批量核实按来源顺序处理',async t=>{
  const {tree}=fixture(t);const a=pending(tree,A,1),b=pending(tree,A,2);await tree.admin(A,{action:'link',fromId:b.id,toId:a.id,relation:'supports'});
  const result=await tree.admin(A,{action:'batchReview',decision:'confirm',ids:[b.id,a.id]});assert.ok(result.records.every(r=>tree.recall(A,{id:r.id})[0].verified));
});
test('机器人令牌不能访问批量管理接口或好感度管理页',async t=>{
  const {tree}=fixture(t);for(const action of ['batchReview','affinity']){let response;await handleMemoryRoute({req:{method:'POST',headers:{'x-agent-token':'robot'}},url:new URL('http://localhost/api/socialV2/memory-admin'),readBody:async()=>({action,key:A}),sendJson:(body,status)=>response={body,status},tree});assert.equal(response.status,403);}
});

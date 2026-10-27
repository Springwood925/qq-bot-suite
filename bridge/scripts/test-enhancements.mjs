import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import {createMemoryTree} from '../src/memory-tree.js';
import {explicitApology} from '../src/affinity.js';
import {normalizeSlangEntry,upsertSlangEntry,buildSlangContext,buildResearchPrompt} from '../src/slang-learner.js';
const A='group:11111', B='group:22222', now=Date.now(), owner='33333';
function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-enhance-'));const tree=createMemoryTree({file:path.join(dir,'test.sqlite'),now:()=>now,ownerQQ:()=>owner});t.after(()=>{tree.close();fs.rmSync(dir,{recursive:true,force:true})});return tree;}
const msg=(seq,plain,time,more={})=>({seq,plain,text:plain,time,userId:'11111',sender:'甲',messageId:String(seq),directToBot:true,...more});
test('scopes and review control candidate use while preserving legacy entries',()=>{
 const old=normalizeSlangEntry({content:'旧词',meaning:'旧含义',status:'confirmed'}); const es=[old];
 upsertSlangEntry(es,'同词',{scope:A,meaning:'甲义',sourceQuality:'reported'});upsertSlangEntry(es,'同词',{scope:B,meaning:'乙义',sourceQuality:'reported'});
 assert.equal(es.length,3);const a=buildSlangContext(es,8,{scope:A,query:'同词'});assert.match(a,/甲义/);assert.doesNotMatch(a,/乙义/);assert.match(a,/禁止主动使用/);assert.match(a,/旧含义/);
 const b=buildSlangContext(es,8,{scope:B,query:'同词'});assert.match(b,/乙义/);assert.doesNotMatch(b,/甲义/);es[1].status='confirmed';es[1].usagePolicy='natural';assert.match(buildSlangContext(es,8,{scope:A}),/可在合适语境自然使用/);
 assert.doesNotMatch(buildResearchPrompt([{content:'安全词',evidence:[{text:'私人聊天123456'}]}]),/私人聊天123456/);
});
test('apology requires a subsequent positive interaction and does not alter owner or other scope',async t=>{
 const tree=setup(t);const events=[msg(1,'你这个废物',now-1800000),msg(2,'对不起',now-1200000),msg(3,'谢谢你',now-600000)];
 tree.observe(A,events.slice(0,2));const one=(await tree.admin(A,{action:'affinity'})).people.find(x=>x.userId==='11111');assert.equal(one.repairBonus,0);
 tree.observe(A,[events[2]]);const fixed=(await tree.admin(A,{action:'affinity'})).people.find(x=>x.userId==='11111');assert.ok(fixed.repairBonus>0);
 tree.observe(B,[msg(4,'你这个废物',now-500000)]);assert.equal((await tree.admin(B,{action:'affinity'})).people.find(x=>x.userId==='11111').repairBonus,0);
 assert.equal((await tree.admin(A,{action:'affinity'})).people.find(x=>x.userId===owner).score,100);
 for(const s of ['他说对不起','“对不起”','我不想对不起','对不起？'])assert.equal(explicitApology(s),false);
});
test('only confirmed quote plus successful sticker receipt becomes a pending experience',async t=>{
 const tree=setup(t);assert.equal(tree.recordExperience(A,{tool:'qq_shared_sticker',metadata:{replyToMessageId:'123'}}).skipped,true);
 const result=tree.recordExperience(A,{tool:'qq_shared_sticker',metadata:{messageRef:'555',replyToMessageId:'123'}});assert.equal(result.record.status,'unverified');assert.equal(result.record.verified,false);
 assert.equal(tree.recordExperience(A,{tool:'qq_shared_sticker',metadata:{messageRef:'555',replyToMessageId:'123'}}).duplicate,true);
 assert.ok(!tree.format(A).includes('引用一条消息并成功发送了表情'));
});
test('memory questions do not inject question echoes or unresolved conflicts',t=>{
 const tree=setup(t);const messages=[msg(10,'我喜欢红色',now-4000),msg(11,'我喜欢蓝色',now-3000),msg(12,'我喜欢什么？',now-2000)];tree.observe(A,messages);
 const a=tree.store(A,{kind:'fact',factKey:'color1',content:'我喜欢红色',sourceSeq:10},{messages}).record;
 const b=tree.store(A,{kind:'fact',factKey:'color2',content:'我喜欢蓝色',sourceSeq:11},{messages}).record;
 tree.store(A,{kind:'fact',factKey:'question',content:'我喜欢什么？',sourceSeq:12},{messages});
 tree.execute(A,{action:'link',fromId:a.id,toId:b.id,relation:'contradicts',sourceSeq:12},{messages});
 const result=tree.format(A,{messages});assert.doesNotMatch(result,/我喜欢红色|我喜欢蓝色|我喜欢什么？/);assert.match(result,/问题本身不是事实/);
});

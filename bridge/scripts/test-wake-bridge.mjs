// Offline integration harness executes the actual bridge functions and HTTP routes.
// No QQ or live DSH connection is made; only ephemeral loopback test servers are used.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {AsyncLocalStorage} from 'node:async_hooks';
import {once} from 'node:events';
import * as w from '../src/wake-coordinator.js';
import * as failurePolicy from '../src/turn-failure-policy.js';

test('actual wake path preserves unread and defers direct mentions during provider failure cooldown',async()=>{
 const {ctx,st}=harness(['sendWakePromptV2'],{queueOrForceWakeV2:()=>true});
 st.wakeDelivery={version:1,confirmed:[],legacyFloor:0,execution:null,failure:{retryAt:Date.now()+600000}};
 await ctx.sendWakePromptV2(key,'atMention');
 assert.equal(st.wakeDelivery.execution,null);
 assert.equal(st.unread.length,2);
 assert.ok(st.wakeDelivery.nextEligibleAt>Date.now());
});

test('actual wake startup inspects historical 400, schedules one safe rotation and preserves queued work',async()=>{
 const rotate=new Set();
 const {ctx,st}=harness(['sendWakePromptV2'],{queueOrForceWakeV2:()=>true,sessionNeedsRotate:rotate,
  readDshActivityV2:async()=>({status:'idle',asOfSeq:10,terminal:{seq:10,data:{reason:{kind:'error',error:{status:400,code:'INVALID_REQUEST'}}}}})});
 await ctx.sendWakePromptV2(key,'private');
 assert.equal(st.wakeDelivery.execution,null);
 assert.ok(rotate.has('session-test'));
 assert.equal(st.unread.length,2);
 assert.equal(st.pendingWakeReasons.length,1);
 assert.ok(st.wakeDelivery.failure.retryAt>Date.now());
});

const source=fs.readFileSync(new URL('../src/bridge.js',import.meta.url),'utf8');
function fn(name){
 const re=new RegExp(`^  (?:async )?function ${name}\\(`,'m'),start=source.search(re);
 assert.ok(start>=0,`function ${name} exists`);
 const end=source.indexOf('\n  }',start)+4;
 return source.slice(start,end);
}
const key='private:123',token='test-agent-token';
const msg=seq=>({seq,text:'message '+seq,plain:'message '+seq,isSelf:false,time:Date.now()});
function harness(names,overrides={}) {
 const st={agentToken:token,lastHandledSeq:0,lastUnreadSeq:2,unread:[msg(1),msg(2)],recentMessages:[msg(1),msg(2)],wakeTimes:[],sendTimes:[],wakeConfig:{mode:'active',infinite:true,triggers:{}},pendingWakeReasons:[]};
 const base={...w,...failurePolicy,URL,Buffer,console,http,crypto,Date,Promise,AbortSignal,Response,setTimeout,clearTimeout,sendContext:new AsyncLocalStorage(),activeAgentRequests:new Map(),activeAgentSends:new Map(),recoveryChecks:new Map(),
   cfg:{consolePort:0,consoleToken:'test-console-token-123',socialV2:{enabled:true,wake:{maxWakePerMinute:1},wait:{minMs:100,maxMs:1000,minQuietAfterNewMs:0}}},
   currentMode:'reserved2',socialV2:{paused:false,conversations:new Map([[key,st]])},state:{sessions:{[key]:'session-test'}},
   getSocialV2State:()=>st,saveSocialV2State:()=>{},isSessionAllowedInCurrentMode:()=>true,canonicalV2Key:k=>k,v2ToolEnabled:()=>true,
   activeWaits:new Map(),pendingWakeKeys:new Set(),pendingWakeLeaseTimers:new Map(),pendingReasonRetryTimers:new Map(),pendingReasonSince:new Map(),busySinceV2:new Map(),promptQueues:new Map(),v2TurnStartAt:new Map(),collectors:new Map(),
   finishExecutionV2:()=>{},armPendingReasonRetry:()=>{},armPendingWakeLease:()=>{},disarmPendingWakeLease:()=>{},
   isSleepingConfigV2:()=>false,preSleepWaitBlockedV2:()=>false,ensureWakeableV2:()=>{},computeWakeSafetyV2:()=>({guaranteed:true}),markReadCalledKeys:new Set(),
   log:()=>{},screenWatch:{loadConfig:()=>({enabled:false})},activeWaitHardCapMs:()=>5000,releaseStaleWaits:()=>{},suggestQuietMsV2:()=>0,sleep:ms=>new Promise(r=>setTimeout(r,ms)),looksLikeUnfinished:()=>false,
   modeAllowed:()=>true,shouldBlockSilentReply:()=>false,shouldBlockSilent:()=>false,shouldAuditKey:()=>false,computeGapsV2:()=>[],SENSITIVE_RE:/$^/,recordSentMessagesV2:()=>{},appendActivity:()=>{},scheduleReplyCheckV2:()=>{},findCjkSpaceWarning:()=>null,findSplitBoundaryWarning:()=>null,
   KNOWN_AGENT_TOKENS:new Set([token]),extractPromptMessagesV2:()=>[msg(1)],selectWakeContext:()=>({recent:[],unread:[msg(1)]}),
   cancelReplyCheckV2:()=>{},memoryTree:{prepare:async()=>{},offerStyleReview:()=>null,offerCandidateReview:()=>null},buildInlineContextV2:()=>'',buildWakePromptV2:()=>'',rememberLastPrompt:()=>{},
   WAKE_PRIORITY:{private:100,atMention:90,question:80},sendChain:Promise.resolve(),
   ...overrides};
 const ctx=vm.createContext(base);vm.runInContext(names.map(fn).join('\n'),ctx);
 return {ctx,st};
}
function run(st){const e=w.claimExecution(st,'private');Object.assign(e,{sessionId:'session-test',phase:'running',turn:1,baselineSeq:1});return e;}
async function withServer(overrides,body){
 const h=harness(['startConsoleServer'],overrides);const e=run(h.st);
 const server=h.ctx.startConsoleServer();await once(server,'listening');
 const request=async(path,{method='GET',body,agent=token}={})=>{
   const r=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{'x-console-token':h.ctx.cfg.consoleToken,...(agent?{'x-agent-token':agent}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
   return {status:r.status,data:await r.json()};
 };
 try{await body({...h,e,request});}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
}
test('real HTTP unread receipt covers returned subset; mark-read leaves unseen concurrent messages',async()=>{
 await withServer({},async({st,e,request})=>{
  const read=await request('/api/socialV2/unread?key='+key+'&limit=1');assert.equal(read.status,200);assert.deepEqual(read.data.deliveredSeqs,[2]);assert.equal(read.data.batchId,e.id);
  st.unread.push(msg(3));st.lastUnreadSeq=3;
  const mark=await request('/api/socialV2/mark-read',{method:'POST',body:{key,batchId:e.id}});assert.equal(mark.data.markedCount,1);assert.deepEqual(st.unread.map(m=>m.seq),[1,3]);
 });
});
test('real HTTP stale batch and revoked token cannot acknowledge another round',async()=>{
 await withServer({},async({st,e,request})=>{
  w.registerVisible(st,e.id,[msg(1)]);
  assert.equal((await request('/api/socialV2/mark-read',{method:'POST',body:{key,batchId:'old'}})).status,409);
  st.agentToken='replacement';assert.equal((await request('/api/socialV2/mark-read',{method:'POST',body:{key}})).status,403);assert.equal(st.unread.length,2);
 });
});
test('real HTTP wait returns pre-existing unseen work instead of sleeping past it',async()=>{
 await withServer({},async({st,e,request})=>{
  w.registerVisible(st,e.id,[msg(1)]);
  const result=await request('/api/socialV2/wait',{method:'POST',body:{key,timeoutMs:100,quietMs:0}});
  assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.data.arrived,true);assert.deepEqual(result.data.newMessages.map(m=>m.seq),[2]);assert.equal(st.wakeDelivery.execution.id,e.id);
 });
});
test('real send handler acknowledges entry snapshot, not arrivals while send is in flight',async()=>{
 let stRef;
 await withServer({sendMessagesV2:async()=>{stRef.unread.push(msg(3));stRef.lastUnreadSeq=3;return [{text:'reply',messageId:1}];}},async({st,e,request})=>{
  stRef=st;w.registerVisible(st,e.id,[msg(1)]);
  const result=await request('/api/socialV2/send-message',{method:'POST',body:{key,messages:['reply']}});
  assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.data.ok,true);assert.deepEqual(st.unread.map(m=>m.seq),[2,3]);
 });
});
test('failed and partial sends leave the visible work pending',async()=>{
 await withServer({sendMessagesV2:async()=>{const err=new Error('partial failure');err.sent=[{text:'one',messageId:1}];throw err;}},async({st,e,request})=>{
  w.registerVisible(st,e.id,[msg(1)]);
  const result=await request('/api/socialV2/send-message',{method:'POST',body:{key,messages:['one','two']}});
  assert.equal(result.data.ok,false);assert.match(result.data.error,/partial failure/);assert.equal(w.isMessageConfirmed(st,1),false);
 });
});
test('actual drain scans stale head, schedules relevant tail, retains work through batch window',async()=>{
 const scheduled=[];
 const {ctx,st}=harness(['drainPendingWakeV2','wakePriorityV2','isConversationBusyV2'],{scheduleWakeV2:(k,r)=>scheduled.push([k,r])});
 st.lastHandledSeq=1;w.normalizeWakeDelivery(st);w.enqueueWake(st,'private',1);w.enqueueWake(st,'atMention',2);
 await ctx.drainPendingWakeV2(key);assert.deepEqual(scheduled,[[key,'atMention']]);assert.equal(st.pendingWakeReasons.length,1);
});
test('actual wake admission is acquired before asynchronous memory preparation',async()=>{
 let resume,deliveries=0;const gate=new Promise(r=>resume=r);
 const {ctx,st}=harness(['sendWakePromptV2','queueOrForceWakeV2','isConversationBusyV2'],{
  state:{sessions:{}},memoryTree:{prepare:()=>gate,offerStyleReview:()=>null,offerCandidateReview:()=>null},deliverPrompt:async()=>{deliveries++;return {ok:true};}});
 const first=ctx.sendWakePromptV2(key,'private');await Promise.resolve();
 assert.ok(st.wakeDelivery.execution);const second=ctx.sendWakePromptV2(key,'atMention');await second;resume();await first;
 assert.equal(deliveries,1);assert.ok(st.pendingWakeReasons.some(x=>x.reason==='atMention'));
});
test('actual quota branch persists private work and schedules a retry',async()=>{
 let retries=0;const {ctx,st}=harness(['sendWakePromptV2','queueOrForceWakeV2','isConversationBusyV2'],{armPendingReasonRetry:()=>retries++});
 st.wakeTimes=[Date.now()];await ctx.sendWakePromptV2(key,'private');assert.equal(retries,1);assert.ok(st.wakeDelivery.nextEligibleAt>Date.now());assert.equal(st.pendingWakeReasons[0].reason,'private');
});
test('actual network fence rejects old delayed media and burst continuation',async()=>{
 let calls=0;const {ctx,st}=harness(['assertSendPermitV2','guardedOneBotFetchV2'],{fetch:async()=>{calls++;return Response.json({status:'ok',retcode:0});}});const e=run(st);
 const permit={token,key,executionId:e.id};
 await ctx.sendContext.run(permit,()=>ctx.guardedOneBotFetchV2('http://127.0.0.1/send_private_msg',{body:JSON.stringify({user_id:123})}));
 w.releaseExecution(st,e.id);run(st);st.agentToken='new';
 await assert.rejects(ctx.sendContext.run(permit,()=>ctx.guardedOneBotFetchV2('http://127.0.0.1/send_private_msg',{body:JSON.stringify({user_id:123})})),/权限已失效/);assert.equal(calls,1);
});
test('actual network timeout records ambiguous send and prevents blind success',async()=>{
 const {ctx,st}=harness(['assertSendPermitV2','guardedOneBotFetchV2'],{fetch:async()=>{throw new Error('timeout');}});const e=run(st);
 await assert.rejects(ctx.sendContext.run({token,key,executionId:e.id},()=>ctx.guardedOneBotFetchV2('http://127.0.0.1/send_private_msg',{body:JSON.stringify({user_id:123})})),/发送结果未知/);assert.ok(e.sendUncertain);assert.equal(w.isMessageConfirmed(st,1),false);
});
test('actual recovery proves terminal before cleaning a ghost collector; silence alone stays busy',async()=>{
 let activity={status:'busy',turn:1,asOfSeq:20};
 const {ctx,st}=harness(['reconcileConversationV2','finishExecutionV2','clearBusyResidueV2','isConversationBusyV2'],{readDshActivityV2:async()=>activity});
 const e=run(st);ctx.collectors.set('session-test',{});ctx.v2TurnStartAt.set('session-test',Date.now()-180000);
 await ctx.reconcileConversationV2(key);assert.equal(ctx.isConversationBusyV2(key,st),true);assert.equal(st.wakeDelivery.execution.id,e.id);
 activity={status:'idle',terminal:{seq:21,data:{turn:1}},asOfSeq:21};await ctx.reconcileConversationV2(key);
 assert.equal(ctx.isConversationBusyV2(key,st),false);assert.equal(ctx.collectors.has('session-test'),false);
});
test('actual finishing state waits for outbound request and cannot be released by another generation',()=>{
 const {ctx,st}=harness(['finishExecutionV2','clearBusyResidueV2']);const e=run(st);e.terminal=true;
 ctx.activeAgentRequests.set(e.id,1);assert.equal(ctx.finishExecutionV2(key,e.id),false);assert.equal(ctx.finishExecutionV2(key,'old'),false);
 st.wakeDelivery.blockedReason='DSH 回合仍在运行';
 ctx.activeAgentRequests.set(e.id,0);assert.equal(ctx.finishExecutionV2(key,e.id),true);assert.equal(st.wakeDelivery.execution,null);assert.equal(st.wakeDelivery.blockedReason,'');
});
test('actual prompt timeout stays unknown; accepted response never releases execution',async()=>{
 let fail=true;
 const {ctx,st}=harness(['deliverPromptNow'],{dshReady:true,ensureSession:async()=> 'session-test',withSlangContext:t=>t,
   readDshActivityV2:async()=>({status:'idle',asOfSeq:5}),api:{sessions:{prompt:async request=>{assert.ok(request.requestId);if(fail)throw new Error('timeout');return {result:{ok:true,value:{}}};}}},social:{exitingSessions:new Set()}});
 const e=w.claimExecution(st,'private');
 await assert.rejects(ctx.deliverPromptNow(key,'prompt',{executionId:e.id}),/timeout/);assert.equal(e.phase,'submitting');assert.equal(st.wakeDelivery.execution.id,e.id);
 e.phase='preparing';fail=false;await ctx.deliverPromptNow(key,'prompt',{executionId:e.id});assert.equal(e.phase,'accepted');assert.equal(st.wakeDelivery.execution.id,e.id);
});
test('preparation exception preserves pending work but releases only its own local execution',async()=>{
 const {ctx,st}=harness(['sendWakePromptV2','queueOrForceWakeV2','isConversationBusyV2'],{state:{sessions:{}},buildInlineContextV2:()=>{throw new Error('fixture preparation failure');}});
 await ctx.sendWakePromptV2(key,'private');assert.equal(st.wakeDelivery.execution,null);assert.equal(st.pendingWakeReasons.length,1);
});
test('startup reconciliation cannot release a newly preparing live invocation',async()=>{
 const {ctx,st}=harness(['reconcileConversationV2'],{readDshActivityV2:()=>{throw new Error('must not query live preparation');}});
 const e=w.claimExecution(st,'private');await ctx.reconcileConversationV2(key,{startup:true});assert.equal(st.wakeDelivery.execution.id,e.id);assert.equal(e.phase,'preparing');
});
test('confirmed idle observation of a replacement session uses its own sequence fence',async()=>{
 const {ctx,st}=harness(['reconcileConversationV2','clearBusyResidueV2'],{readDshActivityV2:async()=>({status:'idle',asOfSeq:9})});
 const d=w.normalizeWakeDelivery(st);d.observedSessionId='old';d.observedSeq=900;
 await ctx.reconcileConversationV2(key);assert.equal(d.observedSessionId,'session-test');assert.equal(d.observedSeq,9);
});
test('explicit cross-target media keeps originating execution capability and rejects unapproved targets',async()=>{
 let calls=0;const {ctx,st}=harness(['assertSendPermitV2','guardedOneBotFetchV2'],{fetch:async()=>{calls++;return Response.json({status:'ok',retcode:0});}});const e=run(st);
 const permit={token,key,executionId:e.id,allowedTargets:new Set(['group:456'])};
 await ctx.sendContext.run(permit,()=>ctx.guardedOneBotFetchV2('http://127.0.0.1/send_group_msg',{body:JSON.stringify({group_id:456})}));
 await assert.rejects(ctx.sendContext.run(permit,()=>ctx.guardedOneBotFetchV2('http://127.0.0.1/send_group_msg',{body:JSON.stringify({group_id:789})})),/权限已失效/);assert.equal(calls,1);
});

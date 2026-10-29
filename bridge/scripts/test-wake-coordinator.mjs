import test from 'node:test';
import assert from 'node:assert/strict';
import * as w from '../src/wake-coordinator.js';
import {createTurnCollector} from '../src/dsh-client.js';

const msg = seq => ({seq,text:'message '+seq,isSelf:false});
const state = () => ({agentToken:'token',lastHandledSeq:0,lastUnreadSeq:3,unread:[msg(1),msg(2),msg(3)],recentMessages:[]});
const running = st => {const e=w.claimExecution(st,'private',1000); Object.assign(e,{sessionId:'s',phase:'running',turn:1,baselineSeq:5});return e;};
test('stale head never hides relevant tail; duplicate reasons coalesce',()=>{
 const st=state(),e=running(st);w.registerVisible(st,e.id,[msg(1)]);w.confirmVisible(st,e.id,[1]);
 w.enqueueWake(st,'private',1);w.enqueueWake(st,'atMention',3);w.enqueueWake(st,'atMention',3);
 assert.deepEqual(w.pendingWakes(st).map(x=>x.seq),[3]);
});
test('admission is synchronous, single per conversation, independent across conversations',()=>{
 const a=state(),b=state();assert.ok(w.claimExecution(a,'private'));assert.equal(w.claimExecution(a,'atMention'),null);assert.ok(w.claimExecution(b,'private'));
});
test('normal 180-second tool wait does not expire execution',()=>{
 const st=state(),e=running(st);assert.equal(w.claimExecution(st,'private',1000000),null);assert.equal(st.wakeDelivery.execution.id,e.id);
});
test('old terminal and old session cannot release a newer execution',()=>{
 const st=state(),e=running(st);assert.equal(w.observeTurn(st,'old',{type:'turn/end',seq:9,data:{turn:1}}),false);
 assert.equal(w.observeTurn(st,'s',{type:'turn/end',seq:4,data:{turn:1}}),false);
 assert.equal(w.observeTurn(st,'s',{type:'turn/end',seq:10,data:{turn:0}}),false);
 assert.equal(w.releaseExecution(st,'old'),false);assert.equal(st.wakeDelivery.execution.id,e.id);
});
test('missing start still reports matching terminal, metadata never opens a turn',()=>{
 const c=createTurnCollector();assert.equal(c.push({type:'metadata/change',data:{}}),null);
 const end=c.push({type:'turn/end',data:{turn:7,reason:{kind:'completed'}}});assert.equal(end.missingStart,true);assert.equal(end.text,'');
 const st=state(),e=running(st);e.turn=null;e.promptObservedByTool=true;assert.equal(w.observeTurn(st,'s',{type:'turn/end',seq:9,data:{turn:7}}),true);assert.equal(e.terminal,true);
});
test('whole assistant message is collected once, chunks do not double text',()=>{
 const c=createTurnCollector();c.push({type:'turn/start',data:{turn:1}});c.push({type:'assistant/chunk',data:{turn:1,text:'hello'}});
 c.push({type:'assistant/message',data:{turn:1,message:{content:[{type:'text',text:'hello'}]}}});assert.equal(c.push({type:'turn/end',data:{turn:1,reason:{kind:'completed'}}}).text,'hello');
});
test('sparse visibility and confirmations preserve holes and concurrent arrivals',()=>{
 const st=state(),e=running(st);w.registerVisible(st,e.id,[msg(1),msg(3)]);w.confirmVisible(st,e.id,[1,2,3]);
 assert.deepEqual(st.unread.map(m=>m.seq),[2]);assert.equal(w.isMessageConfirmed(st,2),false);assert.equal(w.isMessageConfirmed(st,3),true);
 st.unread.push(msg(4));w.confirmVisible(st,e.id,[4]);assert.equal(w.isMessageConfirmed(st,4),false);
});
test('wait sees already-arrived unseen messages, not just arrivals after request',()=>{
 const st=state(),e=running(st);w.registerVisible(st,e.id,[msg(1),msg(3)]);assert.deepEqual(w.unseenMessages(st).map(m=>m.seq),[2]);
});
test('receipt of an old batch cannot clear a new execution',()=>{
 const st=state(),e=running(st);w.registerVisible(st,e.id,[msg(1)]);w.releaseExecution(st,e.id);running(st);
 assert.deepEqual(w.confirmVisible(st,e.id,[1]),[]);assert.equal(st.unread.length,3);
});
test('private and at calls defer minute quota, bypass hourly quota; ordinary work defers hour',()=>{
 const now=10000000,times=[now-5000];
 assert.equal(w.nextWakeAt(times,now,{maxPerMinute:1,maxPerHour:1},'private'),now+55001);
 assert.equal(w.nextWakeAt(times,now,{maxPerHour:1},'atMention'),now);
 assert.equal(w.nextWakeAt(times,now,{maxPerHour:1},'question'),now+3595001);
});
test('direct work is not discarded at the old twenty-item cap; payload survives rolling buffer',()=>{
 const st=state();for(let n=1;n<=35;n++)w.enqueueWake(st,'private',n);st.unread=[];
 assert.equal(w.pendingWakes(st).length,35);assert.equal(w.pendingWakes(st)[0].message.text,'message 1');
});
test('legacy watermark is migrated once; display maximum cannot confirm future holes',()=>{
 const st=state();st.lastHandledSeq=1;w.normalizeWakeDelivery(st);st.lastHandledSeq=3;
 assert.equal(w.isMessageConfirmed(st,1),true);assert.equal(w.isMessageConfirmed(st,2),false);
 const copy=JSON.parse(JSON.stringify(st));assert.equal(w.isMessageConfirmed(copy,2),false);
});
test('credentials are bound to active execution; terminal and rotated capabilities are revoked',()=>{
 const st=state(),e=running(st);assert.equal(w.canUseExecution(st,'token'),true);e.terminal=true;assert.equal(w.canUseExecution(st,'token'),false);
 w.releaseExecution(st,e.id);running(st);st.agentToken='new';assert.equal(w.canUseExecution(st,'token'),false);assert.equal(w.canUseExecution(st,'new'),true);
});
const snapshot=(events,{inbox={'next-turn':[],'next-step':[]},turn=1}={})=>[
 {asOfSeq:20,values:{turnOutline:turn==null?[]:[{turn,seq:6}],inbox}},
 {records:events.map(event=>({type:'event',event})),hasMore:false}
];
test('restart reconstructs a quiet running turn; inbox is busy even after end',()=>{
 let args=snapshot([{type:'turn/start',seq:6,data:{turn:1}}]);assert.equal(w.inspectDshSnapshot(...args).status,'busy');
 args=snapshot([{type:'turn/end',seq:10,data:{turn:1}}],{inbox:{'next-turn':[{id:'queued'}]}});assert.equal(w.inspectDshSnapshot(...args).status,'busy');
});
test('uncertain acceptance is not blindly retried; later sequenced terminal resolves it',()=>{
 const st=state(),e=running(st);Object.assign(e,{turn:null,phase:'unknown',baselineSeq:12});
 let args=snapshot([{type:'turn/end',seq:10,data:{turn:1}}]);assert.equal(w.inspectDshSnapshot(...args,e).status,'unknown');
 args=snapshot([{type:'turn/start',seq:15,data:{turn:2}},{type:'turn/end',seq:19,data:{turn:2}}],{turn:2});assert.equal(w.inspectDshSnapshot(...args,e).status,'unknown');
 args[0].values.turnOutline[0].seq=15;
 args[1].records.unshift({event:{type:'agent/inbox/spliced',seq:14,data:{inserted:[{content:[{type:'text',text:e.id}]}]}}});assert.equal(w.inspectDshSnapshot(...args,e).status,'idle');
});
test('an external turn that started before this prompt cannot clear its accepted execution',()=>{
 const st=state(),e=running(st);Object.assign(e,{turn:null,phase:'accepted',baselineSeq:5});
 assert.equal(w.observeTurn(st,'s',{type:'turn/start',seq:6,data:{turn:2}}),false);
 w.observeTurn(st,'s',{type:'agent/inbox/spliced',seq:8,data:{inserted:[{content:[{type:'text',text:e.id}]}]}});
 assert.equal(w.observeTurn(st,'s',{type:'turn/end',seq:10,data:{turn:2}}),false);
 assert.equal(w.observeTurn(st,'s',{type:'turn/start',seq:11,data:{turn:3}}),true);
 assert.equal(e.turn,3);
});

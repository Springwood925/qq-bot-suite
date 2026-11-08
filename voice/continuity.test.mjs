import {test} from 'node:test';
import assert from 'node:assert/strict';
import {findResumableSession} from './session-recovery.mjs';
import {permittedScopes,recallCallMemory,matchMentionedGroup,recentGroupContext} from './memory-context.mjs';

test('恢复最近仍存在、且属于通话工作区的会话',()=>{
 const records=[{sessionId:'old'},{sessionId:'other'},{sessionId:'gone'}];
 const sessions=[{sessionId:'old',cwd:process.cwd(),agentAvailable:true},{sessionId:'other',cwd:'unrelated'}];
 assert.equal(findResumableSession(records,sessions,process.cwd()),'old');
 assert.equal(findResumableSession(records,[],process.cwd()),null);
});

test('记忆只查询管理员私聊和允许的群，排除禁用群与不相关或未核实内容',async()=>{
 const config={ownerQQ:123456,consolePort:3100,allow:{groups:[222222,333333]},deny:{groups:[333333]}};
 assert.deepEqual(permittedScopes(config),['private:123456','group:222222']);
 const requests=[];
 const fetchImpl=async(_url,options)=>{
  const body=JSON.parse(options.body);requests.push(body);
  return {ok:true,json:async()=>({ok:true,records:[
   {status:'active',content:'相关记忆',retrieval:{keyword:true}},
   {status:'unverified',content:'未核实',retrieval:{keyword:true}},
   {status:'active',content:'不相关',retrieval:{keyword:false,semantic:0.4}}
  ]})};
 };
 const result=await recallCallMemory({config,token:'test',text:'问题',fetchImpl});
 assert.equal(requests.length,2);assert.ok(requests.every(x=>x.includeUnverified===false&&x.status==='active'));
 assert.deepEqual(result.map(x=>x.内容),['相关记忆','相关记忆']);
});

test('记忆服务故障时继续通话，用户挂断则中断查询',async()=>{
 const config={ownerQQ:123456};
 assert.deepEqual(await recallCallMemory({config,token:'test',text:'测试',fetchImpl:async()=>{throw Error('offline')}}),[]);
 const abort=new AbortController();abort.abort();
 await assert.rejects(recallCallMemory({config,token:'test',text:'测试',signal:abort.signal,fetchImpl:async()=>{throw Error('offline')}}),{name:'AbortError'});
});

test('只在群名能唯一匹配时读取已允许群的近期消息',async()=>{
 const config={ownerQQ:123456,allow:{groups:[222222,333333]},deny:{groups:[333333]}};
 const groups=[{groupId:'222222',groupName:'战地薯条交流群'},{groupId:'333333',groupName:'私密群'}];
 assert.equal(matchMentionedGroup('你有薯条群的上下文吗',groups).groupId,'222222');
 assert.equal(matchMentionedGroup('全号是 222222',groups).groupId,'222222');
 assert.equal(matchMentionedGroup('你还记得数条权吗',groups).groupId,'222222');
 assert.equal(matchMentionedGroup('你还记得主条权吗',groups).groupId,'222222');
 assert.equal(matchMentionedGroup('你记得刚才薯条圈里聊过什么吗',groups).groupId,'222222');
 assert.equal(matchMentionedGroup('群里最近聊什么',groups),null);
 assert.equal(matchMentionedGroup('薯条大群聊了什么',[...groups,{groupId:'444444',groupName:'薯条讨论群'}]),null);
 const urls=[];
 const fetchImpl=async url=>{urls.push(url);return {ok:true,json:async()=>url.endsWith('/api/groups')?{groups}:{messages:[
  {sender:'朋友',plain:'保留的消息',time:123},
  {sender:'朋友',plain:'撤回的消息',recalled:true}
 ]}}};
 const context=await recentGroupContext({config,token:'test',text:'薯条群最近在聊什么',fetchImpl});
 assert.equal(context.群名,'战地薯条交流群');assert.deepEqual(context.消息.map(x=>x.内容),['保留的消息']);
 assert.equal(urls.length,2);assert.ok(decodeURIComponent(urls[1]).includes('group:222222'));
 const noMatch=await recentGroupContext({config,token:'test',text:'群里聊了什么',fetchImpl});
 assert.match(noMatch.状态,/无法唯一识别/);
});

test('上下文预算不足时优先保留最新消息',async()=>{
 const config={ownerQQ:123456,allow:{groups:[222222]}};
 const messages=Array.from({length:20},(_,i)=>({sender:'朋友',plain:String(i).padStart(2,'0')+'x'.repeat(148)}));
 const fetchImpl=async url=>({ok:true,json:async()=>url.endsWith('/api/groups')?{groups:[{groupId:'222222',groupName:'战地薯条交流群'}]}:{messages}});
 const value=await recentGroupContext({config,token:'test',text:'薯条圈聊了什么',fetchImpl});
 assert.ok(value.消息.at(-1).内容.startsWith('19'));
 assert.ok(!value.消息.some(x=>x.内容.startsWith('00')));
});

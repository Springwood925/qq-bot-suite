// 离线测试：真实 SQLite、HTTP 路由与 MCP stdio；不调用 DSH、QQ 或收费模型。
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createMemoryTree,parseMemoryPacket} from '../src/memory-tree.js';
import {handleMemoryRoute,MEMORY_PATHS} from '../src/memory-routes.js';
const ROOT=path.resolve(import.meta.dirname,'..');
const NOW=1800000000000;const A='group:12345',B='private:12345';
const msg=(seq,userId='12345',plain='我不吃辣',sender='旧昵称',time=NOW)=>({seq,userId,plain,sender,time,messageId:String(-1000-seq),isSelf:false});
const req=(sourceSeq=1,content='不吃辣',extra={})=>({kind:'fact',content,factKey:'food.spice',sourceSeq,evidence:'statement',...extra});
function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-memory-test-'));let tick=NOW;
  const file=path.join(dir,'tree.sqlite');const tree=createMemoryTree({file,now:()=>tick});
  t.after(()=>{tree.close();const resolved=path.resolve(dir);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('qq-memory-test-'));fs.rmSync(resolved,{recursive:true,force:true});});
  return {tree,file,time:v=>{tick=v;}};
}
test('稳定身份能改名，同昵称不同 QQ 不合并，其他群和私聊不可读',t=>{
  const {tree}=fixture(t);const messages=[msg(1),msg(2,'12345','微辣可以','新昵称'),msg(3,'23456','我爱吃辣','新昵称')];tree.observe(A,messages);
  assert.equal(tree.resolvePerson(A,'旧昵称'),'12345');assert.throws(()=>tree.resolvePerson(A,'新昵称'),/多人/);
  const record=tree.store(A,req(),{messages}).record;
  assert.match(tree.format(A,{messages}),/新昵称/);assert.equal(record.subjectUserId,'12345');
  assert.deepEqual(tree.recall(B,{q:'不吃辣',includeUnverified:true}),[]);
  assert.throws(()=>tree.recall(B,{id:record.id}),/找不到/);
  assert.throws(()=>tree.execute(A,{action:'recall',scope:B}),/跨会话/);
});
test('来源必须是真实收到的消息；自己的回答、他人转述和伪造身份不能变成本人陈述',t=>{
  const {tree}=fixture(t);const messages=[msg(1),{...msg(2),isSelf:true}];
  assert.throws(()=>tree.store(A,req(99),{messages}),/真实收到/);
  assert.throws(()=>tree.store(A,req(2),{messages}),/真实收到/);
  assert.throws(()=>tree.store(A,req(1,'爱辣',{subjectUserId:'23456'}),{messages}),/转述/);
  assert.throws(()=>tree.store(A,req(1,'爱辣',{subjectUserId:'昵称'}),{messages}),/稳定/);
  assert.throws(()=>tree.store(A,req(1,'爱辣',{evidence:'admin'}),{messages}),/证据/);
  for(const evidence of ['reported','inference','joke']){
    const r=tree.store(A,req(1,'吃辣是玩笑',{evidence,factKey:evidence}),{messages}).record;assert.equal(r.status,'unverified');
  }
  assert.equal(tree.recall(A).length,0);assert.equal(tree.recall(A,{includeUnverified:true}).length,3);
  assert.equal(tree.store(A,req(1,'吃辣是玩笑',{evidence:'joke',factKey:'joke'}),{messages}).duplicate,true);
});
test('纠正有版本和原文来源；重复不堆积、旧版本和依赖摘要不再默认召回',t=>{
  const {tree,time}=fixture(t);const messages=[msg(1),msg(2,'12345','微辣可以','旧昵称',NOW+1000)];
  const first=tree.store(A,req(),{messages}).record;
  assert.equal(tree.store(A,req(),{messages}).duplicate,true);
  const summary=tree.store(A,req(1,'一起点餐时不能点辣菜',{factKey:'meal.summary',relatedIds:[first.id]}),{messages}).record;
  time(NOW+1000);
  assert.throws(()=>tree.store(A,req(2,'微辣可以'),{messages}),/replacesId/);
  const revised=tree.store(A,req(2,'微辣可以',{replacesId:first.id}),{messages}).record;
  assert.equal(revised.previousId,first.id);assert.equal(revised.source.excerpt,'微辣可以');
  assert.equal(tree.recall(A,{q:'不吃辣'}).length,0);assert.equal(tree.recall(A,{id:first.id})[0].status,'superseded');
  assert.equal(tree.recall(A,{id:summary.id})[0].status,'unverified');
  assert.throws(()=>tree.store(A,req(1,'不吃辣',{replacesId:revised.id}),{messages}),/更早/);
  assert.throws(()=>tree.store(A,req(2,'更正',{replacesId:revised.id,evidence:'inference'}),{messages}),/不能用转述/);
});
test('事件隔天不消失；想法两小时过期；完成后不会在交接中复活',t=>{
  const {tree,time}=fixture(t);const messages=[msg(1),msg(2,'12345','修好了','旧昵称',NOW+86400001)];
  const event=tree.store(A,req(1,'修模组闪退',{kind:'event',factKey:'mod.crash',nextStep:'检查依赖版本'}),{messages}).record;
  tree.store(A,req(1,'想问晚餐',{kind:'thought',factKey:'dinner'}),{messages});
  time(NOW+86400001);assert.equal(tree.recall(A,{kind:'event'}).length,1);assert.equal(tree.recall(A,{kind:'thought'}).length,0);
  assert.equal(tree.handoff(A,'old-session').openRecords,1);
  tree.store(A,req(2,'闪退已解决：依赖版本不匹配',{kind:'event',factKey:'mod.crash',replacesId:event.id,status:'done',nextStep:''}),{messages});
  assert.equal(tree.handoff(A,'new-session').openRecords,0);assert.doesNotMatch(tree.format(A,{messages}),/尚有.*项未完成/);
});
test('SQLite 重开保留记录，旧记忆仅迁移一次且缺来源不升级成事实',t=>{
  const {tree,file}=fixture(t);const state={recentMessages:[msg(1)],activeTopics:[{text:'旧事件',lastMentionAt:NOW-86400000}],memberImpressions:{旧昵称:{traits:['旧标签'],lastSeenAt:NOW},无来源昵称:{traits:['无法认人']}}};
  tree.migrate(A,state);tree.migrate(A,state);assert.equal(tree.stats().nodes,3);assert.equal(tree.recall(A).length,0);
  assert.equal(tree.recall(A,{includeUnverified:true}).find(r=>r.content==='无法认人').subjectUserId,null);
  const id=tree.store(A,req(),{messages:[msg(1)]}).record.id;
  tree.close();
  const reopened=createMemoryTree({file,now:()=>NOW});try{assert.equal(reopened.recall(A,{id})[0].content,'不吃辣');}finally{reopened.close();}
});
test('遗忘删除版本与依赖分支；重启和重新迁移都不会复活；原 QQ 数据不在操作范围',t=>{
  const {tree,file}=fixture(t);const messages=[msg(1),msg(2)];
  const first=tree.store(A,req(),{messages}).record;
  const next=tree.store(A,req(2,'微辣可以',{replacesId:first.id}),{messages}).record;
  const derived=tree.store(A,req(2,'点餐摘要',{factKey:'summary',relatedIds:[next.id]}),{messages}).record;
  tree.forget(A,next.id);assert.deepEqual(tree.recall(A,{includeUnverified:true}),[]);
  assert.equal(tree.recall(A,{id:first.id}).length,0);assert.equal(tree.recall(A,{id:derived.id}).length,0);
  assert.throws(()=>tree.store(A,req(),{messages}),/遗忘/);
  const reopened=createMemoryTree({file,now:()=>NOW});try{assert.equal(reopened.recall(A,{id:next.id}).length,0);}finally{reopened.close();}
  const old={recentMessages:messages,activeTopics:[{text:'旧话题'}]};tree.migrate(B,old);tree.clear(B);tree.migrate(B,old);assert.equal(tree.recall(B,{includeUnverified:true}).length,0);
});
test('遗忘操作须来自本人或管理员；跨会话关联不允许',t=>{
  const {tree}=fixture(t);const messages=[msg(1),msg(2,'23456','忘掉他的信息'),msg(3,'34567','忘掉该记录')];const record=tree.store(A,req(),{messages}).record;
  assert.throws(()=>tree.execute(A,{action:'forget',id:record.id,sourceSeq:2},{messages}),/本人或管理员/);
  assert.throws(()=>tree.store(B,req(1,'跨会话摘要',{relatedIds:[record.id]}),{messages}),/找不到/);
  assert.equal(tree.execute(A,{action:'forget',id:record.id,sourceSeq:3},{messages,isOwner:id=>id==='34567'}).forgotten,true);
});
test('自动注入有长度上限，完成事项无待办提醒；旧会话 JSON 协议完整可用',t=>{
  const {tree}=fixture(t);const messages=[msg(1)];tree.observe(A,messages);
  for(let i=0;i<20;i++)tree.store(A,req(1,('事件'+i+'：我不吃辣，微辣可以。').repeat(12),{factKey:'event.'+i,kind:'event'}),{messages});
  const prompt=tree.format(A,{messages});const cost=[...prompt].reduce((n,c)=>n+(c.codePointAt(0)>127?2:.4),0);assert.ok(cost<1000,cost);
  const packet=JSON.stringify({_memoryTree:1,action:'recall',q:'吃辣',limit:2});assert.equal(parseMemoryPacket(packet).action,'recall');
  assert.equal(tree.legacyAppend(A,'activeTopic',packet,{}, {messages}).records.length,2);
  assert.equal(tree.legacyAppend(A,'activeTopic','旧版普通便签',{}, {messages}).record.status,'unverified');
});
test('旧管理端同名列表可按 QQ 定位；管理端纠正也使关联摘要待核实',t=>{
  const {tree}=fixture(t);const messages=[msg(1),msg(2,'23456','我爱吃辣','旧昵称')];tree.observe(A,messages);
  const a=tree.store(A,req(),{messages}).record;
  tree.store(A,req(2,'爱吃辣'),{messages});
  const projection=tree.projection(A,'memberImpression');const label=Object.keys(projection.memberImpressions).find(s=>s.includes('12345'));
  assert.equal(tree.legacySelect(A,'memberImpression','',label)[0].id,a.id);
  assert.throws(()=>tree.legacySelect(A,'memberImpression','','旧昵称'),/多人/);
  const derived=tree.store(A,req(1,'不点辣菜',{factKey:'meal',kind:'agreement',relatedIds:[a.id]}),{messages}).record;
  assert.equal(tree.legacySelect(A,'activeTopic','不点辣菜','')[0].id,derived.id);
  tree.adminRevise(A,a.id,{content:'待核实：微辣可以'});
  assert.equal(tree.recall(A,{id:derived.id})[0].status,'unverified');
});
test('真实 MCP → HTTP 路由 → SQLite：新工具、旧入口、令牌、工具开关和跨会话隔离',async t=>{
  const {tree}=fixture(t);let enabled=true;
  const state={memoryScope:A,recentMessages:[msg(1)],unread:[],activeTopics:[],pendingThoughts:[],memberImpressions:{}};
  const server=http.createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    const url=new URL(req.url,'http://localhost');
    if(!MEMORY_PATHS.has(url.pathname)){res.writeHead(404);res.end('{}');return;}
    await handleMemoryRoute({req,url,readBody:async()=>JSON.parse(body),sendJson:(v,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(v));},tree,getState:()=>state,tokenOk:(key,token)=>key===A&&token==='fixture-token',sessionAllowed:()=>true,toolEnabled:()=>enabled,ownerQQ:'34567',saveState:()=>{}});
  });
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-memory-test-'));let client;
  try{
    server.listen(0,'127.0.0.1');await once(server,'listening');
    fs.mkdirSync(path.join(dir,'src'));for(const f of ['mcp-snowluma-safe.js','sensitive.js'])fs.copyFileSync(path.join(ROOT,'src',f),path.join(dir,'src',f));
    fs.writeFileSync(path.join(dir,'package.json'),'{"type":"module"}');fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify({consolePort:server.address().port,socialV2:{toolProfile:'minimal'}}));
    const deps=process.env.QQ_BRIDGE_DEPENDENCIES||ROOT;const require=createRequire(path.join(deps,'package.json'));
    const {Client}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')).href);
    const {StdioClientTransport}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href);
    const loader=path.join(dir,'deps.mjs');fs.writeFileSync(loader,`import {registerHooks} from 'node:module';const parentURL=${JSON.stringify(pathToFileURL(path.join(deps,'package.json')).href)};registerHooks({resolve(s,c,next){try{return next(s,c)}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&!s.startsWith('.')&&!s.startsWith('/')&&!s.includes(':'))return next(s,{...c,parentURL});throw e}}});`);
    client=new Client({name:'memory-offline-test',version:'1.0.0'});await client.connect(new StdioClientTransport({command:process.execPath,args:['--import',pathToFileURL(loader).href,path.join(dir,'src/mcp-snowluma-safe.js')]}));
    assert.ok((await client.listTools()).tools.some(v=>v.name==='qq_memory_tree'));
    const args={key:A,token:'fixture-token',action:'store',...req()};
    const result=await client.callTool({name:'qq_memory_tree',arguments:args});assert.ok(!result.isError,result.content?.[0]?.text);
    const record=JSON.parse(result.content[0].text).record;assert.equal(record.content,'不吃辣');
    const source=await client.callTool({name:'qq_memory_tree',arguments:{key:A,token:'fixture-token',action:'evidence',id:record.id}});
    assert.ok(!source.isError);assert.equal(JSON.parse(source.content[0].text).records[0].source.text,'我不吃辣');
    assert.equal((await client.callTool({name:'qq_memory_tree',arguments:{key:B,token:'fixture-token',action:'evidence',id:record.id}})).isError,true);
    for(const patch of [{token:'wrong-token'},{key:B}])assert.equal((await client.callTool({name:'qq_memory_tree',arguments:{...args,...patch}})).isError,true);
    const old=await client.callTool({name:'qq_memory_append',arguments:{key:A,token:'fixture-token',category:'activeTopic',content:JSON.stringify({_memoryTree:1,action:'recall',id:record.id})}});
    assert.equal(JSON.parse(old.content[0].text).records[0].source.excerpt,'我不吃辣');
    const read=await client.callTool({name:'qq_memory_query',arguments:{key:A,token:'fixture-token'}});assert.ok(!read.isError);
    assert.ok(JSON.parse(read.content[0].text).raw.memberImpressions);
    assert.equal((await client.callTool({name:'qq_memory_clear',arguments:{key:A,token:'fixture-token'}})).isError,true);
    enabled=false;assert.equal((await client.callTool({name:'qq_memory_tree',arguments:args})).isError,true);assert.equal(tree.stats().nodes,1);
  }finally{
    if(client)await client.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    const resolved=path.resolve(dir);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('qq-memory-test-'));fs.rmSync(resolved,{recursive:true,force:true});
  }
});

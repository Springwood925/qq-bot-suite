import assert from 'node:assert/strict';import {test} from 'node:test';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createMemoryTree} from '../src/memory-tree.js';
import {handleMemoryRoute} from '../src/memory-routes.js';
import {selectWakeContext} from '../src/wake-context.js';
import http from 'node:http';import {once} from 'node:events';import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
const NOW=1800000000000,A='group:11111',B='private:11111',RULE='先承接对方眼前的问题，信息足够时不追加无谓追问';
const messages=(start=1,count=30,at=NOW)=>Array.from({length:count},(_,i)=>({seq:start+i,time:at-1000+i,messageId:String(-5000-start-i),userId:i%2?'99999':'11111',sender:i%2?'虚构鲸鱼':'虚构甲',isSelf:!!(i%2),text:(i%2?'自己的实际回应':'收到的真实话语')+(start+i)}));
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-style-review-')),file=path.join(dir,'tree.sqlite');let time=NOW;const tree=createMemoryTree({file,now:()=>time});t.after(()=>{tree.close();assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(dir).startsWith('qq-style-review-'));fs.rmSync(dir,{recursive:true,force:true});});return {tree,file,tick:v=>{time=v;}};}
const candidate=(extra={})=>({content:RULE,sourceSeqs:[1,3,5],selfSeqs:[2,4],criterion:'question',...extra});
const submit=(tree,offer,items,msgs=messages(),scope=A)=>tree.execute(scope,{action:'review',reviewId:offer.id,candidates:items},{messages:msgs});
function offered(tree,msgs=messages(),scope=A){tree.baselineStyleReview(scope,[]);const offer=tree.offerStyleReview(scope,msgs);assert.ok(offer);return offer;}
test('先建立基线，不回扫既有聊天；新消息达门槛后才搭载一次任务',t=>{
  const {tree}=fixture(t);tree.baselineStyleReview(A,messages());assert.equal(tree.offerStyleReview(A,messages()),null);
  assert.ok(tree.offerStyleReview(A,messages(31)));assert.equal(tree.offerStyleReview(A,messages(61)),null);
});
test('收到的消息或自己回复不足、过期和无来源身份都不能产生回顾',t=>{
  const {tree}=fixture(t);tree.baselineStyleReview(A,[]);
  for(const list of [messages(1,20),messages().filter(m=>!m.isSelf),messages().map(m=>({...m,time:NOW-86400001})),messages().map(m=>m.isSelf?m:{...m,userId:'nickname'})])assert.equal(tree.offerStyleReview(A,list),null);
});
test('回顾不开额外模型或发送任务，不再次复制聊天正文，提示大小有界',t=>{
  const {tree}=fixture(t);const offer=offered(tree);
  assert.ok(offer.prompt.length<900);assert.doesNotMatch(offer.prompt,/收到的真实话语|自己的实际回应/);assert.match(offer.prompt,/candidates:\[\]/);assert.match(offer.prompt,/先处理本次交流/);
});
test('候选同时校验三条人类来源和两条自己的回复，默认不影响表达',async t=>{
  const {tree}=fixture(t),msgs=messages(),offer=offered(tree,msgs),before=tree.format(A,{messages:msgs});
  const result=submit(tree,offer,[candidate()],msgs);assert.equal(result.needsAdminConfirmation,true);
  const record=tree.recall(A,{id:result.candidateIds[0]})[0];assert.equal(record.status,'unverified');assert.equal(record.evidence,'inference');assert.equal(record.metadata.styleReview.selfSources.length,2);
  assert.equal(tree.format(A,{messages:msgs}),before);
  await tree.admin(A,{action:'confirm',id:record.id});assert.match(tree.format(A,{messages:msgs}),/先承接对方眼前/);
});
test('无变化可以报告空结果；重复提交幂等且不制造学习成果',async t=>{
  const {tree}=fixture(t),offer=offered(tree);const result=submit(tree,offer,[]);assert.deepEqual(result.candidateIds,[]);
  assert.equal(submit(tree,offer,[candidate()]).duplicate,true);assert.equal(tree.stats().nodes,0);
  const {review}=await tree.admin(A,{action:'styleReviews'});assert.equal(review.runs[0].status,'completed');assert.equal(review.runs[0].candidateCount,0);
});
test('跨会话、伪造来源、以人类消息冒充自己的回复和滚出窗口均被拒绝',t=>{
  const {tree}=fixture(t),offer=offered(tree);
  assert.throws(()=>submit(tree,offer,[candidate()],messages(),B),/当前会话没有/);
  for(const patch of [{sourceSeqs:[1,3,500]},{selfSeqs:[1,3]},{sourceSeqs:[1,1,3]},{sourceSeqs:[1,3,4]}])assert.throws(()=>submit(tree,offer,[candidate(patch)]));
  assert.throws(()=>submit(tree,offer,[candidate()],messages().slice(5)),/窗口/);
  assert.throws(()=>submit(tree,offer,[candidate()],messages().map(m=>m.seq===2?{...m,text:'换掉正文'}:m)),/改变/);
  assert.equal(tree.stats().nodes,0);
});
test('人物称呼、账号和凭据不能进入表达原则，未知维度和超额候选被拒',t=>{
  const {tree}=fixture(t),offer=offered(tree);
  for(const content of ['只对虚构甲多追问','请记住账号12345678','token=fixture-secret-value','参考https://example.com 的话术'])assert.throws(()=>submit(tree,offer,[candidate({content})]),/表达原则/);
  assert.throws(()=>submit(tree,offer,[candidate({criterion:'always-agree'})]),/维度/);
  assert.throws(()=>submit(tree,offer,[candidate(),candidate(),candidate()]),/最多2/);
});
test('待审核候选存在时停止新回顾，归档后仍遵守每日间隔',t=>{
  const {tree,tick}=fixture(t),offer=offered(tree);submit(tree,offer,[candidate()]);tick(NOW+86400001);
  assert.equal(tree.offerStyleReview(A,messages(31,30,NOW+86400001)),null);
});
test('全局滚动24小时最多两次，失败和取消也占额度以免反复触发',t=>{
  const {tree}=fixture(t);const first=offered(tree);tree.cancelStyleReview(A,first.id);offered(tree,messages(),B);
  tree.baselineStyleReview('group:22222',[]);assert.equal(tree.offerStyleReview('group:22222',messages()),null);
});
test('开关关闭立即阻止安排和提交；仅关闭自动回顾不影响手动候选',async t=>{
  const {tree}=fixture(t),offer=offered(tree);
  await tree.admin('',{action:'settings',settings:{styleReview:false}});
  assert.equal(tree.offerStyleReview(B,messages()),null);assert.throws(()=>submit(tree,offer,[]),/已关闭/);
  const record=tree.store(A,{kind:'style',content:RULE,sourceSeq:1,sourceSeqs:[1,3,5]},{messages:messages()}).record;assert.equal(record.status,'unverified');
});
test('原有单条遗忘会取消未完成回顾；清空后不会把旧批次当新消息',t=>{
  const {tree}=fixture(t),offer=offered(tree);
  const fact=tree.store(A,{kind:'fact',content:'虚构偏好',sourceSeq:1},{messages:messages()}).record;tree.forget(A,fact.id);
  assert.throws(()=>submit(tree,offer,[candidate()]),/失效/);tree.clear(A);assert.equal(tree.offerStyleReview(A,messages()),null);
});
test('第二条写入失败时整批回滚，不留下半批候选或虚假完成状态',async t=>{
  const {tree,file}=fixture(t),content='需要解释时按实际信息展开，不凭空编造体验';
  const db=new DatabaseSync(file);db.exec("CREATE TRIGGER fixture_failure BEFORE INSERT ON nodes WHEN NEW.content='需要解释时按实际信息展开，不凭空编造体验' BEGIN SELECT RAISE(ABORT,'fixture write failure'); END;");db.close();
  const count=tree.stats().nodes,offer=offered(tree);
  assert.throws(()=>submit(tree,offer,[candidate(),candidate({content})]),/fixture write failure/);
  assert.equal(tree.stats().nodes,count);assert.equal((await tree.admin(A,{action:'styleReviews'})).review.runs[0].status,'issued');
});
test('重开数据库保留回顾间隔和幂等记录，不额外存储聊天原文',async t=>{
  const {tree,file}=fixture(t),offer=offered(tree);submit(tree,offer,[]);tree.close();
  const reopened=createMemoryTree({file,now:()=>NOW+1000});try{assert.equal(reopened.offerStyleReview(A,messages(31)),null);assert.equal(submit(reopened,offer,[]).duplicate,true);const db=new DatabaseSync(file,{readOnly:true});try{assert.doesNotMatch(db.prepare('SELECT refs FROM style_review_runs').get().refs,/真实话语|实际回应/);}finally{db.close();}}finally{reopened.close();}
});
test('管理端展示安排与完成的区别，机器人令牌不能读取回顾管理记录',async t=>{
  const {tree}=fixture(t),offer=offered(tree),state={memoryScope:A,recentMessages:messages()};let response;
  await handleMemoryRoute({req:{method:'POST',headers:{'x-agent-token':'fixture-token'}},url:new URL('http://localhost/api/socialV2/memory-admin'),readBody:async()=>({action:'styleReviews',key:A}),sendJson:(data,status=200)=>{response={data,status};},tree,getState:()=>state});assert.equal(response.status,403);
  assert.equal((await tree.admin(A,{action:'list',kind:'style'})).review.runs[0].status,'issued');
  const packet=JSON.stringify({_memoryTree:1,action:'review',reviewId:offer.id,candidates:[candidate()]});const result=tree.legacyAppend(A,'activeTopic',packet,{}, {messages:messages()});assert.equal(result.candidateIds.length,1);
});
test('可见消息选择保留原先去重、已读窗口和未读窗口的顺序',()=>{
  const st={recentMessages:messages(),unread:messages().slice(-6)},before=JSON.stringify(st);
  const selected=selectWakeContext(st,{recentReadLimit:5,unreadLimit:4});assert.deepEqual(selected.unread,st.unread.slice(-4));assert.deepEqual(selected.recent,st.recentMessages.filter(m=>!selected.unread.some(u=>u.seq===m.seq)).slice(-5));assert.equal(JSON.stringify(st),before);assert.deepEqual(selectWakeContext(st,{recentReadLimit:0}),{recent:[],unread:[]});
});
test('回顾过期不伪装完成',t=>{
  const {tree,tick}=fixture(t),offer=offered(tree);tick(NOW+86400000);assert.throws(()=>submit(tree,offer,[]),/失效/);
});
test('重复原则不重复存储；已遗忘候选也不会由同一任务重新提取',async t=>{
  const {tree}=fixture(t),prior=tree.store(A,{kind:'style',content:RULE,sourceSeq:1,sourceSeqs:[1,3,5]},{messages:messages()}).record;
  await tree.admin(A,{action:'confirm',id:prior.id});const offer=offered(tree),count=tree.stats().nodes;
  assert.throws(()=>submit(tree,offer,[candidate(),candidate()]),/重复/);assert.equal(submit(tree,offer,[candidate()]).candidateIds.length,0);assert.equal(tree.stats().nodes,count);
  const other=offered(tree,messages(),B),result=submit(tree,other,[candidate()],messages(),B);tree.forget(B,result.candidateIds[0]);const after=tree.stats().nodes;
  assert.equal(submit(tree,other,[candidate()],messages(),B).duplicate,true);assert.equal(tree.stats().nodes,after);assert.deepEqual(tree.recall(B,{id:result.candidateIds[0]}),[]);
});
test('真实 MCP 旧 JSON 入口可提交回顾，错误令牌和跨会话被硬拒绝',async t=>{
  const {tree}=fixture(t),offer=offered(tree),state={memoryScope:A,recentMessages:messages()};
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-style-mcp-'));fs.cpSync(path.resolve(import.meta.dirname,'../src'),path.join(dir,'src'),{recursive:true});fs.writeFileSync(path.join(dir,'package.json'),'{"type":"module"}');
  const server=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;await handleMemoryRoute({req,url:new URL(req.url,'http://localhost'),readBody:async()=>JSON.parse(raw),sendJson:(data,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));},tree,getState:()=>state,tokenOk:(key,token)=>key===A&&token==='fixture-token',sessionAllowed:key=>key===A,toolEnabled:()=>true});});
  server.listen(0,'127.0.0.1');await once(server,'listening');fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify({consolePort:server.address().port,socialV2:{toolProfile:'minimal'}}));
  const deps=process.env.QQ_BRIDGE_DEPENDENCIES||path.resolve(import.meta.dirname,'..'),require=createRequire(path.join(deps,'package.json'));
  const {Client}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')).href),{StdioClientTransport}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href);
  const loader=path.join(dir,'deps.mjs');fs.writeFileSync(loader,`import {registerHooks} from 'node:module';const parentURL=${JSON.stringify(pathToFileURL(path.join(deps,'package.json')).href)};registerHooks({resolve(s,c,next){try{return next(s,c)}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&!s.startsWith('.')&&!s.startsWith('/')&&!s.includes(':'))return next(s,{...c,parentURL});throw e}}});`);
  const client=new Client({name:'style-review-test',version:'1.0.0'});
  try{
    await client.connect(new StdioClientTransport({command:process.execPath,args:['--import',pathToFileURL(loader).href,path.join(dir,'src/mcp-snowluma-safe.js')]}));
    const args={key:A,token:'fixture-token',category:'activeTopic',content:JSON.stringify({_memoryTree:1,action:'review',reviewId:offer.id,candidates:[candidate()]})};
    for(const patch of [{token:'wrong-token'},{key:B}])assert.equal((await client.callTool({name:'qq_memory_append',arguments:{...args,...patch}})).isError,true);
    const result=await client.callTool({name:'qq_memory_append',arguments:args});assert.ok(!result.isError,result.content?.[0]?.text);assert.equal(JSON.parse(result.content[0].text).needsAdminConfirmation,true);
    assert.equal((await client.callTool({name:'qq_memory_append',arguments:args})).isError,undefined);
  }finally{await client.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(dir).startsWith('qq-style-mcp-'));fs.rmSync(dir,{recursive:true,force:true});}
});

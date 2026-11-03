import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

// The background worker can search/fetch public pages only. No QQ or model tools.
export async function readPublicLearningDocument({root,query,urls=[],limit=2}){
 if(limit<(urls.length?1:2))throw new Error('当前搜索预算不足以完成搜索与正文阅读');
 const client=new Client({name:'qq-learning-reader',version:'1.0.0'});
 const transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'src/mcp-web-search-safe.js')],cwd:root,stderr:'pipe'});
 const abort=AbortSignal.timeout(45000);const stop=()=>void client.close().catch(()=>{});abort.addEventListener('abort',stop,{once:true});
 try{
  await client.connect(transport);
  if(urls.length){let last='正文不可用',requests=0;for(const url of urls.slice(0,limit)){
   requests++;const result=await client.callTool({name:'web_fetch',arguments:{url}},undefined,{timeout:22000});
   if(result.isError){last='公开正文抓取失败';continue;}
   const doc=JSON.parse(result.content.find(x=>x.type==='text')?.text||'{}');
   if(Number(doc.statusCode)===200&&doc.body)return {url:doc.url,body:doc.body,requests};
   last='来源状态 '+doc.statusCode;
  }throw new Error(last);}
  const search=await client.callTool({name:'web_search',arguments:{query}},undefined,{timeout:20000});
  if(search.isError)throw new Error('公开搜索失败');
  const found=JSON.parse(search.content.find(x=>x.type==='text')?.text||'{}');
  const target=found.results?.find(x=>/^https?:\/\//.test(x.url));if(!target)throw new Error('没有可阅读的公开结果');
  const fetched=await client.callTool({name:'web_fetch',arguments:{url:target.url}},undefined,{timeout:22000});
  if(fetched.isError)throw new Error('公开正文抓取失败');
  const doc=JSON.parse(fetched.content.find(x=>x.type==='text')?.text||'{}');
  if(Number(doc.statusCode)!==200||!doc.body)throw new Error('公开正文不可用：状态 '+doc.statusCode);
  return {url:doc.url,body:doc.body,requests:2};
 }finally{abort.removeEventListener('abort',stop);await client.close().catch(()=>{});}
}

export function createLearningRunner({learning,root,scopes,getMessages,isPaused,canRun,read=readPublicLearningDocument,log=()=>{}}){
 let running=false,closed=false,scheduledTicks=0,manualTicks=0,completedJobs=0,failedJobs=0,lastTickAt=null;
 async function tick(onlyScope=null){
  if(onlyScope)manualTicks++;else scheduledTicks++;lastTickAt=Date.now();
  if(running||closed||isPaused())return {skipped:true};running=true;
  try{
   for(const scope of scopes().filter(scope=>!onlyScope||scope===onlyScope)){
    if(closed||isPaused())break;if(!learning.enabled(scope)||!canRun(scope))continue;
    try{learning.maintain(scope);learning.mine(scope,getMessages(scope));}catch(e){log('局部表达回顾暂缓：'+String(e.message).slice(0,120));}
    const topic=learning.nextTopic(scope);if(!topic)continue;
    const job=learning.reserve(scope,topic.id);if(!job)continue;
    try{const doc=await read({root,query:topic.query,urls:topic.urls||[],limit:job.searchLimit});if(closed||isPaused()||!learning.enabled(scope))throw new Error('学习已关闭，跳过保存');learning.learnDocument(job,doc,doc.body);learning.finish(job);completedJobs++;log('自主学习完成一份公开阅读笔记');}
    catch(e){learning.finish(job,e.message);failedJobs++;log('自主学习本轮停止：'+String(e.message).slice(0,160));}
    break; // one global network job per scheduler tick
   }
   return {running:false};
  }finally{running=false;}
 }
 return {tick,status:()=>({running,closed,scheduledTicks,manualTicks,completedJobs,failedJobs,lastTickAt}),close:()=>{closed=true;}};
}

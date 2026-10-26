import {Worker} from 'node:worker_threads';
import fs from 'node:fs';
export const EMBEDDING_MODEL='Xenova/bge-small-zh-v1.5@75c43b069aac4d136ba6bc1122f995fedcfd2781:q8:cls:256';
export function createLocalEmbeddings({runtimeDir,modelDir,log=()=>{}}){
  const pending=new Map();let nextId=0,worker,closed=false;
  const status={state:'loading',model:EMBEDDING_MODEL,dimensions:512,loadMs:null,error:null,calls:0};
  let resolveReady,rejectReady;
  const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});ready.catch(()=>{});
  const fail=error=>{status.state='error';status.error=String(error.message||error).slice(0,240);rejectReady(error);for(const request of pending.values()){clearTimeout(request.timer);request.reject(error);}pending.clear();log('本地语义检索不可用，保留关键词检索：'+status.error);};
  if(!fs.existsSync(modelDir)||!fs.existsSync(runtimeDir)){fail(new Error('本地模型或运行库缺失'));}
  else{
    worker=new Worker(new URL('./memory-embedding-worker.js',import.meta.url),{workerData:{runtimeDir,modelDir}});
    worker.on('message',message=>{
      if(message.ready){status.state='ready';status.loadMs=message.loadMs;resolveReady();worker.unref();return;}
      const request=pending.get(message.id);if(!request)return;pending.delete(message.id);clearTimeout(request.timer);
      if(message.error)request.reject(new Error(message.error));else request.resolve(message.vectors);
    });
    worker.on('error',fail);worker.on('exit',code=>{if(!closed)fail(new Error('本地嵌入进程退出：'+code));});
  }
  async function embed(texts,{query=false}={}){
    if(closed)throw new Error('嵌入服务已关闭');await ready;
    if(status.state!=='ready')throw new Error(status.error||'嵌入服务未就绪');
    if(!Array.isArray(texts)||texts.length<1||texts.length>16)throw new Error('一次嵌入需1~16条文本');
    if(pending.size>=64)throw new Error('本地嵌入队列已满');
    const id=++nextId;status.calls++;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new Error('本地嵌入超时'));},15000);pending.set(id,{resolve,reject,timer});worker.postMessage({id,texts,query});});
  }
  return {embed,ready,status:()=>({...status,pending:pending.size}),close:async()=>{closed=true;for(const item of pending.values()){clearTimeout(item.timer);item.reject(new Error('嵌入服务关闭'));}pending.clear();if(worker)await worker.terminate();}};
}

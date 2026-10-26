// 仅 CPU 本地推理。没有联网、子进程或聊天工具能力。
import {parentPort,workerData} from 'node:worker_threads';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
globalThis.fetch=async()=>{throw new Error('本地嵌入进程禁止联网');};
const started=Date.now();
const {pipeline,env}=await import(pathToFileURL(path.join(workerData.runtimeDir,'node_modules/@huggingface/transformers/dist/transformers.node.mjs')).href);
env.allowRemoteModels=false;env.allowLocalModels=true;env.useFSCache=false;
const model=await pipeline('feature-extraction',workerData.modelDir+path.sep,{dtype:'q8',device:'cpu',local_files_only:true,session_options:{intraOpNumThreads:2,interOpNumThreads:1}});
parentPort.postMessage({ready:true,loadMs:Date.now()-started});
let chain=Promise.resolve();
parentPort.on('message',message=>{
  chain=chain.then(async()=>{
    try{
      const texts=message.texts.map(s=>(message.query?'为这个句子生成表示以用于检索相关文章：':'')+String(s).slice(0,1200));
      const result=await model(texts,{pooling:'cls',normalize:true,truncation:true,max_length:256});
      parentPort.postMessage({id:message.id,vectors:result.tolist()});
    }catch(error){parentPort.postMessage({id:message.id,error:error.message});}
  });
});

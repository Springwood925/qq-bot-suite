// 首次安装才联网；检索 worker 本身禁止联网。清单只包含公开模型的固定版本与哈希。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const manifests=path.join(root,'runtime-manifests/memory');
const manifest=JSON.parse(fs.readFileSync(path.join(manifests,'model.json'),'utf8'));
const runtime=path.resolve(process.env.QQ_MEMORY_RUNTIME||path.join(root,'local-memory-runtime'));
const model=path.resolve(process.env.QQ_MEMORY_MODEL||path.join(root,'models/bge-small-zh-v1.5'));
const verifyOnly=process.argv.includes('--verify-only');
const digest=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
const matches=(file,item)=>fs.existsSync(file)&&fs.statSync(file).size===item.bytes&&digest(fs.readFileSync(file))===item.sha256;
if(!verifyOnly){
  fs.mkdirSync(runtime,{recursive:true});
  for(const name of ['package.json','package-lock.json']){
    const target=path.join(runtime,name),source=fs.readFileSync(path.join(manifests,name));
    if(fs.existsSync(target)&&!fs.readFileSync(target).equals(source))throw new Error('已有本地运行库清单不同，请先备份并移走旧运行库，避免覆盖');
    if(!fs.existsSync(target))fs.writeFileSync(target,source);
  }
  const npmCli=process.env.npm_execpath||path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
  const args=['ci','--omit=dev','--no-audit','--no-fund'];
  if(fs.existsSync(npmCli))execFileSync(process.execPath,[npmCli,...args],{cwd:runtime,stdio:'inherit',windowsHide:true});
  else if(process.platform==='win32')execFileSync('cmd.exe',['/d','/s','/c','npm ci --omit=dev --no-audit --no-fund'],{cwd:runtime,stdio:'inherit',windowsHide:true});
  else execFileSync('npm',args,{cwd:runtime,stdio:'inherit'});
}
for(const item of manifest.files){
  const target=path.resolve(model,item.path),rel=path.relative(model,target);
  if(rel.startsWith('..')||path.isAbsolute(rel))throw new Error('模型清单路径越界');
  if(matches(target,item))continue;
  if(verifyOnly)throw new Error('模型文件缺失或校验失败：'+item.path);
  if(fs.existsSync(target))throw new Error('已有模型文件不同，停止覆盖：'+item.path);
  const url=manifest.source+'/resolve/'+manifest.revision+'/'+item.path;
  const response=await fetch(url,{signal:AbortSignal.timeout(180000)});
  if(!response.ok)throw new Error('模型下载失败：'+item.path+' HTTP '+response.status);
  let bytes=0;const chunks=[];
  for await(const chunk of response.body){bytes+=chunk.length;if(bytes>item.bytes)throw new Error('模型下载大小异常：'+item.path);chunks.push(chunk);}
  const buffer=Buffer.concat(chunks);
  if(bytes!==item.bytes||digest(buffer)!==item.sha256)throw new Error('模型校验失败：'+item.path);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.writeFileSync(target,buffer,{flag:'wx'});
}
if(!fs.existsSync(path.join(runtime,'node_modules/@huggingface/transformers/dist/transformers.node.mjs')))throw new Error('本地嵌入运行库入口缺失');
console.log(verifyOnly?'本地运行库入口与全部模型文件校验通过':'本地运行库与模型安装完成，请重启桥接并检查索引状态');

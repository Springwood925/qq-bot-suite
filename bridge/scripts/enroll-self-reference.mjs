// 仅供管理员在本机运行；不注册为群聊工具，不读取聊天或令牌。
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {loadIdentityProfile} from '../src/self-image-identity.js';
const options={};for(let i=2;i<process.argv.length;i+=2){const key=process.argv[i],value=process.argv[i+1];if(!['--root','--image','--id','--kind','--caption'].includes(key)||!value)throw Error('参数：--root 桥接目录 --image 本机图片 --id 标识 --kind self或not_self --caption 说明');options[key]=value;}
if(!options['--root']||!options['--image']||!/^[a-z][a-z0-9_-]{0,47}$/.test(options['--id']||'')||!['self','not_self'].includes(options['--kind']))throw Error('需要桥接目录、图片、稳定标识及self/not_self分类');
const root=path.resolve(options['--root']),source=path.resolve(options['--image']),buffer=fs.readFileSync(source);if(buffer.length<12||buffer.length>20*1024*1024)throw Error('参考图片大小无效');
const ext=buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png':buffer[0]===255&&buffer[1]===216?'jpg':buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP'?'webp':'';if(!ext)throw Error('仅支持PNG/JPEG/WebP静态参考图');
const file=path.join(root,'self-identity.json'),old=fs.existsSync(file)?fs.readFileSync(file):null,config=old?JSON.parse(old.toString('utf8').replace(/^\uFEFF/,'')):{version:1,enabled:true,name:'机器人自身形象',features:[],references:[]};
if(!Array.isArray(config.references))throw Error('现有清单无效');if(config.references.some(r=>r.id===options['--id']))throw Error('标识已存在；请先人工核对原记录，不直接覆盖');
const digest=crypto.createHash('sha256').update(buffer).digest('hex');if(config.references.some(r=>r.sha256===digest))throw Error('这张参考图已经登记');if(config.references.length>=4)throw Error('最多四张参考图，请先人工整理清单');
const directory=path.join(root,'assets/self-identity');fs.mkdirSync(directory,{recursive:true});const realAssets=fs.realpathSync(path.join(root,'assets')),realDirectory=fs.realpathSync(directory),assetRel=path.relative(fs.realpathSync(root),realAssets),rel=path.relative(realAssets,realDirectory);if(!assetRel||assetRel.startsWith('..')||path.isAbsolute(assetRel)||rel.startsWith('..')||path.isAbsolute(rel))throw Error('参考目录越界');
const destination=path.join(realDirectory,digest+'.'+ext);const created=!fs.existsSync(destination);if(created)fs.writeFileSync(destination,buffer,{flag:'wx'});
config.enabled=true;config.references.push({id:options['--id'],kind:options['--kind'],file:'assets/self-identity/'+path.basename(destination),sha256:digest,confirmed:true,caption:String(options['--caption']||'管理员在本机确认的角色参考图').slice(0,500)});
const temp=file+'.'+crypto.randomUUID()+'.tmp';
try{fs.writeFileSync(temp,JSON.stringify(config,null,2)+'\n');fs.renameSync(temp,file);if(loadIdentityProfile(root).status!=='ready')throw Error('清单校验失败，已回退');}
catch(error){if(old)fs.writeFileSync(file,old);else if(fs.existsSync(file))fs.unlinkSync(file);if(created)fs.unlinkSync(destination);if(fs.existsSync(temp))fs.unlinkSync(temp);throw error;}
console.log(JSON.stringify({saved:true,id:options['--id'],kind:options['--kind'],referenceCount:config.references.length,restartRequired:false}));

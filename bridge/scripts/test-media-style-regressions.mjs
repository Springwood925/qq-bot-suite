import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {createMemoryTree} from '../src/memory-tree.js';import {isStandaloneSticker} from '../src/media-attention.js';import {selectWakeContext} from '../src/wake-context.js';
const now=Date.now(),scope='group:11111';
test('only explicitly identified standalone stickers are suppressed',()=>{
 assert.equal(isStandaloneSticker([{type:'image',data:{sub_type:1}}]),true);
 assert.equal(isStandaloneSticker([{type:'face',data:{id:1}}]),true);
 assert.equal(isStandaloneSticker([{type:'image',data:{subType:1}},{type:'text',data:{text:'这张图什么意思？'}}]),false);
 assert.equal(isStandaloneSticker([{type:'image',data:{url:'x'}}]),false);
 assert.equal(isStandaloneSticker([{type:'face',data:{id:1}},{type:'at',data:{qq:'12345'}}]),false);
});
test('realistic self messages without seq can produce a source-checked review candidate',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-style-real-'));const tree=createMemoryTree({file:path.join(dir,'test.sqlite'),now:()=>now});t.after(()=>{tree.close();fs.rmSync(dir,{recursive:true,force:true})});tree.baselineStyleReview(scope,[]);
 const messages=[];for(let i=1;i<=15;i++){messages.push({seq:i,time:now-200000+i*5000,messageId:'in'+i,userId:'11111',sender:'甲',plain:'真实收到消息'+i,isSelf:false});if(i%3===0)messages.push({time:now-199000+i*5000,messageId:'-'+(100+i),plain:'真实成功回复'+i,sender:'我',isSelf:true});}
 const visible=selectWakeContext({recentMessages:messages,unread:[]},{recentReadLimit:40}).recent;const offer=tree.offerStyleReview(scope,visible);assert.ok(offer);assert.match(offer.prompt,/selfRefs/);
 const req={action:'review',reviewId:offer.id,candidates:[{content:'回答时先承接问题再展开',criterion:'context',sourceSeqs:[1,2,3],selfRefs:['-103','-106']}]};
 assert.throws(()=>tree.execute(scope,{...req,candidates:[{...req.candidates[0],selfRefs:['-103','invented']}]},{messages:visible}),/来源/);
 const outcome=tree.execute(scope,req,{messages:visible});assert.equal(outcome.needsAdminConfirmation,true);const item=tree.recall(scope,{id:outcome.candidateIds[0]})[0];assert.equal(item.status,'unverified');assert.equal(item.metadata.styleReview.selfSources.length,2);
});

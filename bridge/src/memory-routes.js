// 外层桥接已校验控制台令牌、暂停状态及工作模式；这里再做会话/工具权限验证。
export const MEMORY_PATHS = new Set(['/api/socialV2/memory-admin','/api/socialV2/memory-tree','/api/socialV2/memory-append','/api/socialV2/memory-update','/api/socialV2/memory','/api/socialV2/memory-remove','/api/socialV2/memory-clear']);
export async function handleMemoryRoute({req,url,readBody,sendJson,tree,getState,tokenOk,sessionAllowed,toolEnabled,ownerQQ,saveState,updateGoal}) {
  try {
    const query=req.method==='GET';
    if ((url.pathname==='/api/socialV2/memory' && !query) || (url.pathname!=='/api/socialV2/memory' && req.method!=='POST')) {sendJson({ok:false,error:'请求方法无效'},405);return;}
    const body=query?Object.fromEntries(url.searchParams):await readBody();
    const token=req.headers['x-agent-token'];
    if(token==='') {sendJson({ok:false,error:'agent token 不能为空'},403);return;}
    if(url.pathname==='/api/socialV2/memory-admin'){
      if(token!==undefined){sendJson({ok:false,error:'记忆管理仅限 DSH 插件详情页或已授权控制台'},403);return;}
      if(body.action==='goal'){
        if(!updateGoal)throw new Error('目标管理未连接');
        const st=getState(String(body.key||''));
        const existing=tree.recall(st.memoryScope,{id:body.id})[0];
        if(existing?.kind!=='goal')throw new Error('找不到目标记录');
        const goalId=existing.metadata?.goalId;
        const result=updateGoal(st,goalId,body.goalAction,body.nextStep);
        tree.syncGoals(st.memoryScope,result.goals);saveState();
        const records=await tree.admin(st.memoryScope,{action:'list',kind:'goal',limit:50});
        const current=records.records.find(r=>r.factKey==='goal:'+goalId);
        sendJson({ok:true,record:current});return;
      }
      const result=await tree.admin(String(body.key||''),body);sendJson({ok:true,...result});return;
    }
    const key=String(body.key??'').trim();
    if(!key)throw Object.assign(new Error('key 不能为空'),{statusCode:400});
    if(token && (!tokenOk(key,token)||!sessionAllowed(key)||!toolEnabled('memory'))) {sendJson({ok:false,error:'会话令牌无效、目标未授权或记忆工具未启用'},403);return;}
    const st=getState(key); const scope=st.memoryScope;
    const context={messages:st.recentMessages,isOwner:id=>String(id)===String(ownerQQ)};
    const category=String(body.category||'');
    if(category&&!tree.categoryKind(category))throw Object.assign(new Error('记忆类别无效'),{statusCode:400});
    const finish=result=>sendJson({ok:true,key:scope,...result});
    if(url.pathname==='/api/socialV2/memory-tree') {finish(await tree.execute(scope,body,context));return;}
    if(url.pathname==='/api/socialV2/memory-append') {
      if(!category||!String(body.content||'').trim())throw Object.assign(new Error('category/content 不能为空'),{statusCode:400});
      const result=await tree.legacyAppend(scope,category,String(body.content),body.extra||{},context);
      finish({...result,memory:tree.format(scope,{messages:st.recentMessages,compact:true})});return;
    }
    if(url.pathname==='/api/socialV2/memory') {
      finish({category,records:tree.recall(scope,{kind:tree.categoryKind(category),includeUnverified:true,limit:20}),formatted:tree.format(scope,{messages:st.recentMessages,compact:false}),raw:tree.projection(scope,category)});return;
    }
    if(url.pathname==='/api/socialV2/memory-clear') {
      if(token) {sendJson({ok:false,error:'批量清空仅限管理端；按本人明确要求遗忘单条请用记忆树 forget + sourceSeq'},403);return;}
      tree.clear(scope,tree.categoryKind(category));
      if(!category||category==='activeTopic')st.activeTopics=[];
      if(!category||category==='pendingThought')st.pendingThoughts=[];
      if(!category||category==='memberImpression')st.memberImpressions={};
      saveState();finish({cleared:true});return;
    }
    if(!category)throw Object.assign(new Error('category 不能为空'),{statusCode:400});
    const records=tree.legacySelect(scope,category,String(body.oldContent??body.content??''),String(body.target||''));
    if(!records.length) {sendJson({ok:false,error:'找不到当前有效的记忆；请按 ID 查询'},404);return;}
    if(url.pathname==='/api/socialV2/memory-update') {
      if(token) {sendJson({ok:false,error:'机器人修正请用记忆树 store，提供 replacesId、原 factKey 和真实 sourceSeq'},409);return;}
      if(category==='memberImpression'&&records.length>1){sendJson({ok:false,error:'该成员有多条记忆，请先按原文或 ID 明确要修改的记录'},409);return;}
      const changed=records.map(r=>tree.adminRevise(scope,r.id,{content:body.newContent,nextStep:body.newExtra?.pendingQuestion,validUntil:body.newExtra?.expiresAtMs?Date.now()+Number(body.newExtra.expiresAtMs):undefined}));
      finish({records:changed});return;
    }
    if(url.pathname==='/api/socialV2/memory-remove') {
      if(token){sendJson({ok:false,error:'遗忘请用记忆树 forget，提供 id 和本人或管理员要求遗忘的 sourceSeq'},409);return;}
      for(const r of records)tree.forget(scope,r.id);
      finish({forgotten:records.length});return;
    }
  } catch(error) {sendJson({ok:false,error:error?.message||'记忆操作失败'},error?.statusCode||400);}
}

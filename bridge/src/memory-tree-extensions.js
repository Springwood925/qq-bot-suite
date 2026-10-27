// 二、三期：可审阅的自身经历、观察与表达候选，以及会话内的本地混合检索。
import crypto from 'node:crypto';
const hash=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const clean=(value,max=600)=>String(value??'').replace(/[\r\n\t]+/g,' ').trim().slice(0,max);
const fail=(message,statusCode=400)=>{throw Object.assign(new Error(message),{statusCode});};
const RELATIONS=new Set(['supports','related','follows','contradicts','goal']);
const SYSTEM_KINDS=new Set(['experience','observation','goal']);
export function createMemoryExtensions({db,now,text,scopeKey,node,publicNode,transaction,sourceFor,insertSource,recall,forget,adminRevise,embeddings,log=()=>{},words}){
  db.exec(`CREATE TABLE IF NOT EXISTS node_details(node_id TEXT PRIMARY KEY REFERENCES nodes(id),metadata TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS relation_types(node_id TEXT NOT NULL,related_id TEXT NOT NULL,relation TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(node_id,related_id));
    CREATE TABLE IF NOT EXISTS memory_vectors(node_id TEXT PRIMARY KEY REFERENCES nodes(id),scope TEXT NOT NULL,content_hash TEXT NOT NULL,model TEXT NOT NULL,dimensions INTEGER NOT NULL,embedding BLOB NOT NULL,updated_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS vectors_scope ON memory_vectors(scope,model);
    CREATE TABLE IF NOT EXISTS memory_metrics(day TEXT NOT NULL,scope TEXT NOT NULL,action TEXT NOT NULL,count INTEGER NOT NULL DEFAULT 0,total_ms INTEGER NOT NULL DEFAULT 0,result_chars INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(day,scope,action));
    CREATE TABLE IF NOT EXISTS memory_reviews(id TEXT PRIMARY KEY,scope TEXT NOT NULL,node_id TEXT NOT NULL,action TEXT NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS retrieval_cases(id TEXT PRIMARY KEY,scope TEXT NOT NULL,query TEXT NOT NULL,expected_ids TEXT NOT NULL,created_at INTEGER NOT NULL);`);
  const queryCache=new Map(),prepared=new Map();let indexing=null,indexed=0,closed=false,indexTimer=null;
  function settings(){const row=db.prepare("SELECT value FROM meta WHERE key='settings:v2'").get();return {semantic:true,autoInject:true,styleLearning:true,styleReview:true,imageMemory:true,experienceMemory:true,...(row?JSON.parse(row.value):{})};}
  function setSettings(patch){const value=settings();for(const key of ['semantic','autoInject','styleLearning','styleReview','imageMemory','experienceMemory'])if(patch[key]!==undefined){if(typeof patch[key]!=='boolean')fail('设置必须为布尔值');value[key]=patch[key];}db.prepare("INSERT INTO meta VALUES ('settings:v2',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(value));queryCache.clear();prepared.clear();return value;}
  const metadata=id=>{const row=db.prepare('SELECT metadata FROM node_details WHERE node_id=?').get(id);return row?JSON.parse(row.metadata):{};};
  const saveMetadata=(id,value)=>db.prepare('INSERT INTO node_details VALUES (?,?) ON CONFLICT(node_id) DO UPDATE SET metadata=excluded.metadata').run(id,JSON.stringify(value));
  function relations(row){return db.prepare("SELECT l.related_id,coalesce(t.relation,'supports') AS relation FROM links l LEFT JOIN relation_types t ON t.node_id=l.node_id AND t.related_id=l.related_id WHERE l.scope=? AND l.node_id=?").all(row.scope,row.id).map(r=>({id:r.related_id,type:r.relation}));}
  function details(row,full){const m=metadata(row.id);const verified=row.status!=='unverified'&&(['statement','tool','visual','state'].includes(row.evidence)||(row.evidence==='admin'&&m.verified===true));return {verified,tags:m.tags||[],participants:m.participants||[],relations:relations(row),...(m.uncertain?{uncertain:m.uncertain}:{}),...(full?{metadata:m}:{})};}
  function onAdminRevise(oldId,newId,patch){saveMetadata(newId,{...metadata(oldId),verified:patch.confirmed===true,adminConfirmedAt:patch.confirmed===true?now():null});}
  function validateStore(request,context,scope){
    if(request.sourceSeqs!==undefined&&!Array.isArray(request.sourceSeqs))fail('sourceSeqs 必须是数组');
    if(SYSTEM_KINDS.has(request.kind))fail('自身经历、图像观察与目标由真实工具结果自动登记，不能手写成亲身经历');
    if(request.kind==='style'){
      if(clean(request.content,601).length>100)fail('表达习惯请用100字以内写清一条原则，不存长篇口癖模板');
      if(!settings().styleLearning)fail('表达习惯学习已关闭',403);
      const seqs=[...new Set([request.sourceSeq,...(request.sourceSeqs||[])])].slice(0,12);
      if(seqs.length<3)fail('表达习惯候选至少需要3条不同来源；不能由单句生成固定口癖');
      for(const sourceSeq of seqs)sourceFor(scope,{sourceSeq},context);
      return {...request,evidence:'inference',sourceSeqs:seqs};
    }
    if(request.sourceSeqs!==undefined&&!Array.isArray(request.sourceSeqs))fail('sourceSeqs 必须是数组');
    return request;
  }
  function onStored(id,request,context,scope){
    const sources=(request.sourceSeqs||[]).map(sourceSeq=>sourceFor(scope,{sourceSeq},context));
    for(const source of sources)insertSource(source);
    saveMetadata(id,{...metadata(id),tags:(Array.isArray(request.tags)?request.tags:[]).map(s=>text(s,40)).filter(Boolean).slice(0,8),participants:(Array.isArray(request.participants)?request.participants:[]).map(String).filter(s=>/^[1-9]\d{4,19}$/.test(s)).slice(0,12),...(sources.length?{sampleSources:sources.map(s=>({id:s.id,messageRef:s.origin,userId:s.senderId,at:s.at,excerpt:text(s.excerpt,100)})),styleBasis:'多条交流的候选规律；不复制真人口癖，不改变人格或权限'}:{})});
    changed();
  }
  function metric(scope,action,ms=0,chars=0){db.prepare('INSERT INTO memory_metrics VALUES (?,?,?,?,?,?) ON CONFLICT(day,scope,action) DO UPDATE SET count=count+1,total_ms=total_ms+excluded.total_ms,result_chars=result_chars+excluded.result_chars').run(new Date(now()).toISOString().slice(0,10),scope,action,1,Math.round(ms),chars);}
  function audit(scope,id,action,reason=''){db.prepare('INSERT INTO memory_reviews VALUES (?,?,?,?,?,?)').run(crypto.randomUUID(),scope,id,action,text(reason,240),now());}
  function changed(){prepared.clear();if(embeddings&&!closed&&!indexTimer){indexTimer=setTimeout(()=>{indexTimer=null;if(!closed)reindex().catch(error=>log('记忆索引待重试：'+error.message));},20);indexTimer.unref();}}
  function indexText(row){const m=metadata(row.id);return row.content+(m.visibleText?.length?'；可见文字：'+m.visibleText.join('；'):'')+(row.next_step?'；下一步：'+row.next_step:'')+(m.tags?.length?'；关键词：'+m.tags.join('，'):'')+(m.uncertain?.length?'；未确认：'+m.uncertain.join('；'):'');}
  function candidates(scope,{includeUnverified=false,kind,subjectUserIds}={}){
    const args=[scope,now()];let sql="SELECT nodes.* FROM nodes LEFT JOIN node_details d ON d.node_id=nodes.id WHERE scope=? AND status IN ('active','done','archived'"+(includeUnverified?",'unverified'":'')+") AND (valid_until IS NULL OR valid_until>?)";
    if(!includeUnverified)sql+=" AND evidence NOT IN ('legacy','reported','inference','joke') AND (evidence!='admin' OR coalesce(json_extract(d.metadata,'$.verified'),0)=1)";
    if(kind){sql+=' AND kind=?';args.push(kind);}
    if(subjectUserIds?.length){sql+=' AND subject_id IN ('+subjectUserIds.map(()=>'?').join(',')+')';args.push(...subjectUserIds.map(String));}
    return db.prepare(sql+' ORDER BY updated_at DESC').all(...args);
  }
  async function reindex(scope){
    if(!embeddings||!settings().semantic||closed)return {indexed:0,available:false};
    if(indexing){await indexing;return reindex(scope);}
    indexing=(async()=>{
      const args=scope?[scope]:[];
      const rows=db.prepare("SELECT n.* FROM nodes n WHERE n.status NOT IN ('forgotten','superseded')"+(scope?' AND n.scope=?':'')+' ORDER BY n.updated_at DESC').all(...args);
      let added=0;
      for(let at=0;at<rows.length&&!closed;at+=16){
        const batch=rows.slice(at,at+16).filter(row=>{const old=db.prepare('SELECT content_hash,model FROM memory_vectors WHERE node_id=? AND scope=?').get(row.id,row.scope);return !old||old.content_hash!==hash(indexText(row))||old.model!==embeddings.status().model;});
        if(!batch.length){await new Promise(resolve=>setImmediate(resolve));continue;}
        const vectors=await embeddings.embed(batch.map(indexText));
        for(let i=0;i<batch.length&&!closed;i++){
          const row=batch[i],current=db.prepare('SELECT * FROM nodes WHERE id=? AND scope=?').get(row.id,row.scope);
          if(!current||['forgotten','superseded'].includes(current.status)||indexText(current)!==indexText(row))continue;
          const vector=vectors[i];if(vector.length!==512||vector.some(v=>!Number.isFinite(v)))throw new Error('本地模型向量格式无效');
          db.prepare('INSERT INTO memory_vectors VALUES (?,?,?,?,?,?,?) ON CONFLICT(node_id) DO UPDATE SET content_hash=excluded.content_hash,model=excluded.model,dimensions=excluded.dimensions,embedding=excluded.embedding,updated_at=excluded.updated_at').run(row.id,row.scope,hash(indexText(row)),embeddings.status().model,512,Buffer.from(new Float32Array(vector).buffer),now());added++;
        }
      }
      if(!closed)db.prepare("DELETE FROM memory_vectors WHERE node_id IN (SELECT id FROM nodes WHERE status IN ('forgotten','superseded'))").run();indexed+=added;return {indexed:added,available:true};
    })();
    try{return await indexing;}finally{indexing=null;}
  }
  async function queryVector(q){if(queryCache.has(q))return queryCache.get(q);const vector=(await embeddings.embed([q],{query:true}))[0];queryCache.set(q,vector);if(queryCache.size>100)queryCache.delete(queryCache.keys().next().value);return vector;}
  async function search(scope,options={}){
    scope=scopeKey(scope);const started=now();
    if(options.id)return {records:recall(scope,options),method:'id'};
    const q=text(options.q,800);const limit=Math.min(20,Math.max(1,Number(options.limit)||8));
    const lexical=recall(scope,{...options,limit:20});
    const eligible=candidates(scope,options).filter(row=>(!options.status||options.status==='all'||row.status===options.status)&&(!options.person||row.subject_id===String(options.person)));const allowed=new Map(eligible.map(r=>[r.id,r]));
    const textById=new Map(eligible.map(row=>[row.id,indexText(row).toLowerCase()]));
    const terms=words(q);const idf=new Map(terms.map(term=>[term,Math.log(1+(eligible.length+.5)/(eligible.filter(row=>textById.get(row.id).includes(term)).length+.5))]));
    const totalIdf=[...idf.values()].reduce((sum,n)=>sum+n,0)||1;
    const scores=new Map();for(let i=0;i<lexical.length;i++)if(allowed.has(lexical[i].id)){
      const content=textById.get(lexical[i].id);const coverage=terms.reduce((sum,term)=>sum+(content.includes(term)?idf.get(term):0),0)/totalIdf;
      scores.set(lexical[i].id,{lexical:q?coverage:1/(i+1),semantic:0,graph:0});
    }
    let method='keyword',semanticError=null;
    if(q&&settings().semantic&&embeddings){
      try{
        await reindex(scope);const vector=await queryVector(q);
        // 先用会话和状态取允许的节点；绝不先全库向量搜索再过滤。
        const vectors=db.prepare('SELECT * FROM memory_vectors WHERE scope=? AND model=?').all(scope,embeddings.status().model);
        for(const stored of vectors){
          const row=allowed.get(stored.node_id);if(!row||stored.content_hash!==hash(indexText(row)))continue;
          const bytes=Buffer.from(stored.embedding);let cosine=0;for(let i=0;i<vector.length;i++)cosine+=vector[i]*bytes.readFloatLE(i*4);
          if(cosine<.52)continue;
          const score=scores.get(row.id)||{lexical:0,semantic:0,graph:0};score.semantic=cosine;scores.set(row.id,score);
        }
        method='hybrid';
      }catch(error){semanticError=error.message;}
    }
    const named=q?db.prepare('SELECT user_id,aliases FROM people WHERE scope=?').all(scope).filter(person=>q.includes(person.user_id)||JSON.parse(person.aliases).some(alias=>alias.length>=2&&q.includes(alias))).map(person=>person.user_id):[];
    const persons=new Set([...(options.subjectUserIds||[]).map(String),...named]);
    const ranked=()=>[...scores].map(([id,score])=>{
      const row=allowed.get(id);const days=Math.max(0,(now()-row.updated_at)/86400000);
      const recency=1/(1+days/(row.status==='active'&&['event','agreement','goal'].includes(row.kind)?180:60));
      return {id,...score,total:score.lexical*.24+Math.max(0,(score.semantic-.4))*.9+score.graph+(persons.has(row.subject_id)?.08:0)+recency*.025};
    }).sort((a,b)=>b.total-a.total||allowed.get(b.id).updated_at-allowed.get(a.id).updated_at);
    const anchors=ranked().slice(0,4);
    for(const anchor of anchors){
      for(const edge of db.prepare("SELECT l.node_id,l.related_id,coalesce(t.relation,'supports') AS relation FROM links l LEFT JOIN relation_types t ON t.node_id=l.node_id AND t.related_id=l.related_id WHERE l.scope=? AND (l.node_id=? OR l.related_id=?)").all(scope,anchor.id,anchor.id)){
        const other=edge.node_id===anchor.id?edge.related_id:edge.node_id;if(!allowed.has(other))continue;
        const value=scores.get(other)||{lexical:0,semantic:0,graph:0};value.graph=Math.max(value.graph,.08);scores.set(other,value);
      }
    }
    const ranking=ranked().slice(0,limit);const records=ranking.map(value=>({...publicNode(allowed.get(value.id)),retrieval:{method,semantic:+value.semantic.toFixed(4),keyword:value.lexical>0,related:value.graph>0}}));
    if(!options.quiet)metric(scope,'recall:'+method,now()-started,JSON.stringify(records).length);
    return {records,method,...(semanticError?{note:'本地语义暂不可用，本次保留关键词结果'}:{})};
  }
  function effectiveRelation(scope,fromId,toId,type){
    const from=node(fromId,scope),to=node(toId,scope);if(from.id===to.id||from.root_id===to.root_id)fail('不能关联自身或自身旧版本');
    if([from,to].some(r=>['forgotten','superseded'].includes(r.status)))fail('只能关联当前有效的记录');
    if(!RELATIONS.has(type))fail('关联类型无效');
    if(type==='supports'){
      const seen=new Set(),queue=[toId];while(queue.length){const id=queue.pop();if(id===fromId)fail('依赖关联不能形成环');if(seen.has(id))continue;seen.add(id);for(const edge of db.prepare("SELECT l.related_id FROM links l LEFT JOIN relation_types t ON t.node_id=l.node_id AND t.related_id=l.related_id WHERE l.scope=? AND l.node_id=? AND coalesce(t.relation,'supports')='supports'").all(scope,id))queue.push(edge.related_id);}
    }
    db.prepare('INSERT OR IGNORE INTO links VALUES (?,?,?)').run(scope,fromId,toId);
    db.prepare('INSERT INTO relation_types VALUES (?,?,?,?) ON CONFLICT(node_id,related_id) DO UPDATE SET relation=excluded.relation,created_at=excluded.created_at').run(fromId,toId,type,now());prepared.clear();
    return {linked:true,fromId,toId,relation:type};
  }
  function onReplaced(oldId,newId,scope){
    // 后续/相关/目标关联继续指向当前版本；依赖摘要与冲突保留原引用供撤回或审阅。
    for(const link of db.prepare("SELECT l.node_id,l.related_id,t.relation FROM links l JOIN nodes n ON n.id=l.node_id JOIN relation_types t ON t.node_id=l.node_id AND t.related_id=l.related_id WHERE l.scope=? AND l.related_id=? AND n.status NOT IN ('forgotten','superseded') AND t.relation IN ('related','follows','goal')").all(scope,oldId)){
      db.prepare('INSERT OR IGNORE INTO links VALUES (?,?,?)').run(scope,link.node_id,newId);
      db.prepare('INSERT OR REPLACE INTO relation_types VALUES (?,?,?,?)').run(link.node_id,newId,link.relation,now());
      db.prepare('DELETE FROM links WHERE scope=? AND node_id=? AND related_id=?').run(scope,link.node_id,oldId);
      db.prepare('DELETE FROM relation_types WHERE node_id=? AND related_id=?').run(link.node_id,oldId);
    }
  }
  function link(scope,request,context){sourceFor(scope,request,context);return transaction(()=>effectiveRelation(scope,request.fromId,request.toId,request.relation||'related'));}
  function insertTrusted(scope,{kind,key,content,evidence,sourceRef,excerpt='',status='active',nextStep='',metadata:m={},relatedIds=[]}){
    scope=scopeKey(scope);const sourceId=hash(scope+'\0'+sourceRef);
    if(db.prepare('SELECT 1 FROM tombstones WHERE scope=? AND fingerprint=?').get(scope,'source:'+sourceId)||db.prepare('SELECT 1 FROM tombstones WHERE scope=? AND fingerprint=?').get(scope,'fact:'+hash([kind,'self',key].join('\0'))))return {suppressed:true};
    const old=db.prepare("SELECT * FROM nodes WHERE scope=? AND kind=? AND subject_id='self' AND fact_key=? AND status NOT IN ('forgotten','superseded') ORDER BY updated_at DESC LIMIT 1").get(scope,kind,key);
    if(old&&old.content===text(content,600)&&old.status===status&&old.next_step===text(nextStep,200))return {duplicate:true,record:publicNode(old)};
    const result=transaction(()=>{
      insertSource({id:sourceId,scope,origin:sourceRef,senderId:'self',name:'小鲸鱼',at:now(),excerpt:text(excerpt,1000)});
      const id=crypto.randomUUID();if(old)db.prepare("UPDATE nodes SET status='superseded' WHERE id=?").run(old.id);
      db.prepare('INSERT INTO nodes VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,scope,kind,'self','小鲸鱼',key,text(content,600),text(nextStep,200),status,evidence,sourceId,now(),now(),null,old?.id||null,old?.root_id||id);
      saveMetadata(id,m);db.prepare('INSERT INTO memory_search VALUES (?,?,?)').run(id,scope,text(content,600));
      if(old)onReplaced(old.id,id,scope);
      for(const other of relatedIds)effectiveRelation(scope,id,other,'goal');
      return {record:publicNode(node(id,scope),true)};
    });changed();return result;
  }
  function observation(scope,{messageId,vision,images=[]}){
    if(!settings().imageMemory||vision?.status!=='ok'||!Array.isArray(vision.images)||!vision.images.length)return {skipped:true};
    const descriptions=vision.images.slice(0,4).map((item,i)=>`图${item.index||i+1}：${text(item.description,280)}${item.self_identity?'；虚拟角色对照：'+({self:'含自身形象',not_self:'不是自身形象',uncertain:'是否自身尚未确定'}[item.self_identity.verdict]||'尚未确定')+'（'+(item.self_identity.basis==='confirmed_reference'?'已确认图片完全匹配':'视觉判断，保留不确定性')+'）':''}`);
    const uncertain=vision.images.flatMap(item=>item.uncertain||[]).map(s=>text(s,160)).filter(Boolean).slice(0,8);
    const visibleText=vision.images.flatMap(item=>item.visible_text||[]).map(s=>text(s,180)).slice(0,12);
    const digest=hash(images.filter(i=>i?.data).map(i=>hash(i.data)).join(':')||String(messageId));
    const selfIdentity=vision.images.slice(0,4).filter(item=>item.self_identity).map(item=>({index:item.index,...item.self_identity}));
    return insertTrusted(scope,{kind:'observation',key:'image:'+messageId+':'+digest.slice(0,20),sourceRef:'vision:'+messageId+':'+digest,evidence:'visual',content:(uncertain.length?'【存在未确认内容，不能据此断言身份或出处】':'')+descriptions.join('；'),excerpt:visibleText.join('；'),metadata:{messageRef:String(messageId),imageDigest:digest,uncertain,visibleText,answer:text(vision.answer,800),...(selfIdentity.length?{selfIdentity,identityReference:vision.identity_reference,identityIsVisualCharacterOnly:true}:{}),observedAt:now(),interpretation:'辅助视觉观察，保留不确定性；并非确定身份事实'}});
  }
  function experience(scope,{tool,callId,result,ok=true,summary,metadata:m={}}){
    if(!settings().experienceMemory||!ok)return {skipped:true};
    if(tool==='qq_shared_sticker'||tool==='qq_shared_reply'){
      const sent=String(m.messageRef||''),reply=String(m.replyToMessageId||'');
      if(!/^-?\d+$/.test(sent)||!/^\-?\d+$/.test(reply)||sent==='0'||reply==='0')return {skipped:true};
      const dayStart=now()-86400000;
      const count=db.prepare("SELECT count(*) AS n FROM nodes WHERE scope=? AND kind='experience' AND fact_key LIKE 'shared:%' AND created_at>?").get(scopeKey(scope),dayStart).n;
      if(count>=3)return {skipped:true};
      const sticker=tool==='qq_shared_sticker';
      return insertTrusted(scope,{kind:'experience',key:'shared:'+sent,sourceRef:'qq:shared:'+sent,evidence:'tool',status:'unverified',content:sticker?'在本会话中，机器人引用一条消息并成功发送了表情；具体互动含义需核实。':'在本会话中，机器人回应了对方提出的共同活动或感谢；具体经历需核实。',metadata:{tool:sticker?'qq_send_sticker':'qq_send_message',messageRef:sent,replyToMessageId:reply,verified:false,interpretation:'仅有发送回执，不推断对方感受或活动是否完成'}});
    }
    if(!/(?:web_search|web_fetch|qq_draw_image|qq_endfield_query|qq_get_forward_msg)$/.test(String(tool)))return {skipped:true};
    const raw=result===undefined?String(summary||''):typeof result==='string'?result:JSON.stringify(result??{});
    if(/"(?:ok|success)"\s*:\s*false|"status"\s*:\s*"(?:failed|error)"/.test(raw))return {skipped:true};
    const detail=text(summary||raw,480);if(!detail)return {skipped:true};
    const eventId=hash(String(callId||'')+'\0'+raw);
    return insertTrusted(scope,{kind:'experience',key:'tool:'+tool+':'+eventId.slice(0,24),sourceRef:'tool:'+tool+':'+String(callId||'result')+':'+eventId.slice(0,24),evidence:'tool',content:`实际执行 ${text(tool,80)}，返回：${detail}`,excerpt:detail,metadata:{tool:text(tool,100),outcome:'success',...m,untrustedResult:true}});
  }
  function syncGoals(scope,goals=[]){
    const records=[];for(const goal of goals.slice(-12)){
      if(!goal?.id||!goal.title)continue;
      const status=goal.status==='active'&&goal.expiresAt>now()?'active':goal.status==='done'?'done':'archived';
      const result=insertTrusted(scope,{kind:'goal',key:'goal:'+goal.id,sourceRef:'goal:'+goal.id+':'+goal.updatedAt,evidence:'state',content:`自己的目标：${text(goal.title,100)}；动机：${text(goal.motivation,160)}`,status,nextStep:status==='active'?goal.nextStep:'',metadata:{goalId:goal.id,goalStatus:goal.status,reportedProgress:true,expiresAt:goal.expiresAt,meaning:'目标状态记录；完成标记本身不证明外部任务成功'}});if(result.record)records.push(result.record);
    }return records;
  }
  async function prepare(scope,messages=[]){
    if(!settings().autoInject)return;
    const recent=messages.filter(m=>!m.isSelf).slice(-3);const q=recent.map(m=>m.plain||m.text||'').join(' ').slice(0,800);if(!q)return;
    const key=scope+'\0'+q;const result=await search(scope,{q,limit:6,quiet:true});if(!closed)prepared.set(scope,{key,ids:result.records.map(r=>r.id)});
  }
  function preparedRecords(scope,messages=[]){const q=messages.filter(m=>!m.isSelf).slice(-3).map(m=>m.plain||m.text||'').join(' ').slice(0,800);const cached=prepared.get(scope);if(cached?.key!==scope+'\0'+q)return [];
    return cached.ids.map(id=>db.prepare('SELECT * FROM nodes WHERE scope=? AND id=?').get(scope,id)).filter(r=>r&&['active','done'].includes(r.status)&&details(r,false).verified&&(!r.valid_until||r.valid_until>now())&&r.kind!=='style').map(r=>publicNode(r));}
  function styleText(scope){const rows=db.prepare("SELECT content FROM nodes WHERE scope=? AND kind='style' AND status='active' AND evidence='admin' ORDER BY updated_at DESC LIMIT 4").all(scope);const selected=rows.find(r=>r.content.length<=100);return selected?'【本会话表达参考】管理员确认，按人格和语境取舍，不当口癖或权限指令：'+selected.content:'';}
  function onForgotten(ids,scope){
    const sources=new Set(ids.map(id=>db.prepare('SELECT source_id FROM nodes WHERE id=? AND scope=?').get(id,scope)?.source_id).filter(Boolean));
    for(const id of ids){db.prepare('DELETE FROM memory_vectors WHERE node_id=?').run(id);db.prepare('DELETE FROM node_details WHERE node_id=?').run(id);db.prepare('DELETE FROM relation_types WHERE node_id=? OR related_id=?').run(id,id);db.prepare('DELETE FROM memory_reviews WHERE scope=? AND node_id=?').run(scope,id);db.prepare('DELETE FROM retrieval_cases WHERE scope=? AND EXISTS(SELECT 1 FROM json_each(expected_ids) WHERE value=?)').run(scope,id);}
    for(const item of db.prepare('SELECT d.* FROM node_details d JOIN nodes n ON n.id=d.node_id WHERE n.scope=?').all(scope)){
      const m=JSON.parse(item.metadata);if(!m.sampleSources?.some(s=>sources.has(s.id)))continue;
      m.sampleSources=m.sampleSources.filter(s=>!sources.has(s.id));saveMetadata(item.node_id,m);
      db.prepare("UPDATE nodes SET status='unverified' WHERE id=? AND kind='style' AND status='active'").run(item.node_id);
    }
    prepared.clear();queryCache.clear();
  }
  function overview(){const scopes=db.prepare("SELECT scope,sum(status!='superseded') AS records,sum(status='unverified') AS pending,sum(kind='style' AND status='unverified') AS stylePending FROM nodes WHERE status!='forgotten' GROUP BY scope ORDER BY scope").all();return {scopes,settings:settings(),semantic:{...(embeddings?.status()||{state:'unavailable',model:null}),indexed:db.prepare('SELECT count(*) AS n FROM memory_vectors').get().n,indexing:!!indexing},totals:db.prepare("SELECT count(*) AS records,sum(status NOT IN ('forgotten','superseded')) AS current,sum(status='superseded') AS versions,sum(status='unverified') AS pending,sum(status='forgotten') AS forgotten FROM nodes").get()};}
  function list(scope,options={}){
    scope=scopeKey(scope);const args=[scope];let sql="SELECT * FROM nodes WHERE scope=? AND status!='forgotten'";
    if(options.status&&options.status!=='all'){sql+=' AND status=?';args.push(options.status);}else sql+=" AND status!='superseded'";
    if(options.kind){sql+=' AND kind=?';args.push(options.kind);}
    if(options.person){sql+=' AND subject_id=?';args.push(String(options.person));}
    if(options.q){sql+=' AND (content LIKE ? OR next_step LIKE ?)';args.push('%'+text(options.q,200)+'%','%'+text(options.q,200)+'%');}
    const count=db.prepare(sql.replace('SELECT *','SELECT count(*) AS n')).get(...args).n;
    const limit=Math.min(50,Math.max(1,Number(options.limit)||20)),offset=Math.max(0,Number(options.offset)||0);
    const rows=db.prepare(sql+' ORDER BY updated_at DESC,id LIMIT ? OFFSET ?').all(...args,limit,offset);
    return {records:rows.map(r=>publicNode(r)),total:count,offset,limit,people:db.prepare('SELECT user_id AS id,aliases FROM people WHERE scope=? ORDER BY last_seen DESC').all(scope).map(p=>({...p,aliases:JSON.parse(p.aliases)}))};
  }
  function read(scope,id){const row=node(id,scope);if(row.status==='forgotten')return {forgotten:true};return {record:publicNode(row,true),versions:db.prepare("SELECT * FROM nodes WHERE scope=? AND root_id=? AND status!='forgotten' ORDER BY created_at DESC,rowid DESC").all(scope,row.root_id).map(r=>publicNode(r,true)),incoming:db.prepare("SELECT n.*,coalesce(t.relation,'supports') AS relation FROM links l JOIN nodes n ON n.id=l.node_id LEFT JOIN relation_types t ON t.node_id=l.node_id AND t.related_id=l.related_id WHERE l.scope=? AND l.related_id=? AND n.status!='forgotten'").all(scope,id).map(r=>({record:publicNode(r),type:r.relation})),reviews:db.prepare('SELECT action,reason,created_at AS at FROM memory_reviews WHERE scope=? AND node_id=? ORDER BY created_at DESC LIMIT 20').all(scope,id)};}
  function edit(scope,id,patch){const row=node(id,scope);if(['forgotten','superseded'].includes(row.status))fail('请编辑当前有效版本',409);const subject=patch.subjectUserId===undefined?row.subject_id:String(patch.subjectUserId||'');if(subject&&subject!=='self'&&!/^[1-9]\d{4,19}$/.test(subject))fail('需要稳定 QQ 身份');
    const result=adminRevise(scope,id,{content:patch.content,nextStep:patch.nextStep,validUntil:patch.validUntil,confirmed:patch.confirmed===true,status:patch.status});
    db.prepare('UPDATE nodes SET subject_id=? WHERE id=?').run(subject,result.id);
    saveMetadata(result.id,{...metadata(id),tags:(patch.tags||metadata(id).tags||[]).map(s=>text(s,40)).slice(0,8),verified:patch.confirmed===true,adminConfirmedAt:patch.confirmed?now():null});
    audit(scope,result.id,'revise',patch.reason);changed();return {record:publicNode(node(result.id,scope),true)};
  }
  async function admin(scope,request){
    const action=request.action||'overview';if(action==='overview')return overview();if(action==='settings')return {settings:setSettings(request.settings||{})};
    scope=scopeKey(scope);
    if(action==='batchReview'){
      if(!['confirm','reject'].includes(request.decision))fail('批量审核只支持确认或拒绝');
      if(!Array.isArray(request.ids)||!request.ids.length||request.ids.length>100||request.ids.some(id=>typeof id!=='string')||new Set(request.ids).size!==request.ids.length)fail('请选择1至100条不重复的待核实记录');
      const records=request.ids.map(id=>node(id,scope));
      for(const row of records){if(row.status!=='unverified'||row.kind==='goal')fail('选中记录已变化或不是可审核的待核实记录，请刷新后重选',409);}
      // 先审来源，再审依赖摘要，避免同一批次中的来源换版使摘要失效。
      const ordered=[],visiting=new Set(),visited=new Set(),selected=new Set(request.ids);
      function visit(row){if(visited.has(row.id))return;if(visiting.has(row.id))fail('依赖关系成环，请分别核实');visiting.add(row.id);for(const link of relations(row))if(link.type==='supports'&&selected.has(link.id))visit(records.find(item=>item.id===link.id));visiting.delete(row.id);visited.add(row.id);ordered.push(row);}
      records.forEach(visit);
      const result=transaction(()=>ordered.map(row=>edit(scope,row.id,{content:row.content,confirmed:request.decision==='confirm',status:request.decision==='reject'?'archived':'active',reason:text(request.reason||('批量'+(request.decision==='confirm'?'核实':'拒绝')),200)}).record));
      return {reviewed:result.length,decision:request.decision,records:result};
    }
    if(['revise','confirm','archive','done'].includes(action)&&node(request.id,scope).kind==='goal')fail('目标请通过专用目标操作同步真实状态，避免产生两个版本的待办');
    if(action==='list')return list(scope,request);
    if(action==='read')return read(scope,request.id);
    if(action==='search')return search(scope,{...request,includeUnverified:request.includeUnverified!==false});
    if(action==='revise')return edit(scope,request.id,request.patch||{});
    if(action==='confirm'){const current=node(request.id,scope);return edit(scope,request.id,{...request.patch,content:request.patch?.content??current.content,confirmed:true,reason:request.reason||'管理员核实'});}
    if(action==='archive'||action==='done'){const current=node(request.id,scope);return edit(scope,request.id,{content:current.content,status:action==='done'?'done':'archived',confirmed:details(current,false).verified,reason:request.reason});}
    if(action==='forget'){const result=forget(scope,request.id);audit(scope,request.id,'forget','管理员在详情页要求遗忘');return result;}
    if(action==='link')return transaction(()=>effectiveRelation(scope,request.fromId,request.toId,request.relation||'related'));
    if(action==='unlink'){node(request.fromId,scope);node(request.toId,scope);db.prepare('DELETE FROM links WHERE scope=? AND node_id=? AND related_id=?').run(scope,request.fromId,request.toId);db.prepare('DELETE FROM relation_types WHERE node_id=? AND related_id=?').run(request.fromId,request.toId);prepared.clear();return {unlinked:true};}
    if(action==='reindex')return reindex(scope);
    if(action==='metrics')return {metrics:db.prepare('SELECT * FROM memory_metrics WHERE scope=? ORDER BY day DESC LIMIT 100').all(scope)};
    if(action==='case'){const expectedIds=(request.expectedIds||[]).slice(0,8);for(const id of expectedIds)node(id,scope);if(!text(request.q,300)||!expectedIds.length)fail('需要回忆问法和期望的记忆ID');const id=crypto.randomUUID();db.prepare('INSERT INTO retrieval_cases VALUES (?,?,?,?,?)').run(id,scope,text(request.q,300),JSON.stringify(expectedIds),now());return {saved:true,id};}
    if(action==='evaluate'){const cases=db.prepare('SELECT * FROM retrieval_cases WHERE scope=? ORDER BY created_at DESC LIMIT 20').all(scope);const results=[];for(const item of cases){const result=await search(scope,{q:item.query,limit:5,quiet:true,includeUnverified:true});const expected=JSON.parse(item.expected_ids).filter(id=>{try{return node(id,scope).status!=='forgotten';}catch{return false;}});if(!expected.length)continue;results.push({id:item.id,q:item.query,expected,returned:result.records.map(r=>r.id),hit:expected.some(id=>result.records.some(r=>r.id===id))});}return {cases:results,hitAt5:results.length?results.filter(r=>r.hit).length/results.length:null};}
    fail('未知的管理操作');
  }
  return {settings,validateStore,onStored,onReplaced,onAdminRevise,details,search,prepare,preparedRecords,styleText,onForgotten,observation,experience,syncGoals,link,admin,reindex,metric,changed,close:()=>{closed=true;if(indexTimer)clearTimeout(indexTimer);indexTimer=null;prepared.clear();queryCache.clear();}};
}

// 仅搭载已有唤醒，不单独叫醒机器人；来源经指纹核对，结果一律等人工审核。
import crypto from 'node:crypto';
import {SENSITIVE_RE} from './sensitive.js';
const hash=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const body=m=>String(m?.plain||m?.text||'').trim();
const signature=m=>hash(JSON.stringify([m.seq,String(m.messageId||''),String(m.userId||''),m.time,body(m)]));
const fail=message=>{throw Object.assign(new Error(message),{statusCode:409});};
const HOUR=3600000,DAY=24*HOUR;
export function createConversationReview({db,now,scopeKey,settings,store,sourceFor,transaction}){
  db.exec(`CREATE TABLE IF NOT EXISTS conversation_review_state(scope TEXT PRIMARY KEY,cursor INTEGER NOT NULL,last_issued_at INTEGER NOT NULL DEFAULT 0,requested INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS conversation_review_runs(id TEXT PRIMARY KEY,scope TEXT NOT NULL,issued_at INTEGER NOT NULL,refs TEXT NOT NULL,status TEXT NOT NULL,candidate_ids TEXT NOT NULL DEFAULT '[]',completed_at INTEGER,reason TEXT NOT NULL DEFAULT '');`);
  const enabled=()=>settings().memoryCandidates!==false&&settings().autoInject!==false;
  function baseline(scope,messages=[]){scope=scopeKey(scope);db.prepare('INSERT OR IGNORE INTO conversation_review_state(scope,cursor) VALUES (?,?)').run(scope,Math.max(0,...messages.filter(m=>!m.isSelf).map(m=>Number(m.seq)||0)));}
  function request(scope){scope=scopeKey(scope);if(!/^(group|private):/.test(scope))fail('当前仅支持QQ会话回顾');baseline(scope);if(enabled())db.prepare('UPDATE conversation_review_state SET requested=1 WHERE scope=?').run(scope);return status(scope);}
  function offer(scope,messages=[]){
    scope=scopeKey(scope);if(!enabled()||!/^(group|private):/.test(scope))return null;
    const state=db.prepare('SELECT * FROM conversation_review_state WHERE scope=?').get(scope);if(!state){baseline(scope,messages);return null;}
    if(state.last_issued_at&&now()-state.last_issued_at<HOUR)return null;
    if(db.prepare('SELECT count(*) n FROM conversation_review_runs WHERE issued_at>?').get(now()-DAY).n>=8)return null;
    const eligible=[...new Map(messages.filter(m=>!m.isSelf&&Number.isSafeInteger(Number(m.seq))&&Number(m.seq)>0&&/^[1-9]\d{4,19}$/.test(String(m.userId||''))&&m.time>now()-DAY&&m.time<=now()+60000&&body(m).length>=4&&!SENSITIVE_RE.test(body(m))).map(m=>[Number(m.seq),m])).values()];
    const usable=eligible.filter(m=>{try{sourceFor(scope,{sourceSeq:Number(m.seq)},{messages});return true;}catch{return false;}});
    const fresh=usable.filter(m=>Number(m.seq)>state.cursor);
    if(usable.length<4||(!state.requested&&fresh.length<8))return null;
    const id=crypto.randomUUID(),refs=usable.map(m=>({seq:Number(m.seq),signature:signature(m)}));
    return transaction(()=>{
      db.prepare("UPDATE conversation_review_runs SET status='expired',reason='not-completed' WHERE scope=? AND status='issued' AND issued_at<=?").run(scope,now()-DAY);
      db.prepare('INSERT INTO conversation_review_runs(id,scope,issued_at,refs,status) VALUES (?,?,?,?,?)').run(id,scope,now(),JSON.stringify(refs),'issued');
      db.prepare('UPDATE conversation_review_state SET cursor=?,last_issued_at=?,requested=0 WHERE scope=?').run(Math.max(state.cursor,...usable.map(m=>Number(m.seq))),now(),scope);
      return {id,prompt:`\n\n【聊天记忆回顾 ${id}】先正常处理交流，再仅检查上面已可见的收到消息。挑最多3条值得以后延续的明确偏好、具体事件或约定；保留否定、条件、时间和原话所指，不把玩笑、表情、别人转述、单纯称呼或你自己的回答当长期事实，不收集凭据。每条用sourceSeq引用可见真实收到消息的seq；不确定或没价值就不提，不凑条数。用一次qq_memory_append(category="activeTopic",content为完整JSON字符串)报告：{"_memoryTree":1,"action":"candidateReview","reviewId":"${id}","candidates":[{"kind":"fact","content":"简短候选，最多180字","sourceSeq":123}]}。无合适内容传candidates:[]。所有结果都待管理员审核；不额外查历史、不向群友汇报、不为回顾继续聊天或重试。\n`};
    });
  }
  function submit(scope,request,context){
    scope=scopeKey(scope);if(!enabled())fail('聊天记忆回顾已关闭');
    const run=db.prepare('SELECT * FROM conversation_review_runs WHERE scope=? AND id=?').get(scope,String(request.reviewId||''));
    if(!run)fail('当前会话没有这项聊天回顾');
    if(run.status==='completed')return {reviewed:true,duplicate:true,candidateIds:JSON.parse(run.candidate_ids)};
    if(run.status!=='issued'||now()-run.issued_at>=DAY)fail('聊天回顾已失效');
    if(!Array.isArray(request.candidates)||request.candidates.length>3)fail('聊天回顾最多3条候选，无合适内容传空数组');
    const refs=new Map(JSON.parse(run.refs).map(r=>[r.seq,r.signature]));
    const prepared=request.candidates.map(c=>{
      if(!c||!['fact','event','agreement'].includes(c.kind)||typeof c.content!=='string'||!c.content.trim()||c.content.length>180||/[\r\n]/.test(c.content)||SENSITIVE_RE.test(c.content))fail('候选内容、类型或敏感信息检查未通过');
      const m=(context.messages||[]).find(m=>!m.isSelf&&Number(m.seq)===c.sourceSeq);
      if(!m||!refs.has(c.sourceSeq)||signature(m)!==refs.get(c.sourceSeq))fail('候选来源不在本次可见窗口、已改变或是自己的回复');
      const source=sourceFor(scope,{sourceSeq:c.sourceSeq},context);
      return {kind:c.kind,content:c.content.trim(),sourceSeq:c.sourceSeq,subjectUserId:source.senderId,evidence:'inference',factKey:'conversation-review:'+hash(c.kind+'\0'+source.senderId+'\0'+c.content.trim()).slice(0,32),tags:['聊天回顾','待人工核实']};
    });
    return transaction(()=>{
      const ids=[];
      for(const item of prepared){
        if(db.prepare("SELECT 1 FROM nodes WHERE scope=? AND kind=? AND content=? AND status NOT IN ('forgotten','superseded') LIMIT 1").get(scope,item.kind,item.content))continue;
        const result=store(scope,item,context);ids.push(result.record.id);
      }
      db.prepare("UPDATE conversation_review_runs SET status='completed',candidate_ids=?,completed_at=? WHERE id=?").run(JSON.stringify(ids),now(),run.id);
      return {reviewed:true,candidateIds:ids,needsAdminConfirmation:ids.length>0};
    });
  }
  function cancel(scope,id){db.prepare("UPDATE conversation_review_runs SET status='cancelled',reason='delivery-failed' WHERE scope=? AND id=? AND status='issued'").run(scopeKey(scope),id);}
  function status(scope){scope=scopeKey(scope);const state=db.prepare('SELECT requested,last_issued_at AS lastIssuedAt FROM conversation_review_state WHERE scope=?').get(scope);const latest=db.prepare('SELECT status,issued_at AS issuedAt,completed_at AS completedAt,candidate_ids FROM conversation_review_runs WHERE scope=? ORDER BY issued_at DESC,rowid DESC LIMIT 1').get(scope);return {enabled:enabled(),requested:!!state?.requested,intervalMinutes:60,globalMaximumPerDay:8,latest:latest?{status:latest.status,issuedAt:latest.issuedAt,completedAt:latest.completedAt,candidateCount:JSON.parse(latest.candidate_ids).length}:null};}
  function invalidate(scope){db.prepare("UPDATE conversation_review_runs SET status='cancelled',reason='memory-forgotten' WHERE scope=? AND status='issued'").run(scopeKey(scope));}
  function clear(scope){scope=scopeKey(scope);db.prepare('DELETE FROM conversation_review_runs WHERE scope=?').run(scope);db.prepare('DELETE FROM conversation_review_state WHERE scope=?').run(scope);}
  return {baseline,request,offer,submit,cancel,status,invalidate,clear};
}

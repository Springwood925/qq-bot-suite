// 保守的本地筛选，只产生有原话来源的待核实候选，不调用模型、不自动确认。
import crypto from 'node:crypto';
import {SENSITIVE_RE} from './sensitive.js';
const hash=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
export function classifyMemoryCandidate(message) {
  const body=String(message?.plain||message?.text||'').trim();
  if(message?.isSelf || !/^[1-9]\d{4,19}$/.test(String(message?.userId||'')) || !Number.isSafeInteger(Number(message?.seq)) || Number(message.seq)<=0) return null;
  if(body.length<4 || body.length>400 || /[\r\n]|https?:\/\/|\[(?:图片|图|表情|转发|视频)|(?:哈哈|笑死|开玩笑|狗头|[?？])/.test(body) || SENSITIVE_RE.test(body))return null;
  const preference=/^(?:其实[，,]?|对了[，,]?)?(?:我(?:平时|一直|通常|一般|比较|特别|最|很|更)?(?:喜欢|不喜欢|讨厌|偏好|习惯)|我的(?:爱好|偏好|习惯)是)(.+)$/u.exec(body);
  if(preference && preference[1].replace(/[，。！!\s]/g,'').length && !/^(?:你|这个|那个|这张|这幅|这样|这句|这种|它|他|她|\[)/.test(preference[1]))return {kind:'fact',label:'明确偏好',body};
  if(/^(?:(?:我们|咱们)(?:已经)?(?:约好|说好|约定)|我(?:答应|承诺))[^?？]{2,}$/.test(body))return {kind:'agreement',label:'明确约定',body};
  return null;
}
export function createMemoryCandidates({db,now,scopeKey,settings,store,sourceFor,transaction}) {
  db.exec(`CREATE TABLE IF NOT EXISTS memory_candidate_checks(scope TEXT NOT NULL,source_id TEXT NOT NULL,status TEXT NOT NULL,node_id TEXT,checked_at INTEGER NOT NULL,PRIMARY KEY(scope,source_id));
    CREATE TABLE IF NOT EXISTS memory_candidate_state(scope TEXT PRIMARY KEY,last_scan_at INTEGER NOT NULL,scanned INTEGER NOT NULL,matched INTEGER NOT NULL,created INTEGER NOT NULL,duplicates INTEGER NOT NULL,blocked INTEGER NOT NULL);`);
  function collect(scope,messages=[]) {
    scope=scopeKey(scope);
    const report={enabled:settings().memoryCandidates!==false,scanned:0,matched:0,created:0,duplicates:0,blocked:0};
    if(!report.enabled || !/^(?:group|private):/.test(scope))return report;
    const context={messages};
    return transaction(()=>{
      for(const message of messages){
        if(message?.isSelf || !Number.isSafeInteger(Number(message?.seq)) || Number(message.seq)<=0)continue;
        if(!Number.isFinite(Number(message?.time)) || Number(message.time)<now()-7*86400000)continue;
        report.scanned++;
        const match=classifyMemoryCandidate(message);if(!match)continue;report.matched++;
        try {
          const source=sourceFor(scope,{sourceSeq:Number(message.seq)},context);
          if(db.prepare('SELECT 1 FROM memory_candidate_checks WHERE scope=? AND source_id=?').get(scope,source.id)){report.duplicates++;continue;}
          const factKey='chat-candidate:'+hash(match.kind+'\0'+match.body).slice(0,32);
          const exists=db.prepare("SELECT id FROM nodes WHERE scope=? AND subject_id=? AND fact_key=? AND status NOT IN ('forgotten','superseded') LIMIT 1").get(scope,String(message.userId),factKey);
          if(exists){db.prepare('INSERT INTO memory_candidate_checks VALUES (?,?,?,?,?)').run(scope,source.id,'duplicate',exists.id,now());report.duplicates++;continue;}
          const result=store(scope,{kind:match.kind,content:match.label+'（原话）：'+match.body,factKey,sourceSeq:Number(message.seq),subjectUserId:String(message.userId),evidence:'inference',tags:['本地筛选',match.label]},context);
          db.prepare('INSERT INTO memory_candidate_checks VALUES (?,?,?,?,?)').run(scope,source.id,'created',result.record.id,now());report.created++;
        }catch(error){
          // 遗忘墓碑、来源失效等应阻止重建；不把原话或内部异常写入状态。
          report.blocked++;
        }
      }
      if (report.scanned) db.prepare(`INSERT INTO memory_candidate_state VALUES (?,?,?,?,?,?,?) ON CONFLICT(scope) DO UPDATE SET
        last_scan_at=excluded.last_scan_at,scanned=scanned+excluded.scanned,matched=matched+excluded.matched,created=created+excluded.created,duplicates=duplicates+excluded.duplicates,blocked=blocked+excluded.blocked`)
        .run(scope,now(),report.scanned,report.matched,report.created,report.duplicates,report.blocked);
      return report;
    });
  }
  function status(scope) {
    scope=scopeKey(scope);
    const stats=db.prepare('SELECT last_scan_at AS lastScanAt,scanned,matched,created,duplicates,blocked FROM memory_candidate_state WHERE scope=?').get(scope)||null;
    return {enabled:settings().memoryCandidates!==false,method:'local-explicit-statements',requiresAdminConfirmation:true,totalCapacityLimit:null,stats};
  }
  function clear(scope){scope=scopeKey(scope);db.prepare('DELETE FROM memory_candidate_checks WHERE scope=?').run(scope);db.prepare('DELETE FROM memory_candidate_state WHERE scope=?').run(scope);}
  return {collect,status,clear};
}

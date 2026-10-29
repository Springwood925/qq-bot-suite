// 低频回顾搭载已有唤醒；不启动模型、不发送消息、不覆盖人格或自动确认候选。
import crypto from 'node:crypto';
import { SENSITIVE_RE } from './sensitive.js';
const DAY = 86400000;
const CRITERIA = new Set(['context', 'length', 'question', 'reference', 'humor', 'splitting']);
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
const seq = message => Number(message?.seq);
const body = message => String(message?.plain || message?.text || '').trim();
const ref = message => ({ seq: seq(message), self: !!message.isSelf, user: String(message.userId || ''),
  message: String(message.messageId || ''), time: Number(message.time), hash: hash(body(message)) });
export function createStyleReview({ db, now, scopeKey, settings, store, sourceFor, transaction }) {
  db.exec(`CREATE TABLE IF NOT EXISTS style_review_state(scope TEXT PRIMARY KEY,cursor INTEGER NOT NULL,last_issued_at INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS style_review_runs(id TEXT PRIMARY KEY,scope TEXT NOT NULL,issued_at INTEGER NOT NULL,cursor INTEGER NOT NULL,refs TEXT NOT NULL,status TEXT NOT NULL,candidate_ids TEXT NOT NULL DEFAULT '[]',completed_at INTEGER,reason TEXT NOT NULL DEFAULT '');
    CREATE INDEX IF NOT EXISTS style_reviews_scope ON style_review_runs(scope,issued_at);`);
  const enabled = () => settings().styleLearning && settings().styleReview && settings().autoInject;
  function baseline(scope, messages = []) {
    scope = scopeKey(scope);
    const cursor = Math.max(0, ...messages.map(seq).filter(Number.isSafeInteger));
    db.prepare('INSERT OR IGNORE INTO style_review_state(scope,cursor) VALUES (?,?)').run(scope, cursor);
  }
  function cancel(scope, id, reason = 'delivery-failed') {
    db.prepare("UPDATE style_review_runs SET status='cancelled',reason=? WHERE scope=? AND id=? AND status='issued'").run(reason, scopeKey(scope), id);
  }
  function clear(scope) {
    db.prepare('DELETE FROM style_review_runs WHERE scope=?').run(scopeKey(scope));
    db.prepare('DELETE FROM style_review_state WHERE scope=?').run(scope);
  }
  function invalidate(scope) {
    db.prepare("UPDATE style_review_runs SET status='cancelled',reason='memory-forgotten' WHERE scope=? AND status='issued'").run(scopeKey(scope));
  }
  function offer(scope, messages = [], options = {}) {
    const force = options?.force === true;
    scope = scopeKey(scope);
    if (!enabled() || !/^(group|private):/.test(scope)) return null;
    const state = db.prepare('SELECT * FROM style_review_state WHERE scope=?').get(scope);
    if (!state) { baseline(scope, messages); return null; }
    // 2026-10-29：清掉超过 7 天没人确认的表达候选——旧候选不能把回顾永久堵死。
    try {
      db.prepare("UPDATE nodes SET status='archived' WHERE scope=? AND kind='style' AND status='unverified' AND updated_at < ?").run(scope, now() - 7 * DAY);
    } catch { /* 清理失败不影响回顾 */ }
    const eligible = messages.filter(m => Number.isFinite(Number(m.time)) && m.time > now() - DAY && m.time <= now() + 60000 && body(m).length >= 2);
    const incomingNew=eligible.filter(m=>!m.isSelf && Number.isSafeInteger(seq(m)) && seq(m)>state.cursor && /^[1-9]\d{4,19}$/.test(String(m.userId||'')));
    const firstIncoming=Math.min(...incomingNew.map(m=>Number(m.time)));
    const anchor = Number.isFinite(firstIncoming) ? firstIncoming : -Infinity;
    const valid = [...new Map(eligible.filter(m=>m.isSelf ? (Number(m.time)>=anchor && (m.messageId || Number.isSafeInteger(seq(m)) && seq(m)>0)) : incomingNew.includes(m))
      .map(m=>[m.isSelf?'self:'+String(m.messageId||'seq:'+seq(m)):'incoming:'+seq(m),m])).values()].sort((a,b)=>Number(a.time)-Number(b.time)).slice(-40);
    const incoming = valid.filter(m => !m.isSelf), own = valid.filter(m => m.isSelf);
    // 2026-10-29 改：不再因为"有未确认候选"而阻塞（旧逻辑会让会话永久卡死）；频率限制只在非手动时生效。
    if (!force) {
      if (incoming.length < 12 || own.length < 3 || (state.last_issued_at && now() - state.last_issued_at < DAY)) return null;
      if (db.prepare('SELECT count(*) AS n FROM style_review_runs WHERE issued_at>?').get(now()-DAY).n >= 2) return null;
    }
    // 手动只放宽自动触发门槛，仍须满足提交证据和全局额度。
    if (incoming.length < 3 || own.length < 2) return null;
    if (db.prepare('SELECT count(*) AS n FROM style_review_runs WHERE issued_at>?').get(now()-DAY).n >= 2) return null;
    if (db.prepare("SELECT 1 FROM style_review_runs WHERE scope=? AND status='issued' AND issued_at>?").get(scope,now()-DAY)) return null;
    if (db.prepare("SELECT count(*) AS n FROM nodes WHERE scope=? AND kind='style' AND status='unverified'").get(scope).n >= 20) return null;
    return transaction(() => {
      db.prepare("UPDATE style_review_runs SET status='expired',reason='not-completed' WHERE scope=? AND status='issued' AND issued_at<=?").run(scope,now()-DAY);
      const id = crypto.randomUUID(), cursor = Math.max(...incoming.map(seq));
      const selected = valid.slice(-40);
      db.prepare('INSERT INTO style_review_runs(id,scope,issued_at,cursor,refs,status) VALUES (?,?,?,?,?,?)').run(id,scope,now(),cursor,JSON.stringify(selected.map(ref)),'issued');
      db.prepare('UPDATE style_review_state SET cursor=?,last_issued_at=? WHERE scope=?').run(cursor,now(),scope);
      db.prepare('DELETE FROM style_review_runs WHERE scope=? AND id NOT IN (SELECT id FROM style_review_runs WHERE scope=? ORDER BY issued_at DESC,rowid DESC LIMIT 50)').run(scope,scope);
      return { id, prompt: `\n\n【表达回顾 ${id}】先处理本次交流，再基于上面已给的对话用一次工具调用报告回顾结果；不额外查历史、不向聊天对象汇报。只检查自己是否承接语境、解释过多、无谓追问、指向不清或拆句不当，不抄别人口吻，不修改人格。最多2条候选，每条100字内；sourceSeqs取至少3条收到消息的seq数字，selfRefs取至少2条自己实际回复的#消息ID字符串；criterion为context/length/question/reference/humor/splitting。用qq_memory_append(category="activeTopic",content为JSON字符串)提交：{"_memoryTree":1,"action":"review","reviewId":"${id}","candidates":[{"content":"自己的表达原则","sourceSeqs":[],"selfRefs":[],"criterion":"context"}]}。没有明确改进就传空数组，不要凑条数。本轮提交一次即可，无变化也可 candidates:[]；失败或条件不符就收尾，不反复调用。候选须管理员确认才生效；回顾不要求继续聊天或改变收尾条件。` };
    });
  }
  function submit(scope, request, context) {
    scope = scopeKey(scope);
    if (!enabled()) fail('表达回顾已关闭',403);
    const run = db.prepare('SELECT * FROM style_review_runs WHERE scope=? AND id=?').get(scope,String(request.reviewId||''));
    if (!run) fail('当前会话没有这项表达回顾',404);
    if (run.status === 'completed') return { reviewed:true, duplicate:true, candidateIds:JSON.parse(run.candidate_ids) };
    if (run.status !== 'issued' || now()-run.issued_at >= DAY) fail('回顾已失效，请等待下一批真实对话',409);
    if (!Array.isArray(request.candidates) || request.candidates.length > 2) fail('回顾需要 candidates 数组，最多2条；无变化传空数组');
    const recorded=JSON.parse(run.refs),refs = new Map(recorded.filter(item=>!item.self).map(item => [item.seq,item]));
    const ownRefs=new Map(recorded.filter(item=>item.self).map(item=>[item.message||'seq:'+item.seq,item]));
    const messages = context.messages || [];
    const check = (number,self) => {
      if (!Number.isSafeInteger(number) || !refs.has(number)) fail('回顾来源不属于本次可见消息');
      const original = refs.get(number), current = messages.find(m=>seq(m)===number);
      if (!current || !!current.isSelf !== self || JSON.stringify(ref(current)) !== JSON.stringify(original)) fail('回顾来源已滚出窗口、改变或身份不符',409);
      if (!self) sourceFor(scope,{sourceSeq:number},context);
    };
    const contents=new Set();
    const prepared = request.candidates.map(candidate => {
      if (!candidate || typeof candidate.content !== 'string' || !candidate.content.trim() || [...candidate.content].length>100 || /[\r\n]/.test(candidate.content)) fail('表达候选需为100字以内的单条原则');
      const content = candidate.content.trim();
      if(contents.has(content))fail('同一回顾不能重复提交相同表达原则');contents.add(content);
      if (!CRITERIA.has(candidate.criterion)) fail('请选择已定义的表达检查维度');
      if (!Array.isArray(candidate.sourceSeqs) || (!Array.isArray(candidate.selfRefs) && !Array.isArray(candidate.selfSeqs))) fail('回顾需要收到消息和自己回复两类来源');
      const sources=[...new Set(candidate.sourceSeqs)], own=[...new Set(Array.isArray(candidate.selfRefs)?candidate.selfRefs.map(String):candidate.selfSeqs.map(n=>{const item=recorded.find(r=>r.self&&r.seq===n);return item?.message||'seq:'+n;}))];
      if (sources.length<3 || sources.length>12 || own.length<2 || own.length>12) fail('至少3条收到的消息和2条自己的回复，分别最多12条');
      sources.forEach(n=>check(n,false)); own.forEach(id=>{const original=ownRefs.get(id);const current=messages.find(m=>m.isSelf && (m.messageId ? String(m.messageId) : 'seq:'+seq(m))===id);if(!original||!current||JSON.stringify(ref(current))!==JSON.stringify(original))fail('自己的回顾来源已滚出窗口、改变或身份不符',409);});
      if (SENSITIVE_RE.test(content) || /\d{5,}|https?:\/\/|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(content)
        || messages.some(m=>String(m.sender||'').length>=2&&content.includes(String(m.sender)))) fail('表达原则不能包含人物称呼、账号、地址、链接或凭据');
      return { kind:'style',content,sourceSeq:sources[0],sourceSeqs:sources,evidence:'inference',
        factKey:'style-review:'+hash(content).slice(0,24),tags:['回顾候选',candidate.criterion],own };
    });
    return transaction(() => {
      // 学习三档（商品计划书 §6）：record=仅记录不进上下文；review=候选待人确认（默认/现状）；自动试用尚未开放
      const mode = ['record', 'review'].includes(settings().styleLearningMode) ? settings().styleLearningMode : 'review';
      // 自动生效暂缓：模型自报维度不构成风险评估或管理员确认。
      const ids=[];
      for (const item of prepared) {
        if(db.prepare("SELECT 1 FROM nodes WHERE scope=? AND kind='style' AND content=? AND status NOT IN ('forgotten','superseded') LIMIT 1").get(scope,item.content))continue;
        const {own,...input}=item;
        const result=store(scope,input,context);ids.push(result.record.id);
        if (mode === 'record') db.prepare("UPDATE nodes SET status='archived' WHERE id=?").run(result.record.id);
        const row=db.prepare('SELECT metadata FROM node_details WHERE node_id=?').get(result.record.id);
        const metadata=JSON.parse(row?.metadata||'{}');
        metadata.styleReview={id:run.id,criterion:item.tags[1],selfSources:own.map(n=>ownRefs.get(n)),meaning:'只证明这次回顾引用了实际消息；不证明表达质量已经改善'};
        db.prepare('UPDATE node_details SET metadata=? WHERE node_id=?').run(JSON.stringify(metadata),result.record.id);
      }
      db.prepare("UPDATE style_review_runs SET status='completed',candidate_ids=?,completed_at=? WHERE id=?").run(JSON.stringify(ids),now(),run.id);
      return {reviewed:true,candidateIds:ids,needsAdminConfirmation:ids.length>0&&mode!=='record'};
    });
  }
  function status(scope) {
    scope=scopeKey(scope);
    const runs=db.prepare('SELECT id,issued_at AS issuedAt,status,candidate_ids,completed_at AS completedAt,reason FROM style_review_runs WHERE scope=? ORDER BY issued_at DESC,rowid DESC LIMIT 12').all(scope)
      .map(({candidate_ids,...r})=>({...r,candidateCount:JSON.parse(candidate_ids).length}));
    return {enabled:!!enabled(),minimumIncoming:12,minimumSelf:3,intervalHours:24,globalMaximumPer24Hours:2,runs};
  }
  return { baseline,offer,submit,status,cancel,clear,invalidate };
}

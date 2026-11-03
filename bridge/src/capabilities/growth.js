// 能力一：形成自己的特点（有限、可追溯、可撤销的成长）
//
// task-0002 修复（对应审核问题 2、6、7）：
// - 注入时生成**批次**，并持久化到 cap_growth_batch；
// - 只有真实 send 回执的 message_id 才能记一次使用，且绑定 batch_id + 条目版本；
//   执行 ID / 会话 ID / 注入本身都不算“已发送”；
// - 后台可从真实目标（inner-life）与既有学习主题（learning-cycle）形成候选，
//   autoTrial 配置被真正消费，但“实际生效”仍然只能管理员确认；
// - 每条候选都绑定服务端校验过的来源（消息 / 目标），自己的回复永远不能当证据。
import crypto from 'node:crypto';
import { audit } from './store.js';

const KINDS = new Set(['interest', 'style']);

export function createGrowth({ db, config, sources, now = Date.now, log = () => {}, goalsForScope = () => [], learningTopicsForScope = () => [] }) {
  const cfg = () => config().growth || {};

  function row(id) {
    return db.prepare('SELECT * FROM cap_growth WHERE id=?').get(String(id)) || null;
  }
  function parse(rowValue) {
    if (!rowValue) return null;
    return { ...rowValue, sources: JSON.parse(rowValue.sources || '[]') };
  }
  function versionOf(rowValue) {
    return Number(rowValue?.updated_at || rowValue?.proposed_at || 0);
  }

  function propose({ scope, kind, content, sources: refs, origin = 'background', allowGoalSource = false }) {
    const c = cfg();
    if (c.enabled === false) throw httpError(403, '成长能力已关闭');
    if (!scope) throw httpError(400, '缺少会话 scope');
    if (!KINDS.has(kind)) throw httpError(400, 'kind 只能是 interest 或 style');
    const text = String(content ?? '').trim();
    if (text.length < 2 || text.length > 80) throw httpError(400, '变化内容需 2–80 字');

    const check = sources.verify(scope, refs);
    if (!check.ok) throw httpError(400, `来源校验未通过：${check.rejected.map((r) => `${r.ref || '(空)'}:${r.reason}`).join(', ')}`);
    const goalSources = check.verified.filter((v) => v.kind === 'goal');
    const messageSources = check.verified.filter((v) => v.kind !== 'goal');
    const need = Number(c.minSources || 3);
    if (allowGoalSource && goalSources.length >= 1) {
      // 目标类候选：至少一条真实目标 + 其余必须是真实消息（没有就只凭目标提出，标 proposed 等人工判断）
      if (messageSources.length === 0 && goalSources.length < 1) throw httpError(400, '目标类候选缺少来源');
    } else if (check.verified.length < need) {
      throw httpError(400, `至少需要 ${need} 条真实来源`);
    }
    if (messageSources.length && sources.distinctUsers(messageSources).length < Number(c.minDistinctUsers || 2)) {
      throw httpError(400, `消息来源需来自至少 ${c.minDistinctUsers || 2} 个不同的人`);
    }

    const activeCount = db.prepare("SELECT count(*) c FROM cap_growth WHERE scope=? AND status IN ('proposed','trial','active')").get(String(scope)).c;
    if (activeCount >= Number(c.capacity || 24)) throw httpError(409, '这个会话的成长条目已满，先暂停或撤销一些');
    if (db.prepare("SELECT id FROM cap_growth WHERE scope=? AND kind=? AND content=? AND status IN ('proposed','trial','active')").get(String(scope), kind, text)) {
      throw httpError(409, '同样的变化已经在跟踪中');
    }

    const t = now();
    const id = `g-${t.toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
    db.prepare(`INSERT INTO cap_growth(id,scope,kind,content,status,proposed_at,updated_at,sources,origin) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(id, String(scope), kind, text, 'proposed', t, t, JSON.stringify(check.verified), origin);
    audit(db, { module: 'growth', action: 'propose', actor: origin || 'background', scope, result: 'applied', detail: `${kind}:${text.slice(0, 60)}`, now: t });
    log(`[capabilities] 提出成长变化 ${id}（${kind}）来源 ${check.verified.length} 条`);
    if (c.autoTrial === true) {
      try { startTrial(id, 'background'); } catch (error) { log(`[capabilities] autoTrial 启动失败：${error?.message ?? error}`); }
    }
    return parse(row(id));
  }

  function transition(id, from, to, extra = {}, actor = 'admin') {
    const current = row(id);
    if (!current) throw httpError(404, '找不到这条成长变化');
    if (!from.includes(current.status)) throw httpError(409, `当前状态 ${current.status} 不能执行该操作`);
    const sets = ['status=?', 'updated_at=?'];
    const args = [to, now()];
    for (const [col, val] of Object.entries(extra)) { sets.push(`${col}=?`); args.push(val); }
    args.push(String(id));
    db.prepare(`UPDATE cap_growth SET ${sets.join(',')} WHERE id=?`).run(...args);
    audit(db, { module: 'growth', action: to, actor, scope: current.scope, result: 'applied', detail: String(id), now: now() });
    return parse(row(id));
  }

  function startTrial(id, actor = 'admin') {
    const manifest = transition(id, ['proposed', 'paused'], 'trial', { trial_at: now(), paused_at: null }, actor);
    log(`[capabilities] ${actor} 开始试用 ${id}`);
    return manifest;
  }

  /** 只有真实发送回执才能调用；messageId 必填。 */
  function recordUse({ id, scope, messageId, batchId }) {
    if (!messageId) return false;
    const current = row(id);
    if (!current) return false;
    if (current.status !== 'trial') return false;
    if (String(current.scope) !== String(scope)) return false;
    const batch = batchId ? db.prepare('SELECT * FROM cap_growth_batch WHERE scope=? AND batch_id=?').get(String(scope), String(batchId)) : null;
    if (batchId && !batch) return false;
    if (db.prepare('SELECT 1 x FROM cap_growth_use WHERE growth_id=? AND message_id=? LIMIT 1').get(String(id), String(messageId))) return false;
    db.prepare('UPDATE cap_growth SET uses=uses+1, injected_at=?, updated_at=? WHERE id=?').run(now(), now(), String(id));
    db.prepare('INSERT INTO cap_growth_use(id,growth_id,scope,reply_ref,batch_id,version,message_id,at) VALUES(?,?,?,?,?,?,?,?)')
      .run(`u-${now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`, String(id), String(scope),
        String(messageId), batch?.batch_id || null, versionOf(current), String(messageId), now());
    return true;
  }

  /** 实际生效：必须有绑定真实 message_id 的使用记录，且由管理员确认。 */
  function activate(id, actor = 'admin') {
    const current = row(id);
    if (!current) throw httpError(404, '找不到这条成长变化');
    if (current.status !== 'trial') throw httpError(409, '只有试用中的变化才能转为实际生效');
    const uses = db.prepare('SELECT count(*) c FROM cap_growth_use WHERE growth_id=? AND message_id IS NOT NULL AND message_id<>?').get(String(id), '').c;
    if (Number(uses) < 1) throw httpError(409, '还没有一次绑定真实发送回执的试用记录，不能标为已生效');
    if (actor !== 'admin') throw httpError(403, '实际生效只能由管理端确认');
    return transition(id, ['trial'], 'active', { active_at: now() }, actor);
  }

  function pause(id) { return transition(id, ['proposed', 'trial', 'active'], 'paused', { paused_at: now() }); }
  function revoke(id) { return transition(id, ['proposed', 'trial', 'active', 'paused'], 'revoked', { revoked_at: now() }); }
  function restore(id) { return transition(id, ['paused', 'revoked'], 'proposed', { paused_at: null, revoked_at: null }); }

  function list(scope, limit = 100) {
    return db.prepare('SELECT * FROM cap_growth WHERE scope=? ORDER BY proposed_at DESC LIMIT ?')
      .all(String(scope), Math.max(1, Math.min(200, limit))).map(parse);
  }

  function injection(scope) {
    const c = cfg();
    if (c.enabled === false) return { items: [], text: '', batchId: null };
    const rows = db.prepare("SELECT * FROM cap_growth WHERE scope=? AND status IN ('trial','active') ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, updated_at DESC LIMIT ?")
      .all(String(scope), Number(c.injectMax || 3)).map(parse);
    const picked = [];
    let used = 0;
    const maxChars = Number(c.injectMaxChars || 600);
    for (const item of rows) {
      const line = `- ${item.kind === 'interest' ? '兴趣' : '表达'}：${item.content}${item.status === 'trial' ? '（试用中）' : ''}`;
      if (used + line.length > maxChars) break;
      picked.push(item);
      used += line.length + 1;
    }
    if (!picked.length) return { items: [], text: '', batchId: null };
    const currentSignature = picked.map((i) => `${i.id}:${versionOf(i)}`).sort().join('|');
    // 同一轮内的多次读提示词复用批次；但条目/版本变了（新增、转正、暂停）就必须换新批次，
    // 不能把新注入的内容算到旧批次上。
    let batch = db.prepare('SELECT * FROM cap_growth_batch WHERE scope=?').get(String(scope));
    let batchItems = [];
    try { batchItems = batch ? JSON.parse(batch.items) : []; } catch { batchItems = []; }
    const batchSignature = batchItems.map((i) => `${i.id}:${Number(i.version)}`).sort().join('|');
    const fresh = batch && now() - Number(batch.created_at) < Number(c.batchTtlMinutes || 10) * 60000;
    const reuse = fresh && batchItems.length > 0 && batchSignature === currentSignature;
    let items = picked;
    if (!reuse) {
      const batchId = `b-${now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
      items = picked.map((i) => ({ id: i.id, version: versionOf(i), content: i.content, kind: i.kind }));
      db.prepare(
        `INSERT INTO cap_growth_batch(scope,batch_id,items,created_at) VALUES(?,?,?,?)
         ON CONFLICT(scope) DO UPDATE SET batch_id=excluded.batch_id, items=excluded.items, created_at=excluded.created_at,
           delivered_message_id=NULL, delivered_at=NULL`
      ).run(String(scope), batchId, JSON.stringify(items), now());
      batch = { batch_id: batchId, items: JSON.stringify(items) };
    } else {
      try { items = JSON.parse(batch.items); } catch { items = []; }
    }
    const text = '【自己的成长（试用中/已生效，不必刻意表现）】\n' + picked.map((i) => `- ${i.kind === 'interest' ? '兴趣' : '表达'}：${i.content}${i.status === 'trial' ? '（试用中）' : ''}`).join('\n');
    return { items: picked, text, batchId: batch.batch_id };
  }

  function batchForScope(scope) {
    const batch = db.prepare('SELECT * FROM cap_growth_batch WHERE scope=?').get(String(scope));
    if (!batch) return null;
    try { return { ...batch, items: JSON.parse(batch.items) }; } catch { return null; }
  }

  /** 真实发送成功后：把该批次里的试用条目绑定到这条 message_id。 */
  function recordDelivered({ scope, messageId, batchId }) {
    if (!messageId) return 0;
    const batch = batchId
      ? db.prepare('SELECT * FROM cap_growth_batch WHERE scope=? AND batch_id=?').get(String(scope), String(batchId))
      : db.prepare('SELECT * FROM cap_growth_batch WHERE scope=?').get(String(scope));
    if (!batch) return 0;
    let items = [];
    try { items = JSON.parse(batch.items); } catch { return 0; }
    let n = 0;
    for (const item of items) {
      const current = row(item.id);
      if (!current || current.status !== 'trial') continue;
      if (versionOf(current) !== Number(item.version)) continue;
      if (recordUse({ id: item.id, scope, messageId, batchId: batch.batch_id })) n++;
    }
    if (n) {
      db.prepare('UPDATE cap_growth_batch SET delivered_message_id=?, delivered_at=? WHERE scope=?')
        .run(String(messageId), now(), String(scope));
    }
    return n;
  }

  /**
   * 后台候选：从真实 inner-life 目标与既有学习主题形成候选（不直接生效）。
   * 目标来源登记为 kind='goal'，其余必须有真实消息；没有来源就不提。
   */
  function suggest(scope) {
    if (cfg().enabled === false) return { proposed: 0, skipped: 'disabled' };
    const proposal = [];
    const goals = (goalsForScope(scope) || []).filter((g) => g && (g.title || g.content));
    for (const goal of goals.slice(0, 3)) {
      const title = String(goal.title || goal.content).trim().slice(0, 60);
      if (!title) continue;
      const key = String(goal.id || title);
      const ref = `goal:${key}`;
      sources.record({ scope, ref, kind: 'goal', body: `目标：${title}`, userId: 'self', isSelf: false, meta: { goal: true } });
      try {
        const item = propose({ scope, kind: 'interest', content: `在意「${title}」`, sources: [{ ref }], origin: 'background', allowGoalSource: true });
        proposal.push(item);
      } catch { /* 已存在或来源不足就跳过 */ }
    }
    for (const topic of (learningTopicsForScope(scope) || []).slice(0, 3)) {
      const title = String(topic?.title || topic || '').trim().slice(0, 60);
      if (!title) continue;
      const ref = `lesson:${title}`;
      sources.record({ scope, ref, kind: 'goal', body: `学习主题：${title}`, userId: 'self', isSelf: false, meta: { learning: true } });
      try {
        proposal.push(propose({ scope, kind: 'interest', content: `想了解「${title}」`, sources: [{ ref }], origin: 'background', allowGoalSource: true }));
      } catch { /* 已存在 */ }
    }
    return { proposed: proposal.length, items: proposal };
  }

  /** 管理端只读预览：绝不创建/修改批次（GET 状态不能影响 agent 实际使用的批次）。 */
  function preview(scope) {
    const c = cfg();
    const rows = db.prepare("SELECT * FROM cap_growth WHERE scope=? AND status IN ('trial','active') ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, updated_at DESC LIMIT ?")
      .all(String(scope), Number(c.injectMax || 3)).map(parse);
    return {
      enabled: c.enabled !== false,
      items: rows.map((i) => ({ id: i.id, kind: i.kind, content: i.content, status: i.status, version: versionOf(i) })),
      batch: batchForScope(scope),
      note: '这里是只读预览；真实批次在 /api/socialV2/prompt 构建提示词时才创建'
    };
  }

  function status(scope) {
    const counts = {};
    for (const r of db.prepare('SELECT status, count(*) c FROM cap_growth WHERE scope=? GROUP BY status').all(String(scope))) counts[r.status] = r.c;
    const uses = scope
      ? db.prepare('SELECT count(*) c FROM cap_growth_use WHERE scope=? AND message_id IS NOT NULL AND message_id<>\'\'').get(String(scope)).c
      : 0;
    return {
      enabled: cfg().enabled !== false,
      autoTrial: cfg().autoTrial === true,
      counts,
      verifiedUses: uses,
      batch: scope ? batchForScope(scope) : null,
      capacity: Number(cfg().capacity || 24),
      recent: list(scope, 20)
    };
  }

  return { propose, startTrial, recordUse, recordDelivered, batchForScope, activate, pause, revoke, restore, list, injection, preview, suggest, status, row };
}

export function httpError(status, message) {
  const error = new Error(message);
  error.statusCode = status;
  return error;
}

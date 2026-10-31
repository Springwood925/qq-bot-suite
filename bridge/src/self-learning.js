// 机器人自主学习区：独立表、状态机、来源绑定、追加式审计。
// 只读写本模块自己的表，不修改记忆树/约定/系统经历与人设。
// 默认关闭（config.selfLearning.enabled=false），关闭时所有写入动作一律拒绝。

import { DatabaseSync } from 'node:sqlite';

const DAY = 86400000;
const MAX_TITLE = 120;
const MAX_CONTENT = 4000;
const MAX_REASON = 600;
const MAX_SOURCES = 8;
const MAX_USAGE = 200;

const KINDS = new Set(['knowledge', 'style']);
const STATUSES = new Set(['candidate', 'trial', 'retained', 'paused', 'archived', 'rejected']);
const SOURCE_TYPES = new Set(['tool', 'message', 'url']);

// 允许的状态迁移：终态只能回到 candidate 重新评估，不能直接跳到 trial/retained。
const TRANSITIONS = {
  candidate: ['trial', 'rejected', 'archived'],
  trial: ['retained', 'paused', 'rejected', 'archived'],
  retained: ['paused', 'archived'],
  paused: ['candidate', 'archived'],
  archived: ['candidate'],
  rejected: ['candidate']
};

// 由服务端决定的试用门槛（不是模型自评）。
const TRIAL_MIN_DAYS = 0;          // 起始即可用，到期由 expiresAt 控制
const RETAIN_MIN_USES = 5;         // 表达类至少 5 次真实适用
const RETAIN_MIN_DAYS_STYLE = 0;   // 天数限制由 expiresAt 表达
const TRIAL_DEFAULT_DAYS = 7;

const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };

function text(value, limit, label) {
  if (typeof value !== 'string') fail(label + ' 必须是字符串');
  const trimmed = value.trim();
  if (!trimmed) fail(label + ' 不能为空');
  if ([...trimmed].length > limit) fail(label + ' 超过 ' + limit + ' 字');
  return trimmed;
}

function optionalText(value, limit, label) {
  if (value === undefined || value === null || value === '') return null;
  return text(value, limit, label);
}

function idOf(value, label) {
  if (typeof value !== 'string' || !value.trim()) fail(label + ' 必须是字符串');
  return value.trim();
}

export function createSelfLearning({ db, file, now = () => Date.now(), scopeKey = (value) => value, log = () => {} }) {
  if (!db) {
    if (!file) throw new Error('self-learning 需要 db 或 file');
    db = new DatabaseSync(file);
    db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;');
  }
  if (typeof scopeKey !== 'function') throw new Error('self-learning 需要 scopeKey');

  db.exec(`CREATE TABLE IF NOT EXISTS self_learning (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    owner_type TEXT NOT NULL DEFAULT 'bot',
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    parent_id TEXT,
    goal_id TEXT,
    uncertainty TEXT,
    applicability TEXT,
    reason TEXT,
    risk_flags TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    reviewed_at INTEGER,
    expires_at INTEGER,
    retained_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS self_learning_scope_status ON self_learning(scope, status);
  CREATE INDEX IF NOT EXISTS self_learning_parent ON self_learning(parent_id);
  CREATE TABLE IF NOT EXISTS self_learning_sources (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL REFERENCES self_learning(id),
    scope TEXT NOT NULL,
    source_type TEXT NOT NULL,
    ref_id TEXT,
    url TEXT,
    fetched_at INTEGER NOT NULL,
    digest TEXT NOT NULL,
    note TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS self_learning_sources_entry ON self_learning_sources(entry_id);
  CREATE TABLE IF NOT EXISTS self_learning_audit (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    action TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT,
    version INTEGER,
    reason TEXT,
    actor TEXT NOT NULL,
    at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS self_learning_audit_entry ON self_learning_audit(entry_id, at);
  CREATE TABLE IF NOT EXISTS self_learning_usage (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL REFERENCES self_learning(id),
    scope TEXT NOT NULL,
    reply_id TEXT,
    conditions TEXT,
    outcome TEXT,
    at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS self_learning_usage_entry ON self_learning_usage(entry_id, at);
  CREATE TABLE IF NOT EXISTS self_learning_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );`);

  // node:sqlite 没有 better-sqlite3 的 db.transaction，这里用 savepoint 实现嵌套事务。
  let transactionDepth = 0, savepointId = 0;
  function transaction(fn) {
    const nested = transactionDepth > 0, name = 'self_learning_' + (++savepointId);
    db.exec(nested ? 'SAVEPOINT ' + name : 'BEGIN IMMEDIATE');
    transactionDepth++;
    try {
      const result = fn();
      db.exec(nested ? 'RELEASE ' + name : 'COMMIT');
      return result;
    } catch (error) {
      if (nested) { db.exec('ROLLBACK TO ' + name); db.exec('RELEASE ' + name); }
      else db.exec('ROLLBACK');
      throw error;
    } finally { transactionDepth--; }
  }

  let sequence = 0;
  function newId(prefix) {
    sequence = (sequence + 1) % 100000;
    const stamp = now().toString(36);
    const salt = Math.random().toString(36).slice(2, 8);
    return prefix + '_' + stamp + '_' + sequence.toString(36) + salt;
  }

  function audit(entryId, scope, action, fromStatus, toStatus, version, reason, actor) {
    db.prepare('INSERT INTO self_learning_audit VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(newId('aud'), entryId, scope, action, fromStatus || null, toStatus || null,
        Number.isInteger(version) ? version : null, reason || null, actor || 'bot', now());
  }

  // 所有对外动作都在这里校验 scope/owner，机器人自报归属不能越权。
  function scopeOf(input) {
    const raw = input && input.scope;
    if (typeof raw !== 'string' || !raw.trim()) fail('缺少会话作用域');
    const key = scopeKey(raw);
    if (typeof key !== 'string' || !key.trim()) fail('无效的会话作用域');
    return key;
  }

  function row(scope, id) {
    const found = db.prepare("SELECT * FROM self_learning WHERE scope=? AND owner_type='bot' AND id=?")
      .get(scope, String(id));
    if (!found) fail('找不到该学习条目', 404);
    return found;
  }

  function requireVersion(current, version) {
    if (version === undefined || version === null) return;
    const expected = Number(version);
    if (!Number.isSafeInteger(expected) || expected !== current.version) {
      fail('版本已过期（当前 ' + current.version + '）', 409);
    }
  }

  function assertTransition(from, to) {
    const allowed = TRANSITIONS[from] || [];
    if (!allowed.includes(to)) fail('不允许从 ' + from + ' 变更到 ' + to, 409);
  }

  function parseSources(entryId, scope, list) {
    if (!Array.isArray(list) || list.length === 0) fail('至少需要一个可验证来源');
    if (list.length > MAX_SOURCES) fail('来源超过 ' + MAX_SOURCES + ' 条');
    const stored = [];
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') fail('来源格式不正确');
      const type = String(raw.type || '').toLowerCase();
      if (!SOURCE_TYPES.has(type)) fail('来源类型必须是 tool/message/url');
      const fetchedAt = Number(raw.fetchedAt);
      if (!Number.isSafeInteger(fetchedAt) || fetchedAt <= 0) fail('来源缺少获取时间');
      if (fetchedAt > now() + 5 * 60000) fail('来源获取时间不能在未来');
      const digest = typeof raw.digest === 'string' ? raw.digest.trim() : '';
      if (!/^[0-9a-f]{16,64}$/i.test(digest)) fail('来源缺少可复核摘要（hex 16~64 位）');
      let refId = null, url = null;
      if (type === 'url') {
        url = typeof raw.url === 'string' ? raw.url.trim() : '';
        if (!/^https?:\/\//i.test(url)) fail('网页来源必须是 http(s) 地址');
        if ([...url].length > 2000) fail('来源地址过长');
      } else {
        refId = typeof raw.refId === 'string' ? raw.refId.trim() : '';
        if (!refId) fail('工具/消息来源必须给出服务端可核对的引用 ID');
        if ([...refId].length > 200) fail('来源引用 ID 过长');
      }
      const note = optionalText(raw.note, 400, '来源说明');
      db.prepare('INSERT INTO self_learning_sources VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(newId('src'), entryId, scope, type, refId, url, fetchedAt, digest.toLowerCase(), note, now());
      stored.push({ type, refId, url, fetchedAt, digest: digest.toLowerCase() });
    }
    return stored;
  }

  function sourcesOf(entryId) {
    return db.prepare('SELECT * FROM self_learning_sources WHERE entry_id=? ORDER BY created_at ASC')
      .all(entryId)
      .map((row) => ({
        type: row.source_type,
        refId: row.ref_id,
        url: row.url,
        fetchedAt: row.fetched_at,
        digest: row.digest,
        note: row.note
      }));
  }

  function usageOf(entryId, limit = MAX_USAGE) {
    return db.prepare('SELECT * FROM self_learning_usage WHERE entry_id=? ORDER BY at DESC LIMIT ?')
      .all(entryId, limit)
      .map((row) => ({ replyId: row.reply_id, conditions: row.conditions, outcome: row.outcome, at: row.at }));
  }

  function publicRow(found) {
    return {
      id: found.id,
      scope: found.scope,
      ownerType: found.owner_type,
      kind: found.kind,
      title: found.title,
      content: found.content,
      status: found.status,
      version: found.version,
      parentId: found.parent_id,
      goalId: found.goal_id,
      uncertainty: found.uncertainty,
      applicability: found.applicability,
      reason: found.reason,
      riskFlags: JSON.parse(found.risk_flags || '[]'),
      createdAt: found.created_at,
      updatedAt: found.updated_at,
      reviewedAt: found.reviewed_at,
      expiresAt: found.expires_at,
      retainedAt: found.retained_at,
      sources: sourcesOf(found.id),
      usage: usageOf(found.id, 20)
    };
  }

  function list(input = {}) {
    const scope = scopeOf(input);
    const clauses = ["scope=?", "owner_type='bot'"];
    const params = [scope];
    if (input.status) {
      const status = String(input.status);
      if (!STATUSES.has(status)) fail('未知状态');
      clauses.push('status=?');
      params.push(status);
    }
    if (input.kind) {
      const kind = String(input.kind);
      if (!KINDS.has(kind)) fail('未知类型');
      clauses.push('kind=?');
      params.push(kind);
    }
    const limit = Number(input.limit);
    const bounded = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 100) : 50;
    const rows = db.prepare('SELECT * FROM self_learning WHERE ' + clauses.join(' AND ') +
      ' ORDER BY updated_at DESC, rowid DESC LIMIT ?').all(...params, bounded);
    return {
      total: rows.length,
      entries: rows.map((found) => ({
        id: found.id,
        kind: found.kind,
        title: found.title,
        status: found.status,
        version: found.version,
        updatedAt: found.updated_at,
        expiresAt: found.expires_at,
        uncertainty: found.uncertainty
      }))
    };
  }

  function read(input = {}) {
    const scope = scopeOf(input);
    const found = row(scope, idOf(input.id, '条目 ID'));
    return publicRow(found);
  }

  function collect(input = {}) {
    const scope = scopeOf(input);
    const kind = String(input.kind || '').toLowerCase();
    if (!KINDS.has(kind)) fail('类型必须是 knowledge 或 style');
    const title = text(input.title, MAX_TITLE, '标题');
    const content = text(input.content, MAX_CONTENT, '内容');
    const uncertainty = optionalText(input.uncertainty, 400, '不确定之处');
    const applicability = optionalText(input.applicability, 400, '适用范围');
    const reason = optionalText(input.reason, MAX_REASON, '理由');
    const goalId = optionalText(input.goalId, 100, '目标 ID');
    // 表达类条目必须是简短的取舍原则，不能塞固定话术。
    if (kind === 'style' && [...content].length > 200) fail('表达条目内容不能超过 200 字');
    const id = newId('sl');
    const at = now();
    const expiresAt = at + TRIAL_DEFAULT_DAYS * DAY * 10; // 候选期给足复核窗口
    const record = {
      id, scope, kind, title, content, status: 'candidate', version: 1,
      parentId: null, goalId, uncertainty, applicability, reason,
      createdAt: at, updatedAt: at, expiresAt
    };
    transaction(() => {
      db.prepare('INSERT INTO self_learning (id,scope,owner_type,kind,title,content,status,version,parent_id,goal_id,uncertainty,applicability,reason,risk_flags,created_at,updated_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, scope, 'bot', kind, title, content, 'candidate', 1, null, goalId, uncertainty, applicability, reason, '[]', at, at, expiresAt);
      parseSources(id, scope, input.sources);
      audit(id, scope, 'collect', null, 'candidate', 1, reason, 'bot');
    });
    log('self-learning collect ' + id + ' kind=' + kind + ' scope=' + scope);
    return { id, status: 'candidate', version: 1, expiresAt };
  }

  // 修订创建新版本，不覆盖旧记录与来源历史。
  function revise(input = {}) {
    const scope = scopeOf(input);
    const current = row(scope, idOf(input.id, '条目 ID'));
    requireVersion(current, input.version);
    if (current.status === 'archived' || current.status === 'rejected') fail('已归档/已否决的条目需先恢复再修订', 409);
    const title = input.title === undefined ? current.title : text(input.title, MAX_TITLE, '标题');
    const content = input.content === undefined ? current.content : text(input.content, MAX_CONTENT, '内容');
    if (current.kind === 'style' && [...content].length > 200) fail('表达条目内容不能超过 200 字');
    const applicability = input.applicability === undefined
      ? current.applicability
      : optionalText(input.applicability, 400, '适用范围');
    const uncertainty = input.uncertainty === undefined
      ? current.uncertainty
      : optionalText(input.uncertainty, 400, '不确定之处');
    const reason = optionalText(input.reason, MAX_REASON, '理由');
    const at = now();
    const nextVersion = current.version + 1;
    const nextId = newId('sl');
    transaction(() => {
      db.prepare('UPDATE self_learning SET status=?, updated_at=? WHERE scope=? AND id=?')
        .run('archived', at, scope, current.id);
      db.prepare('INSERT INTO self_learning (id,scope,owner_type,kind,title,content,status,version,parent_id,goal_id,uncertainty,applicability,reason,risk_flags,created_at,updated_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(nextId, scope, 'bot', current.kind, title, content, 'candidate', nextVersion, current.id,
          current.goal_id, uncertainty, applicability, reason, current.risk_flags, at, at,
          at + TRIAL_DEFAULT_DAYS * DAY * 10);
      if (Array.isArray(input.sources) && input.sources.length) parseSources(nextId, scope, input.sources);
      else {
        // 沿用旧来源，但明确标注继承关系。
        for (const source of db.prepare('SELECT * FROM self_learning_sources WHERE entry_id=?').all(current.id)) {
          db.prepare('INSERT INTO self_learning_sources VALUES (?,?,?,?,?,?,?,?,?,?)')
            .run(newId('src'), nextId, scope, source.source_type, source.ref_id, source.url,
              source.fetched_at, source.digest, source.note, at);
        }
      }
      audit(current.id, scope, 'revise', current.status, 'archived', current.version, reason, 'bot');
      audit(nextId, scope, 'revise', null, 'candidate', nextVersion, reason, 'bot');
    });
    return { id: nextId, parentId: current.id, status: 'candidate', version: nextVersion };
  }

  function changeStatus(input, action, to, actor = 'bot') {
    const scope = scopeOf(input);
    const current = row(scope, idOf(input.id, '条目 ID'));
    requireVersion(current, input.version);
    assertTransition(current.status, to);
    const reason = optionalText(input.reason, MAX_REASON, '理由');
    const at = now();
    const patch = { status: to, updated_at: at };
    if (to === 'retained') patch.retained_at = at;
    if (to === 'trial') patch.expires_at = at + TRIAL_DEFAULT_DAYS * DAY;
    if (to === 'candidate') patch.expires_at = at + TRIAL_DEFAULT_DAYS * DAY * 10;
    transaction(() => {
      const sets = Object.keys(patch).map((key) => key + '=?').join(',');
      db.prepare('UPDATE self_learning SET ' + sets + ' WHERE scope=? AND id=?')
        .run(...Object.values(patch), scope, current.id);
      if (to === 'retained' || to === 'paused' || to === 'rejected') {
        db.prepare('UPDATE self_learning SET reviewed_at=? WHERE scope=? AND id=?').run(at, scope, current.id);
      }
      audit(current.id, scope, action, current.status, to, current.version, reason, actor);
    });
    return { id: current.id, from: current.status, to, version: current.version };
  }

  function startTrial(input = {}) { return changeStatus(input, 'start_trial', 'trial'); }
  function pause(input = {}) { return changeStatus(input, 'pause', 'paused'); }
  function archive(input = {}) { return changeStatus(input, 'archive', 'archived'); }
  function restore(input = {}) { return changeStatus(input, 'restore', 'candidate'); }
  function reject(input = {}) { return changeStatus(input, 'reject', 'rejected'); }

  // 记录一次真实使用，并给出是否满足留用门槛。
  function review(input = {}) {
    const scope = scopeOf(input);
    const current = row(scope, idOf(input.id, '条目 ID'));
    if (current.status !== 'trial') fail('只有试用中的条目可以记录使用', 409);
    const replyId = optionalText(input.replyId, 200, '回复引用');
    if (!replyId) fail('必须给出本次真实回复的引用 ID');
    const conditions = optionalText(input.conditions, 400, '当时条件');
    const outcome = String(input.outcome || '').toLowerCase();
    if (!['positive', 'negative', 'neutral'].includes(outcome)) fail('结果必须是 positive/negative/neutral');
    const at = now();
    transaction(() => {
      db.prepare('INSERT INTO self_learning_usage VALUES (?,?,?,?,?,?,?)')
        .run(newId('use'), current.id, scope, replyId, conditions, outcome, at);
      db.prepare('UPDATE self_learning SET updated_at=?, reviewed_at=? WHERE scope=? AND id=?')
        .run(at, at, scope, current.id);
      audit(current.id, scope, 'review', current.status, current.status, current.version, outcome, 'bot');
    });
    const uses = db.prepare("SELECT count(*) AS c FROM self_learning_usage WHERE entry_id=? AND outcome='positive'").get(current.id).c;
    const negatives = db.prepare("SELECT count(*) AS c FROM self_learning_usage WHERE entry_id=? AND outcome='negative'").get(current.id).c;
    const expired = Number.isSafeInteger(current.expires_at) && current.expires_at < at;
    let eligible = false;
    if (current.kind === 'style') eligible = !expired && uses >= RETAIN_MIN_USES && negatives === 0;
    else eligible = !expired && uses >= 1;
    return { id: current.id, positiveUses: uses, negativeUses: negatives, expired, eligible };
  }

  // 留用走服务端门槛：表达类必须达到真实使用次数且无负面证据。
  function retain(input = {}) {
    const scope = scopeOf(input);
    const current = row(scope, idOf(input.id, '条目 ID'));
    if (current.status !== 'trial') fail('只有试用中的条目可以留用', 409);
    const uses = db.prepare("SELECT count(*) AS c FROM self_learning_usage WHERE entry_id=? AND outcome='positive'").get(current.id).c;
    const negatives = db.prepare("SELECT count(*) AS c FROM self_learning_usage WHERE entry_id=? AND outcome='negative'").get(current.id).c;
    const expired = Number.isSafeInteger(current.expires_at) && current.expires_at < now();
    if (current.kind === 'style') {
      if (expired) fail('试用期已过，不能留用', 409);
      if (negatives > 0) fail('存在负面证据，不能留用', 409);
      if (uses < RETAIN_MIN_USES) fail('真实适用次数不足（' + uses + '/' + RETAIN_MIN_USES + '）', 409);
    } else if (expired) {
      fail('条目已过期，需重新核对来源', 409);
    }
    const reason = input.reason === undefined ? '达到留用门槛' : optionalText(input.reason, MAX_REASON, '理由');
    return changeStatus({ ...input, reason }, 'retain', 'retained');
  }

  function overview(input = {}) {
    const scope = scopeOf(input);
    const counts = {};
    for (const status of STATUSES) {
      counts[status] = db.prepare("SELECT count(*) AS c FROM self_learning WHERE scope=? AND owner_type='bot' AND status=?")
        .get(scope, status).c;
    }
    const recent = db.prepare("SELECT * FROM self_learning WHERE scope=? AND owner_type='bot' ORDER BY updated_at DESC LIMIT 5")
      .all(scope)
      .map((found) => ({ id: found.id, kind: found.kind, title: found.title, status: found.status, updatedAt: found.updated_at }));
    return { scope, counts, recent };
  }

  // 注入用：只返回试用中且未过期的条目，条数与字数都有硬上限。
  function injection(input = {}) {
    const scope = scopeOf(input);
    const limit = Number.isSafeInteger(Number(input.limit)) ? Math.min(Math.max(Number(input.limit), 1), 3) : 1;
    const budget = Number.isSafeInteger(Number(input.budget)) ? Math.min(Math.max(Number(input.budget), 20), 400) : 160;
    const at = now();
    const rows = db.prepare("SELECT * FROM self_learning WHERE scope=? AND owner_type='bot' AND status='trial' ORDER BY updated_at DESC LIMIT ?")
      .all(scope, limit * 3);
    const picked = [];
    let used = 0;
    for (const found of rows) {
      if (picked.length >= limit) break;
      if (Number.isSafeInteger(found.expires_at) && found.expires_at < at) continue;
      const line = '· ' + found.content;
      if (used + [...line].length > budget) continue;
      used += [...line].length;
      picked.push({ id: found.id, kind: found.kind, content: found.content, version: found.version });
    }
    return { items: picked, usedChars: used, budget };
  }

  function diagnostics(input = {}) {
    const scope = scopeOf(input);
    const at = now();
    const total = db.prepare("SELECT count(*) AS c FROM self_learning WHERE scope=? AND owner_type='bot'").get(scope).c;
    const expiredTrial = db.prepare("SELECT count(*) AS c FROM self_learning WHERE scope=? AND owner_type='bot' AND status='trial' AND expires_at < ?").get(scope, at).c;
    const auditCount = db.prepare('SELECT count(*) AS c FROM self_learning_audit WHERE scope=?').get(scope).c;
    return { scope, total, expiredTrial, auditCount, serverGates: { retainMinUses: RETAIN_MIN_USES, trialDefaultDays: TRIAL_DEFAULT_DAYS } };
  }

  return {
    collect, list, read, revise, startTrial, review, retain, pause, archive, restore, reject,
    overview, injection, diagnostics
  };
}

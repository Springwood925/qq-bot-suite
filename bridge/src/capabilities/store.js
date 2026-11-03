// 八类能力的 SQLite 存储层。
//
// 设计要点：
// - 使用项目既有的 node:sqlite（memory-tree.sqlite 同款），不引入新依赖、不联网。
// - 独立数据库 state/capabilities.db：不改动记忆库/学习库的结构，部署时不用迁移既有表。
// - 迁移只做 CREATE TABLE IF NOT EXISTS + 追加列；迁移前自动做一次 VACUUM INTO 备份，
//   备份路径写进 cap_meta，回退时可读。
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const SCHEMA_VERSION = 2;

const TABLES = [
  `CREATE TABLE IF NOT EXISTS cap_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  // 运行时配置覆盖（管理端写这里，不重写 config.json）
  `CREATE TABLE IF NOT EXISTS cap_config(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)`,
  // 服务端登记的真实来源：只有 observe 时实际收到的消息 / 实际取回的工具结果能进这里
  `CREATE TABLE IF NOT EXISTS cap_sources(
     scope TEXT NOT NULL, ref TEXT NOT NULL, kind TEXT NOT NULL, digest TEXT NOT NULL,
     body TEXT NOT NULL, user_id TEXT, user_name TEXT, meta TEXT,
     is_self INTEGER NOT NULL DEFAULT 0, url TEXT,
     at INTEGER NOT NULL, PRIMARY KEY(scope, ref))`,
  // 自己特点（兴趣/表达习惯）的有限成长
  `CREATE TABLE IF NOT EXISTS cap_growth(
     id TEXT PRIMARY KEY, scope TEXT NOT NULL, kind TEXT NOT NULL, content TEXT NOT NULL,
     status TEXT NOT NULL, proposed_at INTEGER NOT NULL, trial_at INTEGER, active_at INTEGER,
     paused_at INTEGER, revoked_at INTEGER, uses INTEGER NOT NULL DEFAULT 0,
     injected_at INTEGER, updated_at INTEGER, sources TEXT NOT NULL, reason TEXT, origin TEXT)`,
  // 一次回复使用记录：必须绑定真实 send 回执的 message_id + 注入批次 + 条目版本
  `CREATE TABLE IF NOT EXISTS cap_growth_use(
     id TEXT PRIMARY KEY, growth_id TEXT NOT NULL, scope TEXT NOT NULL, reply_ref TEXT,
     batch_id TEXT, version INTEGER, message_id TEXT, at INTEGER NOT NULL)`,
  // 注入批次：跨重启可查，避免同一批被重复计算
  `CREATE TABLE IF NOT EXISTS cap_growth_batch(
     scope TEXT PRIMARY KEY, batch_id TEXT NOT NULL, items TEXT NOT NULL, created_at INTEGER NOT NULL,
     delivered_message_id TEXT, delivered_at INTEGER)`,
  // 群文化摘要（按 scope + persona 隔离）
  `CREATE TABLE IF NOT EXISTS cap_group_culture(
     scope TEXT PRIMARY KEY, persona TEXT NOT NULL, summary TEXT NOT NULL,
     cursor INTEGER NOT NULL DEFAULT 0, messages INTEGER NOT NULL DEFAULT 0,
     updated_at INTEGER NOT NULL)`,
  // 自己的活动：统一调度任务
  `CREATE TABLE IF NOT EXISTS cap_activity_job(
     id TEXT PRIMARY KEY, scope TEXT, kind TEXT NOT NULL, topic TEXT NOT NULL,
     status TEXT NOT NULL, dedupe_key TEXT NOT NULL, started_at INTEGER NOT NULL,
     finished_at INTEGER, attempts INTEGER NOT NULL DEFAULT 1, error TEXT, evidence TEXT,
     visibility TEXT NOT NULL DEFAULT 'scope', publish_ok INTEGER NOT NULL DEFAULT 0)`,
  // 额度：按 模块:动作:日 / :小时 计数；check 时事务预留，避免并发超发
  `CREATE TABLE IF NOT EXISTS cap_quota(key TEXT PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)`,
  // 对外的动作（含演练与失败）——明细审计
  `CREATE TABLE IF NOT EXISTS cap_presence(
     id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, payload TEXT,
     response TEXT, error TEXT, created_at INTEGER NOT NULL, applied_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS cap_presence_backup(
     kind TEXT PRIMARY KEY, backup_path TEXT, value TEXT, captured_at INTEGER NOT NULL)`,
  // 自动计划：同一目标同一自然日只跑一次
  `CREATE TABLE IF NOT EXISTS cap_presence_plan(
     kind TEXT NOT NULL, day TEXT NOT NULL, status TEXT NOT NULL, at INTEGER NOT NULL,
     detail TEXT, PRIMARY KEY(kind, day))`,
  // 复读候选序列：记录每个群最后一条消息，用于“连续两人同文”判定
  `CREATE TABLE IF NOT EXISTS cap_repeat_state(
     scope TEXT PRIMARY KEY, last_user TEXT, last_text TEXT, last_at INTEGER, last_message_id TEXT)`,
  `CREATE TABLE IF NOT EXISTS cap_repeat(
     id TEXT PRIMARY KEY, scope TEXT NOT NULL, source_ref TEXT NOT NULL, text TEXT NOT NULL,
     at INTEGER NOT NULL)`,
  // 复读发送前持久 claim：防并发双发、跨重启不重发；status=sending/done/failed/cancelled/unknown
  `CREATE TABLE IF NOT EXISTS cap_repeat_claim(
     scope TEXT PRIMARY KEY, pair_key TEXT NOT NULL, source_ref TEXT NOT NULL, text_norm TEXT NOT NULL,
     claimed_at INTEGER NOT NULL, status TEXT NOT NULL, message_id TEXT, error TEXT)`,
  // 合并转发/卡片：内容指纹、节点正文、来源、过期、确认、发送幂等
  `CREATE TABLE IF NOT EXISTS cap_transfer(
     id TEXT PRIMARY KEY, scope TEXT NOT NULL, source_ref TEXT NOT NULL, fingerprint TEXT NOT NULL,
     kind TEXT NOT NULL, title TEXT, excerpt TEXT NOT NULL, nodes TEXT,
     trust TEXT NOT NULL DEFAULT 'untrusted',
     status TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
     confirmed_at INTEGER, relayed_at INTEGER, target TEXT,
     sent_message_id TEXT, claimed_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT)`,
  // 语音合成记录（不含音频本体）
  `CREATE TABLE IF NOT EXISTS cap_voice_log(
     id TEXT PRIMARY KEY, provider TEXT NOT NULL, chars INTEGER NOT NULL, status TEXT NOT NULL,
     error TEXT, at INTEGER NOT NULL)`,
  // 统一审计：后台写动作与管理员手动动作都写这里
  `CREATE TABLE IF NOT EXISTS cap_action(
     id TEXT PRIMARY KEY, module TEXT NOT NULL, action TEXT NOT NULL, actor TEXT NOT NULL,
     scope TEXT, result TEXT NOT NULL, detail TEXT, at INTEGER NOT NULL)`
];

/** 已有库追加列（幂等）。迁移不删表、不重建，旧数据保持可读。 */
function ensureColumn(db, table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

export function openStore(file, { log = () => {} } = {}) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL;');
  db.exec('PRAGMA busy_timeout=3000;');
  for (const sql of TABLES) db.exec(sql);
  const get = (k) => db.prepare('SELECT value FROM cap_meta WHERE key=?').get(k)?.value;
  const set = (k, v) => db.prepare('INSERT INTO cap_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(String(k), String(v));
  const version = Number(get('schema_version') || 0);
  if (version > SCHEMA_VERSION) throw new Error(`capabilities.db schema ${version} 高于本代码支持的 ${SCHEMA_VERSION}`);
  if (version < SCHEMA_VERSION) {
    // 迁移前备份（VACUUM INTO 是一致性快照；空库也可以备份）
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backup = `${file}.bak-${stamp}`;
      db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
      set('last_migration_backup', backup);
      log(`[capabilities] 迁移前备份：${backup}`);
    } catch (error) {
      log(`[capabilities] 迁移前备份失败（继续，但请人工确认）：${error?.message ?? error}`);
    }
  }
  // v1 → v2：补列（幂等），旧数据不动
  ensureColumn(db, 'cap_growth', 'updated_at', 'INTEGER');
  ensureColumn(db, 'cap_growth_use', 'batch_id', 'TEXT');
  ensureColumn(db, 'cap_growth_use', 'version', 'INTEGER');
  ensureColumn(db, 'cap_growth_use', 'message_id', 'TEXT');
  ensureColumn(db, 'cap_activity_job', 'visibility', "TEXT NOT NULL DEFAULT 'scope'");
  ensureColumn(db, 'cap_activity_job', 'publish_ok', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'cap_transfer', 'nodes', 'TEXT');
  ensureColumn(db, 'cap_transfer', 'sent_message_id', 'TEXT');
  ensureColumn(db, 'cap_transfer', 'claimed_at', 'INTEGER');
  ensureColumn(db, 'cap_transfer', 'attempts', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'cap_transfer', 'last_error', 'TEXT');
  set('schema_version', SCHEMA_VERSION);
  return { db, file, close: () => { try { db.close(); } catch { /* ignore */ } } };
}

/** 读运行时覆盖（只读，供 status 与 effectiveConfig 用）。 */
export function readOverrides(db) {
  const out = {};
  for (const row of db.prepare('SELECT key,value FROM cap_config').all()) {
    const parts = String(row.key).split('.');
    let cur = out;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    try { cur[parts.at(-1)] = JSON.parse(row.value); } catch { cur[parts.at(-1)] = row.value; }
  }
  return out;
}

export function writeOverride(db, key, value, now) {
  db.prepare('INSERT INTO cap_config(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at')
    .run(String(key), JSON.stringify(value), now);
}

export function audit(db, { module, action, actor, scope = null, result, detail = null, now }) {
  db.prepare('INSERT INTO cap_action(id,module,action,actor,scope,result,detail,at) VALUES(?,?,?,?,?,?,?,?)')
    .run(`${module}-${now}-${Math.random().toString(36).slice(2, 8)}`, module, action, actor || 'unknown', scope, result, detail, now);
}

export function recentActions(db, limit = 40) {
  return db.prepare('SELECT * FROM cap_action ORDER BY at DESC LIMIT ?').all(Math.max(1, Math.min(200, limit)));
}

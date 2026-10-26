// SQLite 连接生命周期与有界语句缓存；不缓存查询结果，不修改记忆或召回规则。
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export function createMemoryDatabase(file, { log = () => {}, cacheLimit = 128,
  checkpointIntervalMs = 600000, walThresholdBytes = 4000000 } = {}) {
  const connection = new DatabaseSync(file);
  const statements = new Map();
  let closed = false, hits = 0, misses = 0;
  function prepare(sql) {
    if (closed) throw new Error('记忆数据库已关闭');
    if (statements.has(sql)) {
      const statement = statements.get(sql);
      statements.delete(sql);
      statements.set(sql, statement);
      hits++;
      return statement;
    }
    misses++;
    const statement = connection.prepare(sql);
    if (cacheLimit > 0) {
      statements.set(sql, statement);
      while (statements.size > cacheLimit) statements.delete(statements.keys().next().value);
    }
    return statement;
  }
  function checkpoint({ force = false } = {}) {
    if (closed || connection.isTransaction) return { skipped: true };
    let beforeBytes;
    try { beforeBytes = fs.statSync(file + '-wal').size; }
    catch (error) { if (error.code === 'ENOENT') return { skipped: true }; throw error; }
    if (!force && beforeBytes < walThresholdBytes) return { skipped: true, beforeBytes };
    // 有长读事务时立即返回 busy，下一次维护再试，绝不等待机器人正在用的连接。
    const timeout = connection.prepare('PRAGMA busy_timeout').get().timeout;
    try {
      connection.exec('PRAGMA busy_timeout=0');
      const result = connection.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
      return { ...result, beforeBytes, afterBytes: fs.statSync(file + '-wal').size };
    } finally { connection.exec('PRAGMA busy_timeout=' + timeout); }
  }
  const timer = checkpointIntervalMs > 0 ? setInterval(() => {
    try { checkpoint(); } catch (error) { log('记忆数据库维护稍后重试：' + error.message); }
  }, checkpointIntervalMs) : null;
  timer?.unref();
  return {
    prepare,
    exec: sql => connection.exec(sql),
    checkpoint,
    diagnostics: () => ({ cached: statements.size, hits, misses, closed }),
    close() {
      if (closed) return;
      if (timer) clearInterval(timer);
      try { checkpoint({ force: true }); } catch (error) { log('记忆数据库关闭检查点跳过：' + error.message); }
      statements.clear();
      connection.close();
      closed = true;
    }
  };
}

// 群聊 / 私聊历史记录的关键词搜索（2026-09-28 加）
//
// 为什么不走 OneBot 的 get_group_msg_history：
//   · 实测单次上限 200 条 —— count=500/1000/2000/5000 一律只返回 200 条；
//     翻页游标不是 message_seq（传了没用，仍返回同一窗口），而是 message_id；
//     每 200 条约 2.9 秒 —— 搜 10 天（约 9000 条）要 2 分钟，没法当工具用。
//   · 直接只读 SnowLuma 自己的 messages.db（SQLite + WAL），13k 行全库 LIKE 只要 12~34ms。
//   · 代价：和 SnowLuma 的内部存储结构耦合，schema 变了这里就失败 ——
//     所以 bridge.js 保留了 get_group_msg_history 翻页的降级路径（source: 'onebot-api'）。
//
// ⚠️ 只读打开，绝不写：这是 SnowLuma 的私有数据，写坏会毁掉它的会话状态。
// ⚠️ 数据库里 timestamp 列 == JSON 里的 time（unix 秒），两者实测完全相等，可直接用于过滤/排序。

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

function resolveDefaultRoot() {
  if (process.env.SNOWLUMA_DIR) return process.env.SNOWLUMA_DIR;
  try {
    const txt = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'snowluma-path.txt');
    const value = fs.readFileSync(txt, 'utf8').trim();
    if (value) return value;
  } catch { /* 没有配置文件就用环境变量 */ }
  return '';
}
const DEFAULT_ROOT = resolveDefaultRoot();

/**
 * 在 SnowLuma 根目录下定位当前账号的 messages.db。
 * 一台机器上可能有多个账号目录（登录过几个 QQ 就有几个），
 * 取最近写入的那个 —— 不写死账号号，避免换号或升级后失效。
 */
export function findMessagesDb(root = DEFAULT_ROOT) {
  const dataDir = path.join(root, 'data');
  let entries;
  try { entries = fs.readdirSync(dataDir, { withFileTypes: true }); } catch { return null; }
  let best = null;
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const file = path.join(dataDir, e.name, 'messages.db');
    try {
      const st = fs.statSync(file);
      if (!best || st.mtimeMs > best.mtimeMs) best = { file, account: e.name, mtimeMs: st.mtimeMs };
    } catch { /* 该账号没有消息库，跳过 */ }
  }
  return best;
}

/** 兜底：剥掉 raw_message 里的 CQ 码。 */
function stripCq(s) {
  return String(s ?? '').replace(/\[CQ:[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
}

/** 把 OneBot 的 message 段数组拼成可读文本（图片/表情/语音只留占位符）。 */
export function segmentsToText(message) {
  if (typeof message === 'string') return stripCq(message);
  if (!Array.isArray(message)) return '';
  const parts = [];
  for (const seg of message) {
    const d = seg?.data ?? {};
    switch (seg?.type) {
      case 'text': parts.push(String(d.text ?? '')); break;
      case 'at': parts.push(`@${d.qq ?? ''}`); break;
      case 'image': parts.push('[图片]'); break;
      case 'face': parts.push('[表情]'); break;
      case 'record': parts.push('[语音]'); break;
      case 'video': parts.push('[视频]'); break;
      case 'forward': parts.push('[转发]'); break;
      case 'reply': break;               // 引用段本身没有内容
      default: break;
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** LIKE 里的通配符转义（配合 SQL 的 ESCAPE '\'）。 */
function escapeLike(kw) {
  return String(kw).replace(/[\\%_]/g, (c) => '\\' + c);
}

/**
 * 按关键词搜一个会话的历史记录。
 * @returns {{ok:boolean, source?:string, dbPath?:string, account?:string,
 *            totalMatches?:number, matchCount?:number, results?:Array,
 *            truncated?:boolean, error?:string}}
 */
export function searchHistory(options = {}) {
  const {
    root = DEFAULT_ROOT,
    isGroup = true,
    sessionId,
    keyword,
    limit = 20,
    maxAgeDays = 30,
    maxTextChars = 80,
    dbPath = null
  } = options;

  const kw = String(keyword ?? '').trim();
  if (!kw) return { ok: false, error: 'keyword 不能为空' };

  const sid = Number(sessionId);
  if (!Number.isFinite(sid) || sid <= 0) return { ok: false, error: 'sessionId 无效' };

  const found = dbPath ? { file: dbPath, account: '?' } : findMessagesDb(root);
  if (!found) {
    return { ok: false, error: `找不到 SnowLuma 的 messages.db（${path.join(root, 'data', '*', 'messages.db')}）` };
  }

  let db;
  try {
    db = new DatabaseSync(found.file, { readOnly: true });
  } catch (error) {
    return { ok: false, error: `打开消息库失败：${error?.message ?? error}`, dbPath: found.file };
  }

  try {
    const cap = Math.min(100, Math.max(1, Number(limit) || 20));
    const days = Math.max(0, Number(maxAgeDays) || 0);
    const since = days > 0 ? Math.floor(Date.now() / 1000) - days * 86400 : 0;
    const groupFlag = isGroup ? 1 : 0;
    const like = '%' + escapeLike(kw) + '%';

    const where = "is_group = ? AND session_id = ? AND timestamp >= ? AND data LIKE ? ESCAPE '\\'";
    const totalRow = db.prepare(`SELECT COUNT(*) AS c FROM messages WHERE ${where}`).get(groupFlag, sid, since, like);
    const totalMatches = Number(totalRow?.c ?? 0);

    // data LIKE 命中的可能只是图片 URL / 文件 id，所以多取几倍再按“可读文本”过滤。
    const rows = db.prepare(
      `SELECT timestamp, data FROM messages WHERE ${where} ORDER BY timestamp DESC, sequence DESC LIMIT ?`
    ).all(groupFlag, sid, since, like, cap * 4);

    const lowerKw = kw.toLowerCase();
    const results = [];
    let filteredOut = 0;
    for (const row of rows) {
      let ev;
      try { ev = JSON.parse(row.data); } catch { continue; }
      const text = segmentsToText(ev.message) || stripCq(ev.raw_message);
      if (!text || !text.toLowerCase().includes(lowerKw)) { filteredOut++; continue; }

      const selfId = Number(ev.self_id) || 0;
      const isSelf = ev.post_type === 'message_sent' || (selfId !== 0 && Number(ev.user_id) === selfId);
      const sender = isSelf ? '我' : (ev.sender?.card || ev.sender?.nickname || String(ev.user_id ?? '?'));
      const secs = Number(ev.time ?? row.timestamp) || 0;

      results.push({
        time: secs * 1000,
        timeText: secs ? new Date(secs * 1000).toLocaleString('zh-CN') : '',
        messageId: ev.message_id ?? null,
        seq: ev.message_seq ?? null,
        userId: ev.user_id ?? null,
        sender,
        isSelf,
        text: text.length > maxTextChars ? text.slice(0, maxTextChars) + '…' : text
      });
      if (results.length >= cap) break;
    }

    return {
      ok: true,
      source: 'snowluma-db',
      dbPath: found.file,
      account: found.account,
      keyword: kw,
      totalMatches,
      matchCount: results.length,
      filteredOut,
      truncated: totalMatches > results.length,
      results
    };
  } catch (error) {
    return { ok: false, error: `查询消息库失败：${error?.message ?? error}`, dbPath: found.file };
  } finally {
    try { db.close(); } catch { /* 关闭失败无所谓，进程退出也会释放 */ }
  }
}

// 服务端来源登记表。
//
// 规则（对应验收第 1 条）：
// - 只有桥接**实际收到**的 QQ/微信消息、或**实际成功返回**的工具结果能登记进来；
// - 机器人自己的发言、任意自报的 ref/摘要 都不能作为成长的依据（is_self=1 且 verify 拒绝）；
// - verify() 要求 ref 存在、digest 与登记时一致、且不是自己的输出。
import crypto from 'node:crypto';

export const normalizeBody = (value) => String(value ?? '').replace(/\r\n/g, '\n').trim();

export function digestOf(body) {
  return crypto.createHash('sha256').update(normalizeBody(body), 'utf8').digest('hex');
}

export function createSources({ db, now = Date.now }) {
  function record({ scope, ref, kind, body, userId = null, userName = null, meta = null, isSelf = false, url = null }) {
    const text = normalizeBody(body);
    if (!scope || !ref || !text) return null;
    const digest = digestOf(text);
    db.prepare(
      `INSERT INTO cap_sources(scope,ref,kind,digest,body,user_id,user_name,meta,is_self,url,at) VALUES(?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(scope,ref) DO UPDATE SET kind=excluded.kind,digest=excluded.digest,body=excluded.body,
         user_id=excluded.user_id,user_name=excluded.user_name,meta=excluded.meta,
         is_self=excluded.is_self,url=excluded.url,at=excluded.at`
    ).run(String(scope), String(ref), String(kind || 'message'), digest, text.slice(0, 4000),
      userId != null ? String(userId) : null, userName != null ? String(userName).slice(0, 40) : null,
      meta ? JSON.stringify(meta) : null, isSelf ? 1 : 0, url, now());
    return { scope: String(scope), ref: String(ref), digest };
  }

  function get(scope, ref) {
    return db.prepare('SELECT * FROM cap_sources WHERE scope=? AND ref=?').get(String(scope), String(ref)) || null;
  }

  /**
   * 校验一组来源。输入项：{ref, digest?}
   * @returns {{ok:boolean, verified:Array, rejected:Array<{ref:string,reason:string}>}}
   */
  function verify(scope, refs) {
    const verified = [];
    const rejected = [];
    const seen = new Set();
    for (const item of Array.isArray(refs) ? refs : []) {
      const ref = String(item?.ref ?? item ?? '').trim();
      if (!ref) { rejected.push({ ref: '', reason: 'empty_ref' }); continue; }
      if (seen.has(ref)) { rejected.push({ ref, reason: 'duplicate' }); continue; }
      seen.add(ref);
      const row = get(scope, ref);
      if (!row) { rejected.push({ ref, reason: 'unknown_source' }); continue; }
      if (Number(row.is_self) === 1) { rejected.push({ ref, reason: 'self_output' }); continue; }
      if (item?.digest && String(item.digest) !== String(row.digest)) { rejected.push({ ref, reason: 'digest_mismatch' }); continue; }
      verified.push({ ref, digest: row.digest, kind: row.kind, userId: row.user_id, at: row.at, excerpt: row.body.slice(0, 200) });
    }
    return { ok: rejected.length === 0 && verified.length > 0, verified, rejected };
  }

  function distinctUsers(verified) {
    return [...new Set(verified.map((v) => v.userId).filter(Boolean))];
  }

  function recent(scope, sinceAt) {
    return db.prepare('SELECT ref,kind,digest,body,user_id,user_name,meta,at FROM cap_sources WHERE scope=? AND is_self=0 AND at>=? ORDER BY at DESC LIMIT 300')
      .all(String(scope), Number(sinceAt || 0));
  }

  return { record, get, verify, distinctUsers, recent, digestOf };
}

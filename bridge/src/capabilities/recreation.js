// 能力六：参与群内娱乐（受限复读 + 定向梗回应）
//
// 复读判定（task-0002 重写，对应审核问题 4）：
//   必须是**两个不同的人连续说同一句纯文本**，且落在时间窗内、会话空闲、通过限频与概率。
//   所有入站消息（包括自己的）都会推进候选序列；只有成功发出才记一次复读并清空窗口，
//   因此“第一条普通消息”永远不会被当成复读。关闭开关后立即停止（每次现读生效配置）。
//
// 梗回应复用现有 meme-wiki / slang：区分固定文案与真实知识，没有来源不编来历。
import crypto from 'node:crypto';

const CQ_OR_MARKUP_RE = /\[CQ:|\[[^\]]{1,12}\]|@|https?:\/\//;

export function normalizeRepeatText(text) {
  return String(text ?? '')
    .replace(/\s+/g, '')
    .replace(/[~～!！?？。.,，、…]+$/g, '')
    .toLowerCase();
}

export function createRecreation({ db, config, gate, now = Date.now, log = () => {}, memeWiki, slang, isIdle = () => true }) {
  const cfg = () => config().recreation || {};
  const repeatCfg = () => cfg().repeat || {};
  const capabilitiesEnabled = () => config().enabled !== false;

  function countSince(scope, sinceMs) {
    return db.prepare('SELECT count(*) c FROM cap_repeat WHERE scope=? AND at>=?').get(String(scope), now() - sinceMs).c;
  }
  function lastRepeat(scope) {
    return db.prepare('SELECT at,text,source_ref FROM cap_repeat WHERE scope=? ORDER BY at DESC LIMIT 1').get(String(scope)) || null;
  }
  function sameTextRecent(scope, text, seconds) {
    return db.prepare('SELECT 1 x FROM cap_repeat WHERE scope=? AND text=? AND at>=? LIMIT 1')
      .get(String(scope), String(text), now() - seconds * 1000);
  }

  function state(scope) {
    return db.prepare('SELECT * FROM cap_repeat_state WHERE scope=?').get(String(scope)) || null;
  }
  function saveState(scope, { userId, text, at, messageId }) {
    db.prepare(
      `INSERT INTO cap_repeat_state(scope,last_user,last_text,last_at,last_message_id) VALUES(?,?,?,?,?)
       ON CONFLICT(scope) DO UPDATE SET last_user=excluded.last_user,last_text=excluded.last_text,
         last_at=excluded.last_at,last_message_id=excluded.last_message_id`
    ).run(String(scope), userId != null ? String(userId) : null, text, at, messageId != null ? String(messageId) : null);
  }
  function clearPair(scope) {
    db.prepare('UPDATE cap_repeat_state SET last_text=NULL WHERE scope=?').run(String(scope));
  }

  /** 发送前持久 claim：并发/重启都只能有一个发送者，且不明投递不会自动重发。 */
  function claimSend(scope, textNorm, sourceRef) {
    const t = now();
    const c = repeatCfg();
    const ttl = Number(c.claimTtlSeconds || 90) * 1000;
    const unknownCool = Number(c.unknownCooldownSeconds || 600) * 1000;
    const existing = db.prepare('SELECT * FROM cap_repeat_claim WHERE scope=?').get(String(scope));
    if (existing) {
      const age = t - Number(existing.claimed_at || 0);
      if (existing.status === 'sending') {
        if (age > ttl) {
          db.prepare("UPDATE cap_repeat_claim SET status='unknown', error='timeout_unknown' WHERE scope=?").run(String(scope));
          existing.status = 'unknown';
        } else {
          return { ok: false, reason: existing.text_norm === textNorm ? 'in_flight_same' : 'in_flight_cooldown' };
        }
      }
      if (existing.status === 'unknown') {
        if (existing.text_norm === textNorm) return { ok: false, reason: 'unknown_previous_send' };
        if (age < unknownCool) return { ok: false, reason: 'unknown_cooldown' };
      }
    }
    const res = db.prepare(
      `INSERT INTO cap_repeat_claim(scope,pair_key,source_ref,text_norm,claimed_at,status,message_id,error)
       VALUES(?,?,?,?,?,'sending',NULL,NULL)
       ON CONFLICT(scope) DO UPDATE SET pair_key=excluded.pair_key, source_ref=excluded.source_ref,
         text_norm=excluded.text_norm, claimed_at=excluded.claimed_at, status='sending', message_id=NULL, error=NULL
       WHERE cap_repeat_claim.status IN ('done','failed','cancelled','unknown')`
    ).run(String(scope), `${scope}:${textNorm}`, String(sourceRef || ''), textNorm, t);
    if (Number(res.changes) !== 1) return { ok: false, reason: 'in_flight' };
    return { ok: true };
  }

  function settleSend(scope, status, { messageId = null, error = null } = {}) {
    db.prepare("UPDATE cap_repeat_claim SET status=?, message_id=?, error=? WHERE scope=? AND status='sending'")
      .run(status, messageId != null ? String(messageId) : null, error ? String(error).slice(0, 200) : null, String(scope));
  }

  function claimStatus(scope) {
    return db.prepare('SELECT * FROM cap_repeat_claim WHERE scope=?').get(String(scope)) || null;
  }
  function pureText(msg, text) {
    if (msg.hasMedia) return { ok: false, reason: 'media' };
    if (msg.hasSticker) return { ok: false, reason: 'sticker' };
    if (/^[\/#!]/.test(text)) return { ok: false, reason: 'command' };
    if (CQ_OR_MARKUP_RE.test(text)) return { ok: false, reason: 'markup_or_mention' };
    if (/[？?]$/.test(text)) return { ok: false, reason: 'question' };
    const c = repeatCfg();
    if (text.length < Number(c.minChars || 2) || text.length > Number(c.maxChars || 40)) return { ok: false, reason: 'length' };
    return { ok: true };
  }

  /**
   * 记录一条入站消息并判断是否构成“连续两人同文”（供其它模块/测试用的纯判定入口）。
   * observe() 内联了同样的逻辑，保证“先判定、再推进序列”的顺序。
   */
  function noteIncoming(msg) {
    const scope = String(msg.scope || '');
    if (!scope) return { ok: false, reason: 'no_scope' };
    const text = String(msg.text ?? '').trim();
    if (!text) return { ok: false, reason: 'empty' };
    const prev = state(scope);
    const norm = normalizeRepeatText(text);
    const pair = !!prev && !!prev.last_text && prev.last_text === norm
      && String(prev.last_user) !== String(msg.userId)
      && now() - Number(prev.last_at) <= Number(repeatCfg().windowSeconds || 120) * 1000;
    saveState(scope, { userId: msg.userId, text: norm, at: now(), messageId: msg.messageId || msg.seq });
    if (!pair) return { ok: false, reason: prev ? (String(prev.last_user) === String(msg.userId) ? 'same_speaker' : 'different_text') : 'first_message' };
    return { ok: true, pair: true, text, prevUser: prev.last_user, prevAt: prev.last_at, norm };
  }

  function repeatable(msg) {
    const c = repeatCfg();
    if (cfg().enabled === false || c.enabled !== true) return { ok: false, reason: 'disabled' };
    if (!/^group:/.test(String(msg.scope || ''))) return { ok: false, reason: 'not_group' };
    if (msg.isSelf) return { ok: false, reason: 'self' };
    const text = String(msg.text ?? '').trim();
    if (!text) return { ok: false, reason: 'empty' };
    const pure = pureText(msg, text);
    if (!pure.ok) return pure;

    let pairUser = msg.pairUser;
    if (msg.pair !== true) {
      // 直接调用（没有经过 observe）：用库里上一条历史自主判定
      const prev = state(msg.scope);
      const norm = normalizeRepeatText(text);
      const isPair = !!prev && !!prev.last_text && prev.last_text === norm
        && String(prev.last_user) !== String(msg.userId)
        && now() - Number(prev.last_at) <= Number(c.windowSeconds || 120) * 1000;
      if (!isPair) return { ok: false, reason: 'no_pair' };
      pairUser = prev.last_user;
    }
    if (pairUser && String(pairUser) === String(msg.userId)) return { ok: false, reason: 'same_speaker' };
    if (!isIdle(msg.scope)) return { ok: false, reason: 'busy' };
    const scope = String(msg.scope);
    if (lastRepeat(scope) && now() - lastRepeat(scope).at < Number(c.minIntervalSeconds || 180) * 1000) return { ok: false, reason: 'min_interval' };
    if (countSince(scope, 3600000) >= Number(c.maxPerHour || 2)) return { ok: false, reason: 'hourly_cap' };
    if (sameTextRecent(scope, text, Number(c.cooldownPerTextSeconds || 600))) return { ok: false, reason: 'same_text' };
    const chance = c.chance === undefined ? 0.5 : Number(c.chance);
    if (Math.random() > chance) return { ok: false, reason: 'chance' };
    return { ok: true, text, pairUser };
  }

  /**
   * 观察一条消息：先判定（用上一条状态），再推进序列；命中才复读。
   * @param {{scope,text,userId,isSelf,hasMedia,hasSticker,seq,messageId}} msg
   * @param {(key:string,text:string)=>Promise<any>} send
   */
  async function observe(msg, send) {
    try {
      const scope = String(msg.scope || '');
      if (!scope) return { ok: false, reason: 'no_scope' };
      if (!capabilitiesEnabled() || repeatCfg().enabled !== true) return { ok: false, reason: 'disabled' };
      const text = String(msg.text ?? '').trim();
      if (!text) return { ok: false, reason: 'empty' };

      // 先看“上一条”是否构成同文对，再推进状态；自己的消息也会推进，但不触发。
      const prev = state(scope);
      const norm = normalizeRepeatText(text);
      const pair = !!prev && !!prev.last_text && prev.last_text === norm
        && String(prev.last_user) !== String(msg.userId)
        && now() - Number(prev.last_at) <= Number(repeatCfg().windowSeconds || 120) * 1000;
      saveState(scope, { userId: msg.userId, text: norm, at: now(), messageId: msg.messageId || msg.seq });

      if (!pair || msg.isSelf) return { ok: false, reason: msg.isSelf ? 'self' : (prev ? 'no_pair' : 'first_message') };
      const decision = repeatable({ ...msg, pair: true, pairUser: prev.last_user });
      if (!decision.ok) return decision;

      // 发送前持久 claim：同一群在飞只能有一个复读；重启后 sending/unknown 也不会重发。
      const claim = claimSend(scope, normalizeRepeatText(decision.text), String(msg.messageId || msg.seq || ''));
      if (!claim.ok) return { ok: false, reason: claim.reason };

      const permit = gate.check({
        module: 'recreation', action: 'repeat', actor: 'background', scope,
        perHour: Number(repeatCfg().maxPerHour || 2),
        minIntervalMs: Number(repeatCfg().minIntervalSeconds || 180) * 1000
      });
      if (!permit.ok) { settleSend(scope, 'cancelled', { error: permit.reason }); return { ok: false, reason: permit.reason }; }
      if (permit.dryRun) {
        permit.commit(`dry-run:${decision.text.slice(0, 40)}`);
        settleSend(scope, 'cancelled', { error: 'dry_run' });
        clearPair(scope);
        return { ok: false, reason: 'dry_run' };
      }
      // 等待期间可能被关闭/开始新回合：发送前重校验，发现变化就撤销 claim，绝不带病发送
      if (!capabilitiesEnabled() || repeatCfg().enabled !== true) {
        permit.fail('disabled_before_send');
        settleSend(scope, 'cancelled', { error: 'disabled_before_send' });
        return { ok: false, reason: 'disabled' };
      }
      if (!isIdle(scope)) {
        permit.fail('busy_before_send');
        settleSend(scope, 'cancelled', { error: 'busy_before_send' });
        return { ok: false, reason: 'busy' };
      }

      let receipt;
      try {
        receipt = await send(scope, decision.text);
      } catch (error) {
        const msgText = String(error?.message ?? error);
        const unknown = /timeout|超时|aborted|ECONNRESET|socket hang up/i.test(msgText);
        settleSend(scope, unknown ? 'unknown' : 'failed', { error: msgText });
        permit.fail(msgText);
        return { ok: false, reason: unknown ? 'unknown_delivery' : 'send_failed', unknown };
      }
      const ids = [];
      if (Array.isArray(receipt)) {
        for (const item of receipt) {
          const id = item?.messageId ?? item?.message_id ?? item?.data?.message_id;
          if (id != null && String(id) !== '') ids.push(String(id));
        }
      } else if (receipt) {
        for (const id of (Array.isArray(receipt.messageIds) ? receipt.messageIds : (receipt.messageId != null ? [receipt.messageId] : []))) {
          if (id != null && String(id) !== '') ids.push(String(id));
        }
      }
      if (!receipt) {
        permit.fail('send_unknown');
        settleSend(scope, 'unknown', { error: 'empty_receipt' });
        return { ok: false, reason: 'send_unknown', unknown: true };
      }
      if (receipt.unknown === true) {
        // 真实 sendToQQ 超时形状：{ok:false, unknown:true, messageIds:[], failed:1}。
        // 必须优先按“投递不明”处理，不能降级为可重试的 failed。
        permit.fail('send_unknown');
        settleSend(scope, 'unknown', { error: 'structured_unknown' });
        return { ok: false, reason: 'send_unknown', unknown: true };
      }
      if (receipt.ok === false) {
        permit.fail('send_failed');
        settleSend(scope, 'failed', { error: String(receipt.error || 'send_failed') });
        return { ok: false, reason: 'send_failed' };
      }
      if (ids.length === 0) {
        // 回执成功但没有消息 ID：无法核验投递，按不明处理，禁止自动重发
        permit.fail('receipt_without_id');
        settleSend(scope, 'unknown', { error: 'receipt_without_id' });
        return { ok: false, reason: 'send_unknown', unknown: true };
      }
      permit.commit(`message_id:${ids[0]}`);
      settleSend(scope, 'done', { messageId: ids[0] });
      db.prepare('INSERT INTO cap_repeat(id,scope,source_ref,text,at) VALUES(?,?,?,?,?)')
        .run(`r-${now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`, scope,
          String(msg.messageId || msg.seq || ''), decision.text, now());
      clearPair(scope);
      log(`[capabilities] 复读 ${scope}：${decision.text.slice(0, 30)}`);
      return { ok: true, text: decision.text, messageId: ids[0] };
    } catch (error) {
      log(`[capabilities] 复读失败：${error?.message ?? error}`);
      return { ok: false, reason: 'error' };
    }
  }

  /**
   * 定向梗回应：返回 {kind:'fixed'|'knowledge', text, source} 或 null。
   * knowledge 只复述词库摘要；origin 为空时不编造来历。
   */
  function memeReply(query) {
    if (cfg().enabled === false || cfg().meme?.enabled === false) return null;
    const q = String(query ?? '').trim();
    if (!q) return null;
    if (slang && typeof slang === 'function') {
      try {
        const fixed = slang(q);
        if (fixed && fixed.fixedText) {
          return { kind: 'fixed', text: String(fixed.fixedText), source: `slang:${fixed.id || q}` };
        }
      } catch { /* 忽略黑话查询失败 */ }
    }
    if (memeWiki && typeof memeWiki.lookup === 'function') {
      try {
        const hits = memeWiki.lookup(q);
        if (hits?.length) {
          const hit = hits[0];
          const parts = [hit.summary || hit.usage || ''].filter(Boolean);
          return {
            kind: 'knowledge',
            text: parts.join(' ').slice(0, 300),
            source: 'memewiki',
            title: hit.title,
            origin: hit.origin || null,
            hasOrigin: !!hit.origin
          };
        }
      } catch { /* 词库不可用 → 不编 */ }
    }
    return null;
  }

  function status(scope) {
    const c = repeatCfg();
    return {
      enabled: cfg().enabled !== false,
      repeat: {
        enabled: c.enabled === true,
        windowSeconds: Number(c.windowSeconds || 120),
        minIntervalSeconds: Number(c.minIntervalSeconds || 180),
        maxPerHour: Number(c.maxPerHour || 2),
        usedLastHour: scope ? countSince(scope, 3600000) : null
      },
      meme: { enabled: cfg().meme?.enabled !== false },
      recent: db.prepare('SELECT * FROM cap_repeat ORDER BY at DESC LIMIT 10').all(),
      claim: scope ? claimStatus(scope) : null
    };
  }

  return { observe, noteIncoming, repeatable, memeReply, status, claimStatus, normalizeRepeatText };
}

// 桥接与 capabilities 之间的唯一适配层。
//
// 为什么要这一层（task-0002）：审核指出“源码正则匹配不能证明接线”。这里把
// 桥接真正复用的几个动作（入站观察、卡片/转发登记、出站润色、提示词注入、
// 发送回执、语音闸门）实现成独立函数，测试可以直接用真实 capabilities 实例
// + 模拟协议运行它们，而不是去 grep bridge.js。
import { cardToTextFallback } from './wiring-helpers.js';

/**
 * sendContext.visibleAtEntry 是桥接本地的消息 seq（st.recentMessages/unread 的 seq），
 * 不是 QQ message_id、也不是 OneBot event.message_seq。绑定前必须用当前会话状态把它们
 * 映射成真实 messageId；映射不到就不绑定（绝不拿全部历史图片兜底）。
 */
export function mapVisibleSeqsToMessageIds(state, visibleSeqs = []) {
  const list = [
    ...(Array.isArray(state?.recentMessages) ? state.recentMessages : []),
    ...(Array.isArray(state?.unread) ? state.unread : [])
  ];
  const bySeq = new Map();
  for (const m of list) {
    if (!m || m.seq == null) continue;
    const sid = String(m.seq);
    if (!bySeq.has(sid)) bySeq.set(sid, m);
  }
  const refs = [];
  const unmatched = [];
  for (const raw of Array.isArray(visibleSeqs) ? visibleSeqs : []) {
    const m = bySeq.get(String(raw));
    if (!m) { unmatched.push(String(raw)); continue; }
    const id = m.messageId != null && String(m.messageId) !== '' ? String(m.messageId) : null;
    if (!id) { unmatched.push(String(raw)); continue; }
    if (!refs.includes(id)) refs.push(id);
  }
  return { refs, unmatched };
}

export function createCapabilityWiring({
  capabilities,
  cardToText,
  forwardIdOf,
  readForward,
  log = () => {}
}) {
  const batches = new Map(); // scope -> 最近一次注入的批次

  /** 把一条桥接入站消息交给 capabilities。同步返回分类结果，卡片/转发异步补登记。 */
  function observe(msg) {
    const result = capabilities.observeIncoming(msg);
    if (!capabilities.enabled()) return result;
    // 卡片/合并转发登记：读取不等于允许转发，真正的发送还要确认与白名单
    try {
      const segs = Array.isArray(msg.segments) ? msg.segments : [];
      const fwd = segs.find((s) => String(s?.type || '') === 'forward');
      const card = segs.find((s) => ['json', 'xml'].includes(String(s?.type || '')));
      if (fwd) {
        let fwdId = '';
        try { fwdId = forwardIdOf ? forwardIdOf(fwd.data) : ''; } catch { fwdId = ''; }
        if (fwdId) {
          Promise.resolve()
            .then(() => readForward(fwdId))
            .then((nodes) => {
              const r = capabilities.transfer.ingest({
                scope: msg.scope, kind: 'forward', sourceRef: String(msg.messageId || fwdId),
                title: '合并转发', nodes
              });
              return r;
            })
            .catch((error) => {
              // 读不到正文就不登记：不拿“转发消息 id=...”占位冒充内容
              log(`[capabilities] 合并转发读取失败（不登记占位内容）：${error?.message ?? error}`);
            });
        }
        return result;
      }
      if (card) {
        const text = typeof cardToText === 'function'
          ? cardToText(JSON.stringify(card.data || {}))
          : cardToTextFallback(card.data);
        if (text && String(text).trim().length > 1) {
          capabilities.transfer.ingest({
            scope: msg.scope, kind: 'card', sourceRef: String(msg.messageId || ''),
            title: '卡片', excerpt: String(text).slice(0, 1500)
          });
        }
      }
    } catch (error) {
      log(`[capabilities] 内容登记失败：${error?.message ?? error}`);
    }
    return result;
  }

  function polish(scope, text, opts = {}) {
    return capabilities.polishOutgoing(scope, text, opts);
  }

  /** 组装提示词片段，并记住这次注入的批次。 */
  function prompt(scope, persona = '') {
    return promptPayload(scope, persona);
  }

  /**
   * 真实 prompt 路由与测试共用：必须把 inj.text / 梗知识 / 当前 scope 的活动证据
   * 一并带回，不能只返回 growthText 而把注入正文丢掉。
   */
  function promptPayload(scope, persona = '', { activityLimit = 3, executionId = null, refs = [], state = null } = {}) {
    // visibleAtEntry 是桥接本地 seq：先映射成真实 messageId，再用它绑定本轮看图上下文。
    // 同一轮多批发送复用，不消费；映射不到就不绑定（不拿历史图片兜底）。
    const mapped = mapVisibleSeqsToMessageIds(state, refs);
    if (executionId && mapped.refs.length) {
      try { capabilities.bindTurn(scope, executionId, mapped.refs); } catch { /* 绑定失败按无绑定处理 */ }
    }
    const inj = capabilities.injection(scope, persona);
    if (inj.batchId) batches.set(scope, inj.batchId);
    return {
      batchId: inj.batchId || null,
      text: inj.text || '',
      growthText: inj.growthText || '',
      cultureText: inj.cultureText || '',
      growth: (inj.growthItems || []).map((i) => ({ id: i.id, kind: i.kind, content: i.content, status: i.status })),
      meme: inj.meme || null,
      note: capabilities.noteFor(scope, executionId),
      activity: capabilities.recentActivity(scope, activityLimit),
      boundRefs: mapped.refs,
      unmatchedRefs: mapped.unmatched
    };
  }

  /** 工具发送路径的真实自然表达处理（与自动回复同一实现）。 */
  function polishForSend(scope, text, opts = {}) {
    return capabilities.polishOutgoing(scope, text, opts);
  }

  /**
   * 批量准备待发送文本：真实 reserved2 工具路径与测试共用。
   * 返回 {messages, dropped}，空数组表示这次不该发言。
   */
  function prepareMessagesForSend(scope, messages, opts = {}) {
    if (!Array.isArray(messages)) return { messages: [], dropped: 0 };
    const out = [];
    let dropped = 0;
    for (const m of messages) {
      try {
        const p = polishForSend(scope, m, opts);
        if (!String(p.text || '').trim()) { dropped++; continue; }
        out.push(p.text);
      } catch { out.push(m); }
    }
    return { messages: out, dropped };
  }

  /** 真实发送成功后调用：返回本次记录了几条成长使用。 */
  function delivered(scope, messageId) {
    if (!messageId) return 0;
    const n = capabilities.recordDelivered({ scope, messageId, batchId: batches.get(scope) });
    if (n > 0) batches.delete(scope);
    return n;
  }

  /** 语音闸门：能力关闭时原样放行（保留旧行为）。 */
  function voiceGuard(text) {
    try { return capabilities.voice.guard(text); } catch (error) { return { ok: true, text: String(text ?? ''), error: String(error?.message ?? error) }; }
  }

  function voiceFallbackEnabled() {
    try { return capabilities.config().voice?.fallbackText !== false; } catch { return true; }
  }

  function clearTurn(scope, executionId) {
    try { capabilities.clearTurn(scope, executionId); } catch { /* ignore */ }
  }

  return { observe, polish, polishForSend, prepareMessagesForSend, prompt, promptPayload, clearTurn, delivered, voiceGuard, voiceFallbackEnabled };
}

// Pure scheduling state. Timeouts never prove that a remote turn has stopped.
import { randomUUID } from 'node:crypto';

export function normalizeWakeDelivery(st) {
  st.pendingWakeReasons = Array.isArray(st.pendingWakeReasons)
    ? st.pendingWakeReasons.filter(x => x && typeof x === 'object' && x.reason) : [];
  if (st.wakeDelivery?.version !== 1) {
    // Preserve the old boundary without replaying the entire history on upgrade.
    st.wakeDelivery = { version: 1, legacyFloor: Number(st.lastHandledSeq) || 0,
      confirmed: [], execution: null, nextEligibleAt: 0 };
  }
  const d = st.wakeDelivery;
  d.confirmed = Array.isArray(d.confirmed) ? [...new Set(d.confirmed.map(Number).filter(n => n > 0))] : [];
  return d;
}

export function isMessageConfirmed(st, seq) {
  const d = normalizeWakeDelivery(st);
  return seq > 0 && (seq <= d.legacyFloor || d.confirmed.includes(Number(seq)));
}

export function enqueueWake(st, reason, seq = Number(st.lastUnreadSeq) || 0, now = Date.now()) {
  normalizeWakeDelivery(st);
  const existing = st.pendingWakeReasons.find(x => x.reason === reason && Number(x.seq) === seq);
  if (existing) return existing;
  const message = [...(st.unread || []), ...(st.recentMessages || [])].find(m => Number(m.seq) === seq);
  const item = { id: randomUUID(), reason, seq, firstAt: now, ...(message ? { message } : {}) };
  st.pendingWakeReasons.push(item);
  return item;
}

export function pendingWakes(st) {
  normalizeWakeDelivery(st);
  // Scan the entire queue: a stale head must never hide a live tail.
  const seen = new Set();
  st.pendingWakeReasons = st.pendingWakeReasons.filter(item => {
    const tag = `${item.reason}@${Number(item.seq) || 0}`;
    if (seen.has(tag) || isMessageConfirmed(st, Number(item.seq))) return false;
    seen.add(tag);
    return true;
  });
  return st.pendingWakeReasons;
}

export function nextWakeAt(times, now, options = {}, reason = '') {
  const maxPerMinute = Number(options.maxWakePerMinute ?? options.maxPerMinute) || 0;
  const maxPerHour = Number(options.maxWakePerHour ?? options.maxPerHour) || 0;
  let next = now;
  const direct = /^(private|atMention|poke)(:|$)/.test(reason);
  for (const [window, cap] of [[60000, maxPerMinute], [3600000, direct ? 0 : maxPerHour]]) {
    if (!(cap > 0)) continue;
    const recent = times.filter(t => t > now - window).sort((a, b) => a - b);
    if (recent.length >= cap) next = Math.max(next, recent[recent.length - cap] + window + 1);
  }
  return next;
}

export function claimExecution(st, reason, now = Date.now()) {
  const d = normalizeWakeDelivery(st);
  if (d.execution) return null;
  const execution = { id: randomUUID(), requestId: randomUUID(), phase: 'preparing', reason,
    createdAt: now, sessionId: null, turn: null, baselineSeq: null, visible: [], terminal: false };
  d.execution = execution;
  return execution;
}

export function registerVisible(st, executionId, messages) {
  const e = normalizeWakeDelivery(st).execution;
  if (!e || e.id !== executionId || e.terminal) return [];
  const seqs = messages.filter(m => m && !m.isSelf).map(m => Number(m.seq)).filter(n => n > 0);
  e.visible = [...new Set([...(e.visible || []), ...seqs])];
  return seqs;
}

export function confirmVisible(st, executionId, seqs) {
  const d = normalizeWakeDelivery(st), e = d.execution;
  if (!e || e.id !== executionId) return [];
  const visible = new Set(e.visible || []);
  const confirmed = [...new Set(seqs.map(Number).filter(n => visible.has(n)))];
  d.confirmed = [...new Set([...d.confirmed, ...confirmed])];
  st.unread = (st.unread || []).filter(m => !confirmed.includes(Number(m.seq)));
  // lastHandledSeq remains a display field; sparse confirmations are authoritative.
  st.lastHandledSeq = Math.max(Number(st.lastHandledSeq) || 0, ...confirmed);
  pendingWakes(st);
  return confirmed;
}

export function unseenMessages(st) {
  const e = normalizeWakeDelivery(st).execution, seen = new Set(e?.visible || []);
  return (st.unread || []).filter(m => m && !m.isSelf && !isMessageConfirmed(st, Number(m.seq)) && !seen.has(Number(m.seq)));
}

export function canUseExecution(st, token) {
  const e = normalizeWakeDelivery(st).execution;
  return !!token && token === st.agentToken && !!e && !e.terminal && ['submitting','accepted','running'].includes(e.phase);
}

export function observeTurn(st, sessionId, event) {
  const e = normalizeWakeDelivery(st).execution;
  if (!e || e.sessionId !== sessionId) return false;
  if (Number.isFinite(e.baselineSeq) && Number(event.seq) <= e.baselineSeq) return false;
  const turn = event.data?.turn;
  if (event.type === 'agent/inbox/spliced' && (JSON.stringify(event.data || {}).includes(e.id) || JSON.stringify(event.data || {}).includes(e.requestId))) {
    e.promptObserved = true;
    e.promptSeq = Number(event.seq);
  }
  if (event.type === 'turn/start') {
    if (e.turn != null && e.turn !== turn) return false;
    if (e.turn == null && !e.recovered && !(e.promptObserved && Number(event.seq) > e.promptSeq)) return false;
    e.turn = turn;
    e.phase = 'running';
    return true;
  }
  if (event.type === 'turn/end' && (e.turn === turn || (e.turn == null && e.promptObservedByTool && Number.isFinite(e.baselineSeq)))) {
    e.turn = turn;
    e.terminal = true;
    e.phase = 'finishing';
    e.terminalSeq = event.seq;
    return true;
  }
  return e.turn === turn && !e.terminal;
}

export function releaseExecution(st, id) {
  const d = normalizeWakeDelivery(st);
  if (d.execution?.id !== id) return false;
  d.execution = null;
  d.blockedReason = '';
  return true;
}

// Supported DSH projections and sequenced page records, checked against the host.
export function inspectDshSnapshot(projection, page, execution = null) {
  const outline = projection.values?.turnOutline;
  const inbox = projection.values?.inbox;
  if (!Array.isArray(outline) || !inbox || !Array.isArray(page.records))
    return { status: 'unknown', reason: 'DSH 状态结构不完整' };
  const events = page.records.map(r => r.event).filter(Boolean);
  const latest = outline.at(-1);
  const turn = latest?.turn;
  const start = events.find(e => e.type === 'turn/start' && e.data?.turn === turn);
  const end = events.findLast(e => e.type === 'turn/end' && e.data?.turn === turn);
  const queued = Object.values(inbox).some(items => Array.isArray(items) && items.length);
  const requestId = execution?.requestId;
  const matching = execution ? events.filter(e => JSON.stringify(e.data || {}).includes(requestId) || JSON.stringify(e.data || {}).includes(execution.id)) : [];
  const requestSeen = matching.length > 0;
  const promptSeq = matching.length ? Math.min(...matching.map(e=>Number(e.seq))) : execution?.promptSeq;
  const ownsTurn = !!execution && (execution.promptObservedByTool || (requestSeen && Number(latest?.seq) > promptSeq));
  const afterSubmission = execution && Number.isFinite(execution.baselineSeq)
    && events.some(e => e.type === 'turn/start' && Number(e.seq) > execution.baselineSeq);
  if (queued) return { status: 'busy', turn, reason: 'DSH 尚有待执行投递', requestSeen, ownsTurn };
  if (latest && !end) return { status: 'busy', turn, startSeq: start?.seq, requestSeen, ownsTurn };
  if (!latest && Number(projection.asOfSeq) > 0 && page.hasMore)
    return { status: 'unknown', reason: '无法核实回合边界' };
  if (execution && ['submitting', 'accepted', 'unknown', 'running'].includes(execution.phase)) {
    if (execution.turn != null && end?.data?.turn === execution.turn)
      return { status: 'idle', terminal: end, requestSeen };
    if (afterSubmission && end && ownsTurn) return { status: 'idle', terminal: end, requestSeen: true };
    // Absence in a bounded page cannot prove an ambiguous HTTP request was rejected.
    return { status: 'unknown', reason: '投递结果未确认，保留执行权，禁止重复投递', requestSeen };
  }
  return { status: 'idle', terminal: end, requestSeen };
}

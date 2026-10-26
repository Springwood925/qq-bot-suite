// 唤醒与表达回顾共用同一个可见窗口，不为回顾另复制聊天记录。
export function selectWakeContext(state, { recentReadLimit = 25, unreadLimit = 30 } = {}) {
  if (recentReadLimit <= 0) return { recent: [], unread: [] };
  const unread = Array.isArray(state.unread) ? state.unread.slice(-unreadLimit) : [];
  const unreadSeqs = new Set(unread.map(message => message.seq));
  const recent = (Array.isArray(state.recentMessages) ? state.recentMessages : [])
    .filter(message => !unreadSeqs.has(message.seq)).slice(-recentReadLimit);
  return { recent, unread };
}

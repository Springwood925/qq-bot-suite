// Observe the configured companion's activity; observations are hints, not orders.
export function createCompanionObserver(bot, owner, { now = Date.now, ttlMs = 30000, onActivity = () => {}, notifyIntervalMs = 120000 } = {}) {
  let last = null;
  let lastNotifiedAt = null;
  function onBreak(block, entity) {
    if (!block || entity?.username !== owner || !bot.entity?.position || !block.position) return;
    if (bot.entity.position.distanceTo(block.position) > 16) return;
    const name = String(block.name || '');
    const kind = /(^|_)log\d?$/.test(name) ? '采集木头' : /ore$/.test(name) ? '采矿' : null;
    if (kind) {
      const observedAt = now();
      last = { activity: kind, block: name, observedAt };
      if (lastNotifiedAt === null || observedAt - lastNotifiedAt >= notifyIntervalMs) {
        lastNotifiedAt = observedAt;
        onActivity({ ...last });
      }
    }
  }
  bot.on('blockBreakProgressEnd', onBreak);
  return {
    status() { return last && now() - last.observedAt <= ttlMs ? { ...last } : null; },
    close() { bot.removeListener('blockBreakProgressEnd', onBreak); last = null; }
  };
}

// 每个会话持久化于 wakeDelivery，保留未读；失败不等于机器人遗漏了收尾工具。
const RECOVERY_WINDOW = 30 * 60000;
export function recordTurnFailure(delivery, sessionId, terminal, now = Date.now()) {
  const error = terminal?.data?.reason?.error || {};
  const id = `${sessionId}:${terminal.seq}`;
  if (delivery.failure?.id === id) return {rotate:delivery.failure.rotate,duplicate:true};
  const invalid = error.code === 'INVALID_REQUEST' || error.code === 'CONTEXT_WINDOW_EXCEEDED' || Number(error.status) === 400 || /request failed \(400\)/i.test(String(error.message||''));
  const prior = delivery.failure || {};
  const count = Math.min(10, (Number(prior.count)||0)+1);
  const rotate = invalid && (!prior.recoveryAt || now-prior.recoveryAt>=RECOVERY_WINDOW);
  const retryAt = now + (rotate ? 5000 : invalid ? 10*60000 : Math.min(15*60000,30000*2**(count-1)));
  delivery.failure = {id,count,rotate,retryAt,recoveryAt:rotate?now:prior.recoveryAt||0,code:String(error.code||'ERROR')};
  delivery.nextEligibleAt = Math.max(Number(delivery.nextEligibleAt)||0,retryAt);
  return {rotate,duplicate:false};
}
export function errorNoticeAllowed(delivery, now=Date.now()) {
  if (delivery.errorNoticeAt && now-delivery.errorNoticeAt<15*60000) return false;
  delivery.errorNoticeAt=now;return true;
}
export function failureRetryAt(delivery) { return Number(delivery.failure?.retryAt)||0; }

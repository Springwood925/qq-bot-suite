// 看门狗：事件驱动唤醒（设计抄自 whale_craft，MIT）
//
// 它只做一件事：把 mineflayer 的事件变成"该不该叫醒她"的判断，然后回调出去。
// 不自己调 LLM、不自己发消息 —— 唤醒由桥负责。
//
// ⚠️ 2026-11-04 教训：mineflayer 的 `bot.on('chat')` 回调签名是 `(username, message)`，
// 两个位置参数。whale_craft 写成 `({ who, text })` 解构对象，导致 who/text 全是 undefined，
// 看门狗 armed 却 fired 0。这里必须用位置参数。

const DEFAULTS = {
  autoArm: true,
  notifyOnDisarm: true,
  wakeOn: {
    mention: true,        // 提到名字
    nearbySpeech: true,   // 附近说话
    damage: true,         // 受击
    death: true,          // 死亡
    teleport: true,       // 被传送
    disconnect: true,     // 断线
    heartbeat: true,      // 心跳（我们默认开：没人叫也要自己醒）
    pushed: false,
    itemPickup: false,
    playerJoin: false,
    playerLeave: false,
  },
  mentionPatterns: ['小鲸鲸', '小鲸', '鲸鲸', '机器人', 'deepseek', 'ai'],
  nearRadius: 16,
  heartbeatSec: 300,
  observeWindowMs: 2000,   // 连珠炮合并
  topicWindowSec: 120,     // 唤醒后这段时间内算同话题
  cooldownMs: 15000,       // 两次唤醒最小间隔
  maxWakePerMinute: 6,
};

export function createWatchdog(bot, { onWake, log = console.log, opts = {} } = {}) {
  const cfg = {
    ...DEFAULTS,
    ...opts,
    wakeOn: { ...DEFAULTS.wakeOn, ...(opts.wakeOn || {}) },
    mentionPatterns: [...(opts.mentionPatterns || DEFAULTS.mentionPatterns)],
  };

  let armed = false;
  let timer = null;
  let pending = null;          // { reasons, events, at }
  let lastWakeAt = 0;
  let wakeTimes = [];          // 限流用
  const listeners = [];
  const stats = { fired: 0, injected: 0, dropped: 0, suppressed: 0 };
  const recent = [];           // 最近事件留档

  const dist = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);

  function record(ev) {
    recent.push({ at: Date.now(), ...ev });
    while (recent.length > 30) recent.shift();
  }

  // 名字匹配：支持字符串和 /正则/ 写法
  function calledBy(text) {
    const s = String(text ?? '');
    if (!s) return [];
    const hit = [];
    for (const p of cfg.mentionPatterns) {
      try {
        const re = p.startsWith('/') && p.endsWith('/') ? new RegExp(p.slice(1, -1), 'i') : new RegExp(p, 'i');
        if (re.test(s)) hit.push(p);
      } catch {}
    }
    return hit;
  }

  function isNearby(who) {
    const me = bot.entity?.position;
    if (!me) return false;
    const p = bot.players?.[who]?.entity?.position;
    if (!p) return false;
    return dist(me, p) <= cfg.nearRadius;
  }

  // 限流
  function throttled() {
    const now = Date.now();
    wakeTimes = wakeTimes.filter((t) => now - t < 60000);
    if (wakeTimes.length >= cfg.maxWakePerMinute) { stats.suppressed++; return true; }
    if (lastWakeAt && now - lastWakeAt < cfg.cooldownMs) { stats.suppressed++; return true; }
    return false;
  }

  // 合并窗口内的事件，到点再真正唤醒
  function fire(reasons, ev) {
    if (!armed) return;
    const why = reasons.filter(Boolean);
    if (!why.length) return;
    record({ kind: ev.kind, text: ev.text, reasons: why });

    if (throttled()) return;

    if (!pending) pending = { reasons: new Set(), events: [], at: 0 };
    why.forEach((r) => pending.reasons.add(r));
    pending.events.push(ev);
    pending.at = Date.now();

    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, cfg.observeWindowMs);
  }

  async function flush() {
    timer = null;
    if (!pending) return;
    const batch = pending;
    pending = null;
    if (!batch.events.length) return;

    lastWakeAt = Date.now();
    wakeTimes.push(lastWakeAt);
    stats.fired++;

    const payload = {
      at: new Date().toISOString(),
      reasons: [...batch.reasons],
      events: batch.events.slice(-8),
      pos: bot.entity?.position ? { x: Math.round(bot.entity.position.x), y: Math.round(bot.entity.position.y), z: Math.round(bot.entity.position.z) } : null,
      health: bot.health,
    };
    log(`🔔 唤醒 [${payload.reasons.join('/')}] ${payload.events.map((e) => e.text).join(' | ').slice(0, 120)}`);
    try {
      await onWake?.(payload);
      stats.injected++;
    } catch (e) {
      stats.dropped++;
      log('唤醒投递失败:', e.message);
    }
  }

  function bind() {
    const on = (evt, fn) => { bot.on(evt, fn); listeners.push([evt, fn]); };

    // ⚠️ 位置参数，不是对象
    on('chat', (username, message) => {
      const who = String(username ?? '');
      const text = String(message ?? '');
      if (!who || who === bot.username) return;
      const called = calledBy(text);
      const near = isNearby(who);
      const topical = lastWakeAt > 0 && (Date.now() - lastWakeAt) < cfg.topicWindowSec * 1000;
      const why = [];
      if (called.length && cfg.wakeOn.mention) why.push('mention');
      if (near && cfg.wakeOn.nearbySpeech) why.push('nearbySpeech');
      if (!why.length && topical) why.push('topic');
      if (!why.length) { record({ kind: 'chat', text: `<${who}> ${text}`, ignored: true }); return; }
      fire(why, { kind: 'chat', text: `<${who}> ${text}`, who, calledBy: called, near });
    });

    on('health', () => {
      if (!cfg.wakeOn.damage) return;
      if (bot.health !== undefined && bot.health <= 8) {
        fire(['damage'], { kind: 'damage', text: `血只有 ${bot.health}` });
      }
    });

    on('death', () => { if (cfg.wakeOn.death) fire(['death'], { kind: 'death', text: '我死了' }); });

    on('playerJoined', (p) => {
      if (p.username === bot.username) return;
      if (cfg.wakeOn.playerJoin) fire(['playerJoin'], { kind: 'playerJoin', text: `${p.username} 上线` });
      record({ kind: 'playerJoin', text: `${p.username} 上线` });
    });

    on('playerLeft', (p) => {
      if (p.username === bot.username) return;
      if (cfg.wakeOn.playerLeave) fire(['playerLeave'], { kind: 'playerLeave', text: `${p.username} 下线` });
      record({ kind: 'playerLeft', text: `${p.username} 下线` });
    });

    on('kicked', (r) => {
      record({ kind: 'kicked', text: String(r).slice(0, 120) });
      if (cfg.wakeOn.disconnect) fire(['disconnect'], { kind: 'kicked', text: '被踢出' });
    });

    on('end', (reason) => {
      record({ kind: 'end', text: String(reason) });
      if (cfg.wakeOn.disconnect) fire(['disconnect'], { kind: 'end', text: `连接结束：${reason}` });
      disarm('连接结束');
    });

    on('error', (e) => record({ kind: 'error', text: String(e?.message || e).slice(0, 120) }));
  }

  function startHeartbeat() {
    if (timer && timer.__hb) return;
    if (!cfg.wakeOn.heartbeat) return;
    const hb = setInterval(() => {
      if (!armed) return;
      const idle = lastWakeAt ? Date.now() - lastWakeAt : Date.now() - (startedAt || 0);
      if (idle >= cfg.heartbeatSec * 1000) {
        fire(['heartbeat'], { kind: 'heartbeat', text: `已经 ${Math.round(idle / 1000)} 秒没动静了` });
      }
    }, Math.min(30000, cfg.heartbeatSec * 1000));
    hb.__hb = true;
    listeners.push(['__heartbeat', hb]);
    timer = hb;
  }

  let startedAt = 0;

  function arm() {
    if (armed) return;
    armed = true;
    startedAt = Date.now();
    bind();
    startHeartbeat();
    log('看门狗已挂载');
  }

  function disarm(why = '') {
    if (!armed) return;
    armed = false;
    for (const [evt, fn] of listeners) {
      if (evt === '__heartbeat') clearInterval(fn);
      else { try { bot.removeListener(evt, fn); } catch {} }
    }
    listeners.length = 0;
    if (timer) { clearTimeout(timer); clearInterval(timer); timer = null; }
    log(`看门狗已关闭${why ? '：' + why : ''}`);
  }

  function status() {
    return {
      armed,
      config: cfg,
      stats,
      lastWakeAt: lastWakeAt || null,
      lastWakeAgoSec: lastWakeAt ? Math.round((Date.now() - lastWakeAt) / 1000) : null,
      recent: recent.slice(-8),
    };
  }

  function companionActivity(activity) {
    if (!armed || !['采集木头', '采矿'].includes(activity?.activity)) return;
    fire(['companionActivity'], { kind: 'companionActivity', text: `刚观察到玩家可能在${activity.activity}（${activity.block}），可以根据情况在 QQ 商量，不要假装已帮忙` });
  }
  return { arm, disarm, status, calledBy, record, companionActivity, config: cfg, setConfig: (patch) => Object.assign(cfg, patch) };
}

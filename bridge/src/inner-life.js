// 持久的交流状态：由聊天模型结合消息语境评估，不做辱骂关键词匹配。
// 此模块无网络、文件和发送能力；所有状态按会话隔离。
const HOUR = 3600000;
const BASE = { joy: 15, anger: 0, sadness: 0, curiosity: 30, energy: 65 };
const HALF_LIFE = { joy: 2 * HOUR, anger: HOUR, sadness: 3 * HOUR, curiosity: 6 * HOUR, energy: 6 * HOUR };
const EVENTS = new Set(['teasing', 'insult', 'appreciation', 'apology', 'success', 'disappointment', 'interest', 'fatigue']);
const PERSONAL = new Set(['teasing', 'insult', 'appreciation', 'apology']);
const ACTIONS = new Set(['set', 'progress', 'complete', 'abandon']);
const text = (value, max = 160) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
const score = (value, fallback = 0) => Number.isFinite(Number(value)) ? Math.min(100, Math.max(0, Number(value))) : fallback;
const timestamp = (value, now) => Number.isFinite(Number(value)) && Number(value) > 0 ? Math.min(now, Number(value)) : now;
const decay = (value, base, elapsed, halfLife) => base + (value - base) * Math.pow(0.5, Math.max(0, elapsed) / halfLife);
const userId = (value) => /^[1-9]\d{4,19}$/.test(String(value ?? '')) ? String(value) : '';
function fail(message, statusCode = 400) { throw Object.assign(new Error(message), { statusCode }); }

export function normalizeInnerLife(raw = {}, now = Date.now()) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const affect = source.affect && typeof source.affect === 'object' ? source.affect : {};
  const elapsed = Math.max(0, now - timestamp(affect.updatedAt, now));
  const normalized = {
    version: 1,
    affect: { reason: text(affect.reason), updatedAt: now },
    relationships: {},
    goals: [],
    lastEventSeq: Math.max(0, Math.floor(Number(source.lastEventSeq) || 0)),
    nextGoalId: Math.max(1, Math.floor(Number(source.nextGoalId) || 1))
  };
  for (const [key, base] of Object.entries(BASE)) normalized.affect[key] = decay(score(affect[key], base), base, elapsed, HALF_LIFE[key]);
  for (const [id, item] of Object.entries(source.relationships || {}).slice(-50)) {
    if (!userId(id) || !item || typeof item !== 'object') continue;
    const age = Math.max(0, now - timestamp(item.updatedAt, now));
    normalized.relationships[id] = {
      irritation: decay(score(item.irritation), 0, age, 24 * HOUR),
      warmth: decay(score(item.warmth, 35), 35, age, 7 * 24 * HOUR),
      boundary: text(item.boundary),
      reason: text(item.reason),
      avoidUntil: Math.min(now + 6 * HOUR, Math.max(0, Number(item.avoidUntil) || 0)),
      updatedAt: now,
      lastEventAt: timestamp(item.lastEventAt ?? item.updatedAt, now)
    };
  }
  const seen = new Set();
  for (const item of (Array.isArray(source.goals) ? source.goals : []).slice(-12)) {
    if (!item || !/^g[1-9]\d*$/.test(String(item.id)) || seen.has(item.id) || !text(item.title)) continue;
    seen.add(item.id);
    normalized.nextGoalId = Math.max(normalized.nextGoalId, Number(item.id.slice(1)) + 1);
    const expiresAt = Number(item.expiresAt) || now;
    normalized.goals.push({
      id: item.id, title: text(item.title, 100), motivation: text(item.motivation), nextStep: text(item.nextStep),
      status: expiresAt <= now && item.status === 'active' ? 'expired' : ['active', 'done', 'abandoned', 'expired'].includes(item.status) ? item.status : 'expired',
      createdAt: timestamp(item.createdAt, now), updatedAt: timestamp(item.updatedAt, now), expiresAt
    });
  }
  return normalized;
}

export function updateInnerLife(raw, patch, { messages = [], now = Date.now(), sanitize = (value) => value } = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || (!patch.appraisal && !patch.goal)) fail('需要 appraisal 或 goal');
  const state = normalizeInnerLife(raw, now);
  const clean = (value, max = 160) => text(sanitize(text(value, max)), max);
  let duplicate = false;
  if (patch.appraisal) {
    const event = patch.appraisal;
    if (!EVENTS.has(event.kind) || !clean(event.reason)) fail('appraisal.kind 无效或缺少 reason');
    const intensity = event.intensity === undefined ? 1 : Number(event.intensity);
    if (!Number.isInteger(intensity) || intensity < 1 || intensity > 3) fail('intensity 必须是 1~3');
    const seq = Number(event.sourceSeq);
    if (!Number.isSafeInteger(seq) || seq <= 0) fail('sourceSeq 必须是实际收到的消息序号');
    const message = messages.find((m) => !m?.isSelf && Number(m?.seq) === seq);
    if (!message || now - Number(message.time) > 24 * HOUR) fail('找不到近期来源消息，请先查看未读或最近消息');
    const id = userId(message.userId);
    if (PERSONAL.has(event.kind) && !id) fail('人际事件必须有来源成员的稳定 QQ ID');
    if (event.targetUserId !== undefined && String(event.targetUserId) !== id) fail('人际态度只能更新来源消息的发送者，不能张冠李戴');
    duplicate = seq <= state.lastEventSeq;
    if (!duplicate) {
      const affect = state.affect;
      const add = (key, delta) => { affect[key] = score(affect[key] + delta * intensity); };
      const relation = PERSONAL.has(event.kind) ? (state.relationships[id] ||= { irritation: 0, warmth: 35, boundary: '', reason: '', avoidUntil: 0, updatedAt: now }) : null;
      if (event.kind === 'insult') {
        add('anger', 19); add('sadness', 7); add('joy', -8); add('energy', -4);
        relation.irritation = score(relation.irritation + 24 * intensity);
        relation.warmth = score(relation.warmth - 10 * intensity);
        relation.boundary = clean(event.reason);
        relation.avoidUntil = now + intensity * 15 * 60000;
      } else if (event.kind === 'apology') {
        // 一句道歉可以缓和，但不会抹掉此前持续冒犯的影响。
        if (relation.irritation > 0) { add('anger', -10); add('sadness', -5); }
        relation.irritation = score(relation.irritation - 16 * intensity);
        relation.warmth = score(relation.warmth + 4 * intensity);
        if (relation.irritation < 20) { relation.avoidUntil = 0; relation.boundary = ''; }
      } else if (event.kind === 'appreciation') {
        add('joy', 12); add('energy', 4); relation.warmth = score(relation.warmth + 6 * intensity);
      } else if (event.kind === 'teasing') {
        add('joy', 4); relation.warmth = score(relation.warmth + 2 * intensity);
      } else if (event.kind === 'success') {
        add('joy', 16); add('energy', 5);
      } else if (event.kind === 'disappointment') {
        add('sadness', 13); add('joy', -8); add('energy', -5);
      } else if (event.kind === 'interest') {
        add('curiosity', 15); add('energy', 3);
      } else if (event.kind === 'fatigue') {
        add('energy', -12);
      }
      affect.reason = clean(event.reason);
      if (relation) { relation.reason = clean(event.reason); relation.updatedAt = now; relation.lastEventAt = now; }
      state.lastEventSeq = seq;
    }
  }
  if (patch.goal) {
    const goal = patch.goal;
    if (!ACTIONS.has(goal.action)) fail('goal.action 无效');
    if (goal.action === 'set') {
      if (!clean(goal.title, 100) || !clean(goal.motivation) || !clean(goal.nextStep)) fail('新目标需要 title / motivation / nextStep');
      const existing = state.goals.find((item) => item.status === 'active' && item.title === clean(goal.title, 100));
      if (!existing) {
        if (state.goals.filter((item) => item.status === 'active').length >= 3) fail('最多保留三个进行中的目标，请先完成或放下旧目标', 409);
        const hours = goal.expiresInHours === undefined ? 72 : Number(goal.expiresInHours);
        if (!Number.isFinite(hours) || hours < 1 || hours > 168) fail('目标有效期必须是 1~168 小时');
        state.goals.push({ id: `g${state.nextGoalId++}`, title: clean(goal.title, 100), motivation: clean(goal.motivation), nextStep: clean(goal.nextStep), status: 'active', createdAt: now, updatedAt: now, expiresAt: now + hours * HOUR });
      }
    } else {
      const existing = state.goals.find((item) => item.id === goal.id && item.status === 'active');
      if (!existing) fail('找不到这个进行中的目标');
      if (goal.action === 'progress' && !clean(goal.nextStep)) fail('更新进展需要 nextStep');
      if (goal.nextStep !== undefined) existing.nextStep = clean(goal.nextStep);
      if (goal.action === 'complete') {
        existing.status = 'done';
        state.affect.joy = score(state.affect.joy + 12);
        state.affect.energy = score(state.affect.energy + 4);
        state.affect.reason = `完成了自己想做的事：${existing.title}`;
      }
      if (goal.action === 'abandon') existing.status = 'abandoned';
      existing.updatedAt = now;
    }
  }
  // 有界存储；完成记录优先淘汰，进行中的目标不会被历史挤掉。
  state.goals = [...state.goals.filter((g) => g.status !== 'active').slice(-9), ...state.goals.filter((g) => g.status === 'active')];
  state.relationships = Object.fromEntries(Object.entries(state.relationships).sort((a, b) => a[1].lastEventAt - b[1].lastEventAt).slice(-50));
  return { state, duplicate };
}

export function formatInnerLife(raw, { messages = [], now = Date.now(), compact = false } = {}) {
  const state = normalizeInnerLife(raw, now);
  const affect = state.affect;
  const words = { joy: '愉快', anger: '恼火', sadness: '低落', curiosity: '好奇' };
  const feelings = Object.entries(words).filter(([key]) => affect[key] >= 25).map(([key, label]) => `${label}${affect[key] >= 65 ? '明显' : '一些'}`);
  const lines = ['【自己的情绪与打算（内部状态，不对外报数或念旁白）】', `- 目前：${feelings.join('、') || '平静'}；精力${affect.energy < 35 ? '偏低' : affect.energy > 75 ? '较足' : '正常'}。`];
  if (affect.reason && ['joy', 'anger', 'sadness', 'curiosity'].some((key) => Math.abs(affect[key] - BASE[key]) >= 10)) lines.push(`- 最近缘由：${affect.reason}`);
  const present = new Set(messages.filter((m) => !m?.isSelf && m?.userId).slice(-30).map((m) => String(m.userId)));
  const relations = Object.entries(state.relationships).filter(([id, r]) => present.has(id) || r.avoidUntil > now).sort((a, b) => b[1].lastEventAt - a[1].lastEventAt).slice(0, 6);
  for (const [id, relation] of relations) {
    const attitude = relation.irritation >= 45 ? '明显不满，少搭理挑衅' : relation.irritation >= 20 ? '仍有些介意' : relation.warmth >= 55 ? '较亲近' : '正常相处';
    lines.push(`- 对 QQ ${id}：${attitude}${relation.avoidUntil > now ? '，暂时不主动找此人' : ''}${relation.boundary && relation.irritation >= 20 ? `；边界缘由：${relation.boundary}` : ''}。`);
  }
  for (const goal of state.goals.filter((item) => item.status === 'active')) lines.push(`- 自己想做的事 ${goal.id}：${goal.title}；动机：${goal.motivation}；下一步：${goal.nextStep}。`);
  if (compact) {
    lines.push('- 确有变化再 qq_update_inner_state；sourceSeq 用新消息的 seq，目标有真实进展才更新。');
    return lines.join('\n');
  }
  lines.push('- 新消息确实让情绪改变时，用 qq_update_inner_state 的 appraisal 保存；sourceSeq 取消息的 seq。先分清对象、熟人玩笑与持续恶意，不按脏字判定，不把别人的难过登记成自己的经历。没有变化就不调用，重复消息不反复计入。');
  lines.push('- 不满会影响对该人的态度：可以直说不喜欢、拒绝陪骂、结束对话；不用靠耍宝、自嘲把冒犯圆过去。对无关的人正常说话。真诚道歉能缓和，关系修复可以有过程。');
  lines.push('- 目标只在现有权限内推进：用 goal 保存一到三个具体兴趣或未完的小事，取得真实进展才更新，完成或没兴趣就放下。它不是催群友陪聊的任务，也不会扩展执行权限。');
  return lines.join('\n');
}

export function canInitiateInnerLife(raw, { lastIncomingAt = 0, lastAiReplyAt = 0, now = Date.now() } = {}) {
  // 上次主动说话还没有人接，停止下一次冷场冒泡；直接消息的唤醒不受影响。
  if (lastAiReplyAt > 0 && lastAiReplyAt >= lastIncomingAt) return false;
  return normalizeInnerLife(raw, now).affect.energy >= 25;
}

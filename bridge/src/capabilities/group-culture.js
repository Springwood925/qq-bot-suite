// 能力二：融入具体的群（按群/人格隔离的群文化摘要）
//
// 设计：
// - 只对白名单群、且只统计**实际收到的他人消息**（自己的发言不参与统计）；
// - 摘要只保存聚合结果（高频词、称呼、氛围指标）与少量来源 ref，不搬运私事原文；
// - 隔离键 = scope（group:群号 / private:QQ号）+ persona（当前角色名）。
//   人格切换后，同一个群的摘要不会串到另一个角色身上；旧摘要仍保留可查。
// - 纯本地统计，不调用聊天模型，不产生外部请求；后台增量刷新有最小间隔与条数门槛。
const STOP = new Set([
  '这个', '那个', '什么', '就是', '不是', '可以', '没有', '还是', '然后', '感觉', '现在', '真的',
  '我们', '你们', '他们', '她们', '它们', '自己', '一个', '一下', '这么', '那么', '怎么', '这样',
  '那样', '知道', '觉得', '应该', '已经', '可能', '因为', '所以', '但是', '如果', '时候', '东西',
  '哈哈', '哈哈哈', '哈哈哈哈', '噗', '确实', '有点', '有点点', '不是吧', '好吧', '行的', '好的',
  '表情', '图片', '语音', '消息', '群友', '大家', '今天', '明天', '昨天', '谢谢', '没事', '笑死'
]);

const BAD_RE = /(https?:\/\/|www\.|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+|\d{5,})/;

export function segmentation(text) {
  const s = String(text ?? '').replace(/\[CQ:[^\]]*\]/g, ' ').replace(/\[[^\]]{1,8}\]/g, ' ');
  return s.split(/[^\p{Script=Han}]+/u).map((x) => x.trim()).filter(Boolean);
}

export function extractTerms(messages, { minCount = 3, minUsers = 2, maxLen = 4 } = {}) {
  const counts = new Map(); // term -> {count, users:Set}
  for (const m of messages) {
    const body = String(m.body ?? '');
    if (!body || body.length > 200) continue;
    if (BAD_RE.test(body)) continue;
    const userId = String(m.user_id ?? '');
    const seen = new Set();
    for (const run of segmentation(body)) {
      if (run.length < 2) continue;
      for (let n = 2; n <= Math.min(maxLen, run.length); n++) {
        for (let i = 0; i + n <= run.length; i++) {
          const gram = run.slice(i, i + n);
          if (STOP.has(gram)) continue;
          if (/^(.)\1+$/.test(gram)) continue;
          if (!seen.has(gram)) {
            seen.add(gram);
            const rec = counts.get(gram) || { count: 0, users: new Set() };
            rec.count += 1;
            if (userId) rec.users.add(userId);
            counts.set(gram, rec);
          }
        }
      }
    }
  }
  return [...counts.entries()]
    .filter(([, v]) => v.count >= minCount && v.users.size >= minUsers)
    .map(([term, v]) => ({ term, count: v.count, users: v.users.size }))
    .sort((a, b) => b.count - a.count || b.term.length - a.term.length);
}

export function buildSummary(rows, { maxTerms = 12, maxTopics = 6 } = {}) {
  const messages = rows.filter((r) => String(r.body ?? '').trim());
  const terms = extractTerms(messages).slice(0, maxTerms);
  const topics = terms.filter((t) => t.term.length >= 3).slice(0, maxTopics);
  const nicknames = new Map();
  for (const m of messages) {
    const name = String(m.user_name ?? '').trim();
    if (!name || name.length > 12) continue;
    const rec = nicknames.get(name) || { name, userId: String(m.user_id ?? ''), count: 0 };
    rec.count += 1;
    nicknames.set(name, rec);
  }
  const metas = messages.map((m) => { try { return JSON.parse(m.meta || '{}'); } catch { return {}; } });
  const avgChars = messages.length ? Math.round(messages.reduce((a, m) => a + String(m.body).length, 0) / messages.length) : 0;
  const stickerRatio = messages.length ? Number((metas.filter((x) => x.sticker).length / messages.length).toFixed(2)) : 0;
  const imageRatio = messages.length ? Number((metas.filter((x) => x.image).length / messages.length).toFixed(2)) : 0;
  return {
    messages: messages.length,
    terms,
    topics,
    nicknames: [...nicknames.values()].sort((a, b) => b.count - a.count).slice(0, 10),
    vibe: {
      avgChars,
      stickerRatio,
      imageRatio,
      tone: stickerRatio >= 0.35 ? '表情包多、偏玩闹' : avgChars >= 60 ? '长消息多、偏认真' : '短句闲聊为主'
    },
    sourceRefs: messages.slice(0, 20).map((m) => m.ref)
  };
}

export function createGroupCulture({ db, config, sources, now = Date.now, log = () => {} }) {
  const cfg = () => config().groupCulture || {};

  function persona(scope) {
    // 隔离键包含人格：人格切换后旧摘要仍按自己的 key 保存
    const row = db.prepare('SELECT persona FROM cap_group_culture WHERE scope=?').get(String(scope));
    return row?.persona ?? '';
  }

  function key(scope, personaName) {
    return `${scope}::${personaName || ''}`;
  }

  function get(scope, personaName) {
    const row = db.prepare('SELECT * FROM cap_group_culture WHERE scope=? AND persona=?').get(key(scope, personaName), String(personaName || ''));
    if (!row) return null;
    try { return { ...row, summary: JSON.parse(row.summary) }; } catch { return null; }
  }

  function countSince(scope, at) {
    return db.prepare('SELECT count(*) c FROM cap_sources WHERE scope=? AND is_self=0 AND at>?').get(String(scope), Number(at || 0)).c;
  }

  function refresh(scope, personaName = '', force = false) {
    const c = cfg();
    if (c.enabled === false && !force) return { skipped: 'disabled' };
    const current = get(scope, personaName);
    const since = current?.updated_at || 0;
    const newCount = countSince(scope, since);
    const minNew = Number(c.minNewMessages || 40);
    const minGap = Number(c.refreshMinutes || 30) * 60000;
    if (!force) {
      if (!current) {
        // 第一次整理要攒够门槛，避免拿一两条消息就给整个群下结论
        if (newCount < minNew) return { skipped: 'not_due', newCount };
      } else if (newCount < 3 || (newCount < Math.max(5, Math.floor(minNew / 4)) && now() - since < minGap)) {
        return { skipped: 'not_due', newCount };
      }
    }
    const rows = sources.recent(scope, now() - 30 * 86400000);
    if (!rows.length) return { skipped: 'no_messages' };
    const summary = buildSummary(rows, { maxTerms: Number(c.maxTerms || 12), maxTopics: Number(c.maxTopics || 6) });
    summary.persona = String(personaName || '');
    summary.generatedAt = now();
    db.prepare(
      `INSERT INTO cap_group_culture(scope,persona,summary,cursor,messages,updated_at) VALUES(?,?,?,?,?,?)
       ON CONFLICT(scope) DO UPDATE SET persona=excluded.persona, summary=excluded.summary,
         cursor=excluded.cursor, messages=excluded.messages, updated_at=excluded.updated_at`
    ).run(key(scope, personaName), String(personaName || ''), JSON.stringify(summary), now(), rows.length, now());
    log(`[capabilities] 群文化摘要已更新 ${scope}（${personaName || '默认人格'}）：${summary.terms.length} 个高频词`);
    return { updated: true, summary };
  }

  /** 注入文本：只给当前 scope+人格，限额；无摘要返回空串。 */
  function injection(scope, personaName = '') {
    const c = cfg();
    if (c.enabled === false) return { text: '', summary: null };
    const row = get(scope, personaName);
    if (!row) return { text: '', summary: null };
    const s = row.summary;
    const maxChars = Number(c.injectMaxChars || 900);
    const lines = [];
    if (s.terms?.length) lines.push('常出现的词：' + s.terms.slice(0, 8).map((t) => t.term).join('、'));
    if (s.topics?.length) lines.push('可能在聊：' + s.topics.slice(0, 5).map((t) => t.term).join('、'));
    if (s.nicknames?.length) lines.push('常见称呼：' + s.nicknames.slice(0, 5).map((n) => n.name).join('、'));
    if (s.vibe) lines.push(`氛围：${s.vibe.tone}（平均 ${s.vibe.avgChars} 字${s.vibe.stickerRatio >= 0.35 ? '，表情包多' : ''}）`);
    let text = lines.length ? '【这个群的习惯（本地统计，仅供参考）】\n' + lines.join('\n') : '';
    if (text.length > maxChars) text = text.slice(0, maxChars) + '…';
    return { text, summary: s, updatedAt: row.updated_at };
  }

  function status(scope, personaName = '') {
    const row = get(scope, personaName);
    return {
      enabled: cfg().enabled !== false,
      hasSummary: !!row,
      updatedAt: row?.updated_at || 0,
      messageCount: row?.messages || 0,
      summary: row?.summary || null,
      minNewMessages: Number(cfg().minNewMessages || 40)
    };
  }

  return { refresh, injection, status, get, key, persona };
}

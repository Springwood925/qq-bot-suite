// 能力三：有自己的活动（统一调度 + 全局预算 + 只读公开内容）
//
// 关键约束：
// - 所有活动都经过同一个调度器与 gate：全局每日预算、最小间隔、并发锁、静默时段、
//   失败退避、去重、重启恢复；任何模块都不能自己起一套“定时发东西”。
// - B站/网页只记录**实际取回**的字段：标题、简介、评论摘要、抽帧描述。
//   没有取到的内容不写、不推测，更不写成“听过了/看完了”。
// - 没有合适兴趣或没有任何内容 → 直接跳过，不为活动而活动。
import crypto from 'node:crypto';
import { inQuietHours, dayKey } from './config.js';

const LOCK_KEY = 'activity_lock';

export function createActivity({ db, config, gate, growth, adapters = {}, now = Date.now, log = () => {} }) {
  const cfg = () => config().activity || {};

  function meta(key) {
    const row = db.prepare('SELECT value FROM cap_meta WHERE key=?').get(key);
    return row ? row.value : null;
  }
  function setMeta(key, value) {
    db.prepare('INSERT INTO cap_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
  }

  function recoverStale() {
    const ttl = Number(cfg().taskTtlMinutes || 15) * 60000;
    const stale = db.prepare("SELECT id,started_at FROM cap_activity_job WHERE status='running'").all()
      .filter((j) => now() - Number(j.started_at) > ttl);
    for (const job of stale) {
      db.prepare("UPDATE cap_activity_job SET status='failed', finished_at=?, error=? WHERE id=?")
        .run(now(), 'interrupted_timeout', job.id);
      log(`[capabilities] 活动任务 ${job.id} 超时未完成，已按中断恢复`);
    }
    const lock = meta(LOCK_KEY);
    if (lock) {
      try {
        const parsed = JSON.parse(lock);
        if (now() - Number(parsed.at) > ttl) { setMeta(LOCK_KEY, ''); log('[capabilities] 清理过期的活动并发锁'); }
      } catch { setMeta(LOCK_KEY, ''); }
    }
    return stale.length;
  }

  function lastAttemptAt() {
    const row = db.prepare("SELECT max(started_at) m FROM cap_activity_job").get();
    return Number(row?.m || 0);
  }

  function dailyUsed() {
    return Number(db.prepare('SELECT used FROM cap_quota WHERE key=?').get(`activity:run:${dayKey(new Date(now()))}`)?.used || 0);
  }

  function acquireLock(id) {
    const current = meta(LOCK_KEY);
    if (current) {
      try { const p = JSON.parse(current); if (p && p.id && now() - Number(p.at) < Number(cfg().taskTtlMinutes || 15) * 60000) return false; } catch { /* overwrite below */ }
    }
    setMeta(LOCK_KEY, JSON.stringify({ id, at: now() }));
    return true;
  }
  function releaseLock(id) {
    try { const p = JSON.parse(meta(LOCK_KEY) || '{}'); if (!p.id || p.id === id) setMeta(LOCK_KEY, ''); } catch { setMeta(LOCK_KEY, ''); }
  }

  function interests() {
    const out = new Set((cfg().interests || []).map((x) => String(x).trim()).filter(Boolean));
    // 沿真实成长里的兴趣推进（只取实际生效的）
    for (const row of db.prepare("SELECT content FROM cap_growth WHERE status='active' AND kind='interest'").all()) out.add(String(row.content));
    return [...out];
  }

  function recentTopics(limit = 30) {
    return new Set(db.prepare('SELECT topic FROM cap_activity_job ORDER BY started_at DESC LIMIT ?').all(limit).map((r) => r.topic));
  }

  /**
   * 兴趣来源：每条都带 scope，避免把别的群/私聊的兴趣拿去做对外活动。
   * 来源优先级：管理员显式配置（scope=null，允许）→ 实际生效的成长兴趣（按 scope）
   *            → 注入的既有机制（learning-cycle 计划 / inner-life 目标，按 scope）。
   */
  function interestSources() {
    const c = cfg();
    const publishTopics = new Set((c.publishTopics || []).map((x) => String(x).trim()).filter(Boolean));
    const out = [];
    for (const topic of (c.interests || []).map((x) => String(x).trim()).filter(Boolean)) {
      out.push({ scope: null, topic, origin: 'config', query: topic, urls: [], publishOk: publishTopics.has(topic) });
    }
    for (const row of db.prepare("SELECT scope, content FROM cap_growth WHERE status='active' AND kind='interest'").all()) {
      const topic = String(row.content);
      out.push({ scope: String(row.scope), topic, origin: 'growth', query: topic, urls: [], publishOk: publishTopics.has(topic) });
    }
    if (typeof adapters.interestSources === 'function') {
      try {
        for (const item of adapters.interestSources() || []) {
          if (!item?.topic || !item?.scope) continue;
          out.push({
            scope: String(item.scope),
            topic: String(item.topic),
            id: item.id ? String(item.id) : undefined,
            query: String(item.query || item.topic),
            urls: Array.isArray(item.urls) ? item.urls.map(String).filter((u) => /^https?:\/\//i.test(u)) : [],
            origin: String(item.origin || 'learning'),
            publishOk: publishTopics.has(String(item.topic))
          });
        }
      } catch (error) { log(`[capabilities] 既有学习兴趣读取失败：${error?.message ?? error}`); }
    }
    // 同一 topic 只留一条；有 scope 的优先于全局配置（避免配置里的词盖掉本群真实兴趣）
    const byTopic = new Map();
    for (const s of out) {
      if (!s.topic || s.topic === '[object Object]') continue;
      const prev = byTopic.get(s.topic);
      if (!prev || (prev.scope === null && s.scope)) byTopic.set(s.topic, s);
    }
    return [...byTopic.values()];
  }

  function pickInterest() {
    const all = interestSources();
    if (!all.length) return null;
    const seen = recentTopics();
    const fresh = all.filter((x) => !seen.has(x.topic));
    const pool = fresh.length ? fresh : all;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function existingEvidence(kind, key) {
    return db.prepare('SELECT id FROM cap_activity_job WHERE kind=? AND status=? AND evidence LIKE ? LIMIT 1')
      .get(kind, 'done', `%${key}%`);
  }

  async function withTimeout(promise, ms, label) {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} 超时`)), ms); })
      ]);
    } finally { clearTimeout(timer); }
  }

  /**
   * 手动/后台执行一次活动。
   * @param {{force?:boolean, scope?:string, kind?:'web'|'bili'}} opts
   */
  async function run(opts = {}) {
    const c = cfg();
    if (c.enabled === false) return { skipped: 'disabled' };
    if (inQuietHours(new Date(now()), c.quietHours) && !opts.force) return { skipped: 'quiet_hours' };

    const recovered = recoverStale();
    const cooldownMs = Number(c.cooldownMinutes || 90) * 60000;
    const bypassCooldown = opts.force === true && opts.actor === 'admin';
    if (!bypassCooldown && lastAttemptAt() && now() - lastAttemptAt() < cooldownMs) {
      return { skipped: 'cooldown', waitMs: cooldownMs - (now() - lastAttemptAt()) };
    }

    const source = opts.topic ? { scope: opts.scope || null, topic: opts.topic, origin: 'manual' } : pickInterest();
    if (!source) return { skipped: 'no_interest' };
    const topic = source.topic;
    const scope = opts.scope || source.scope || null;

    const kind = opts.kind || (adapters.bili && /bilibili|b站|视频|动画|游戏|番剧|up/i.test(topic) ? 'bili' : 'web');
    const adaptersReady = kind === 'bili' ? typeof adapters.readBili === 'function' : typeof adapters.readWeb === 'function';
    if (!adaptersReady) return { skipped: 'adapter_missing', kind };

    const permit = gate.check({
      module: 'activity', action: 'run', actor: opts.actor || 'background',
      scope, perDay: Number(c.dailyBudget || 4), minIntervalMs: 0,
      forceReal: true
    });
    if (!permit.ok) return { skipped: permit.reason };

    const id = `job-${now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`;
    if (!acquireLock(id)) return { skipped: 'busy', recovered };
    const visibility = scope ? 'scope' : 'public';
    const publishOk = source.publishOk === true ? 1 : 0;
    db.prepare('INSERT INTO cap_activity_job(id,scope,kind,topic,status,dedupe_key,started_at,attempts,visibility,publish_ok) VALUES(?,?,?,?,?,?,?,1,?,?)')
      .run(id, scope, kind, topic, 'running', `${kind}:${topic}`, now(), visibility, publishOk);

    try {
      const limit = Number(c.maxResults || 3);
      // 适配器收到完整来源：learning 来源带 id/query/已读 urls，不允许只拿标题去搜
      const results = kind === 'bili'
        ? await withTimeout(adapters.readBili(source, { limit }), Number(c.taskTtlMinutes || 15) * 60000, 'B站读取')
        : await withTimeout(adapters.readWeb(source, { limit }), Number(c.taskTtlMinutes || 15) * 60000, '网页读取');

      const evidence = (Array.isArray(results) ? results : []).filter((r) => r && (r.title || r.description || r.desc || r.body)).slice(0, limit);
      if (!evidence.length) {
        db.prepare("UPDATE cap_activity_job SET status='skipped', finished_at=?, error=? WHERE id=?").run(now(), 'no_content', id);
        permit.commit('no_content');
        return { skipped: 'no_content', jobId: id, recovered };
      }
      const deduped = [];
      for (const item of evidence) {
        const key = String(item.bvid || item.url || item.title || '').slice(0, 200);
        if (key && existingEvidence(kind, key)) continue;
        deduped.push(item);
      }
      if (!deduped.length) {
        db.prepare("UPDATE cap_activity_job SET status='skipped', finished_at=?, error=? WHERE id=?").run(now(), 'duplicate_only', id);
        permit.commit('duplicate_only');
        return { skipped: 'duplicate_only', jobId: id, recovered };
      }
      const payload = {
        kind,
        topic,
        scope,
        origin: source.origin,
        visibility,
        publishOk: publishOk === 1,
        sourceUrls: Array.isArray(source.urls) ? source.urls : [],
        readAt: now(),
        items: deduped.map((x) => sanitizeEvidence(kind, x)),
        // 明确“实际拿到了什么”：搜索摘要 ≠ 正文
        obtained: kind === 'bili' ? biliObtained(deduped) : webObtained(deduped),
        note: kind === 'bili'
          ? '只记录实际取回的标题/简介/评论/抽帧，不声称听过或看完视频。'
          : '标题/摘要是搜索摘要；只有实际抓取到页面时才标记正文。'
      };
      db.prepare("UPDATE cap_activity_job SET status='done', finished_at=?, evidence=? WHERE id=?")
        .run(now(), JSON.stringify(payload), id);
      permit.commit(`${kind}:${topic}`);
      log(`[capabilities] 活动完成 ${kind}「${topic}」：${deduped.length} 条真实内容`);
      return { ok: true, jobId: id, topic, kind, scope, evidence: payload, recovered };
    } catch (error) {
      db.prepare("UPDATE cap_activity_job SET status='failed', finished_at=?, error=? WHERE id=?")
        .run(now(), String(error?.message ?? error).slice(0, 300), id);
      permit.fail(error?.message ?? error);
      const backoff = Number(c.retryBackoffMinutes || 30) * 60000;
      setMeta('activity_backoff_until', String(now() + backoff));
      log(`[capabilities] 活动失败（${kind}「${topic}」）：${error?.message ?? error}`);
      return { error: String(error?.message ?? error), jobId: id };
    } finally {
      releaseLock(id);
    }
  }

  /**
   * agent 提示词用：只返回**当前 scope 自己的**活动，以及显式标记为可公开的全局资料。
   * 管理员看全部请用 status()（jobs 不过滤）。正文只保留有限长度并带来源/不确定性。
   */
  function recentEvidence(scope, limit = 3) {
    if (!scope) return [];
    const rows = db.prepare(
      `SELECT topic,scope,evidence,finished_at,visibility,publish_ok FROM cap_activity_job
       WHERE status='done' AND (scope=? OR visibility='public')
       ORDER BY finished_at DESC LIMIT ?`
    ).all(String(scope), Math.max(1, Math.min(10, limit)));
    return rows.map((r) => {
      let ev = null;
      try { ev = r.evidence ? JSON.parse(r.evidence) : null; } catch { /* ignore */ }
      return {
        topic: r.topic,
        scope: r.scope,
        visibility: r.visibility,
        publishOk: Number(r.publish_ok) === 1,
        at: r.finished_at,
        origin: ev?.origin || null,
        sourceUrls: ev?.sourceUrls || [],
        uncertainty: '网页摘录可能不完整；只有 bodyFetched=true 的是实际抓取到的正文',
        items: (ev?.items || []).map((x) => ({
          title: x.title,
          url: x.url,
          summary: x.summary || null,
          body: x.body ? String(x.body).slice(0, 400) : null,
          bodyFetched: x.bodyFetched === true
        }))
      };
    });
  }

  /** 管理员显式允许把某次活动的材料用于对外生活痕迹。 */
  function markPublish(jobId, allow = true) {
    const row = db.prepare('SELECT id,scope FROM cap_activity_job WHERE id=?').get(String(jobId));
    if (!row) throw httpError(404, '找不到活动任务');
    db.prepare('UPDATE cap_activity_job SET publish_ok=? WHERE id=?').run(allow ? 1 : 0, String(jobId));
    return { id: row.id, publishOk: allow };
  }

  function tick() {
    try {
      const backoffUntil = Number(meta('activity_backoff_until') || 0);
      if (backoffUntil && now() < backoffUntil) return { skipped: 'backoff', waitMs: backoffUntil - now() };
      return run({ actor: 'background' });
    } catch (error) {
      log(`[capabilities] 活动调度异常：${error?.message ?? error}`);
      return { error: String(error?.message ?? error) };
    }
  }

  function status() {
    const c = cfg();
    const jobs = db.prepare('SELECT * FROM cap_activity_job ORDER BY started_at DESC LIMIT 10').all().map((j) => {
      let evidence = null;
      try { evidence = j.evidence ? JSON.parse(j.evidence) : null; } catch { /* ignore */ }
      return { ...j, evidence };
    });
    return {
      enabled: c.enabled !== false,
      budget: { perDay: Number(c.dailyBudget || 4), used: dailyUsed(), day: dayKey(new Date(now())) },
      cooldownMinutes: Number(c.cooldownMinutes || 90),
      quietHours: c.quietHours,
      inQuietHours: inQuietHours(new Date(now()), c.quietHours),
      lastAttemptAt: lastAttemptAt(),
      busy: !!meta(LOCK_KEY),
      interests: interestSources(),
      publishTopics: c.publishTopics || [],
      backoffUntil: Number(meta('activity_backoff_until') || 0),
      jobs
    };
  }

  return { run, tick, status, recoverStale, interests, interestSources, recentEvidence, markPublish };
}

function httpError(status, message) {
  const error = new Error(message);
  error.statusCode = status;
  return error;
}

function sanitizeEvidence(kind, item) {
  const out = {
    title: String(item.title || '').slice(0, 200),
    url: String(item.url || '').slice(0, 500)
  };
  if (kind === 'bili') {
    out.bvid = String(item.bvid || '').slice(0, 20);
    out.description = String(item.description || item.desc || '').slice(0, 800);
    if (Array.isArray(item.comments)) out.comments = item.comments.slice(0, 5).map((x) => String(x).slice(0, 160));
    if (Array.isArray(item.frames)) out.frames = item.frames.slice(0, 6).map((x) => String(x).slice(0, 200));
    out.owner = String(item.owner || '').slice(0, 60);
    out.durationSeconds = Number(item.durationSeconds) || 0;
  } else {
    out.summary = String(item.summary || item.snippet || item.description || '').slice(0, 800);
    out.description = String(item.description || item.snippet || '').slice(0, 800);
    if (item.body) { out.body = String(item.body).slice(0, 1200); out.bodyFetched = true; }
  }
  return out;
}

function biliObtained(items) {
  return {
    titles: items.filter((x) => x.title).length,
    descriptions: items.filter((x) => x.description || x.desc).length,
    comments: items.filter((x) => Array.isArray(x.comments) && x.comments.length).length,
    frames: items.filter((x) => Array.isArray(x.frames) && x.frames.length).length,
    watched: false,
    heard: false
  };
}

function webObtained(items) {
  return {
    titles: items.filter((x) => x.title).length,
    summaries: items.filter((x) => x.summary || x.snippet || x.description).length,
    bodies: items.filter((x) => x.bodyFetched === true || x.body).length
  };
}

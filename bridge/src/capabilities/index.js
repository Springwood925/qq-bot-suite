// 八类能力总装：统一配置、统一调度、统一管理路由。
//
// task-0002 修复：
// - 总开关关闭后：不登记来源、不刷新群文化、不改写输出、不复读、不接活动（全部 short-circuit）；
// - 注入返回批次；真实发送回执 message_id 才能记成长使用；
// - 活动证据、定向梗知识进入提示词，形成“阅读 → 记住 → 用上”的闭环；
// - 所有判定读同一份生效配置（config.json + SQLite 覆盖）。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { effectiveConfig, deepMerge, DEFAULT_CONFIG } from './config.js';
import { openStore, readOverrides, writeOverride, recentActions } from './store.js';
import { createSources } from './sources.js';
import { createGate } from './gate.js';
import { createGrowth } from './growth.js';
import { createGroupCulture } from './group-culture.js';
import { createActivity } from './activity.js';
import { createPresence } from './presence.js';
import { classifyIncoming, polishOutgoing, promptNote } from './speech.js';
import { createRecreation } from './recreation.js';
import { createTransfer } from './transfer.js';
import { createVoice } from './voice.js';

const CONFIG_WHITELIST_PREFIXES = [
  'enabled', 'dryRun',
  'growth.', 'groupCulture.', 'activity.', 'presence.', 'speech.',
  'recreation.', 'transfer.', 'voice.'
];

export function createCapabilities(deps) {
  const {
    root, stateDir, getConfig, log = () => {}, now = Date.now,
    onebot, fetchBuffer, listScopes = () => [], send = null,
    memeWiki, slangLookup, readCard, readForward, readLink,
    dashscope, fetchImpl, allowedTarget, isIdle = () => true,
    goalsForScope = () => [], learningTopicsForScope = () => []
  } = deps;

  const file = path.join(stateDir, 'capabilities.db');
  const store = openStore(file, { log });
  const { db } = store;

  let overrideCache = { at: 0, value: {} };
  function overrides() {
    if (now() - overrideCache.at < 1000) return overrideCache.value;
    overrideCache = { at: now(), value: readOverrides(db) };
    return overrideCache.value;
  }
  function config() {
    let base = {};
    try { base = (getConfig() || {}).capabilities || {}; } catch { base = {}; }
    return effectiveConfig(base, overrides());
  }
  function enabled() { return config().enabled !== false; }

  const sources = createSources({ db, now });
  const gate = createGate({ db, config, now, log });
  const growth = createGrowth({ db, config, sources, now, log, goalsForScope, learningTopicsForScope });
  const culture = createGroupCulture({ db, config, sources, now, log });
  const activity = createActivity({ db, config, gate, growth, adapters: deps.adapters || {}, now, log });
  const presence = createPresence({ db, config, gate, now, log, onebot, fetchBuffer, root });
  const recreation = createRecreation({ db, config, gate, now, log, memeWiki, slang: slangLookup, isIdle });
  const transfer = createTransfer({
    db, config, gate, now, log,
    isAllowedTarget: typeof allowedTarget === 'function' ? allowedTarget : null,
    readCard, readForward, readLink
  });
  const voice = createVoice({ db, config, now, log, dashscope, fetchImpl, stateDir });

  // 入站上下文按 scope+消息引用保存（不做 FIFO）；回复只认显式绑定到本轮执行/引用消息的那条。
  const contextByRef = new Map();   // scope -> Map(ref -> ctx)
  const turnBindings = new Map();   // `${scope}|${executionId}` -> {refs, contexts, at}
  const memeHints = new Map();

  function setContext(scope, refs, ctx) {
    if (!contextByRef.has(scope)) contextByRef.set(scope, new Map());
    const m = contextByRef.get(scope);
    for (const ref of refs) if (ref) m.set(String(ref), ctx);
    while (m.size > 20) m.delete(m.keys().next().value);
    if (contextByRef.size > 200) contextByRef.delete(contextByRef.keys().next().value);
  }

  /** 用真实唤醒执行的可见消息/触达消息引用绑定本轮上下文；同一轮多批发送复用同一份。 */
  function bindTurn(scope, executionId, refs = []) {
    if (!executionId) return null;
    const m = contextByRef.get(String(scope));
    const contexts = [];
    for (const ref of Array.isArray(refs) ? refs : []) {
      const ctx = m?.get(String(ref));
      if (ctx) contexts.push({ ...ctx, ref: String(ref) });
    }
    if (!contexts.length) return null;
    const key = `${scope}|${executionId}`;
    turnBindings.set(key, { contexts, at: now() });
    while (turnBindings.size > 200) turnBindings.delete(turnBindings.keys().next().value);
    return key;
  }

  function clearTurn(scope, executionId) {
    if (!executionId) return;
    turnBindings.delete(`${scope}|${executionId}`);
  }

  function observeIncoming(msg) {
    try {
      if (!enabled()) return { skipped: 'disabled' };
      if (!msg || !msg.scope) return { skipped: 'no_scope' };
      const text = String(msg.text ?? '').trim();
      const isSelf = msg.isSelf === true;
      const cfg = config();
      const cls = classifyIncoming({ text, segments: msg.segments || [], media: msg.media || [] });
      const ref = String(msg.messageId || msg.seq || '');
      // 模块都关掉时不再落来源，避免“关掉了还在偷偷记消息”
      const needSources = cfg.growth?.enabled !== false || cfg.groupCulture?.enabled !== false
        || cfg.transfer?.enabled !== false || cfg.recreation?.enabled !== false;
      if (ref && text && needSources) {
        sources.record({
          scope: msg.scope, ref, kind: 'message', body: text,
          userId: msg.userId, userName: msg.userName, isSelf,
          meta: { image: cls.hasImage, sticker: cls.hasSticker, screenshot: cls.isScreenshot }
        });
      }
      if (!isSelf) {
        // 绑定到具体消息引用，不做 FIFO：未触发的群消息不会顶掉本轮那张图。
        const ctx = { ...cls, at: now(), userId: msg.userId, userName: msg.userName, messageId: String(msg.messageId || msg.seq || '') };
        setContext(msg.scope, [String(msg.messageId || ''), String(msg.seq || '')], ctx);
        // 定向梗：只有真的在问梗时才查词库；查不到就什么都不注入
        try {
          if (memeWiki?.looksLikeProbe?.(text)) {
            const hit = recreation.memeReply(text);
            if (hit) memeHints.set(msg.scope, { ...hit, at: now() });
          }
        } catch { /* 词库不可用不影响收发 */ }
      }
      if (!isSelf && /^group:/.test(String(msg.scope))) {
        try { culture.refresh(msg.scope, msg.persona || ''); } catch (error) { log(`[capabilities] 群文化刷新失败：${error?.message ?? error}`); }
      }
      if (send) {
        void recreation.observe({ ...msg, text, hasMedia: cls.hasImage, hasSticker: cls.hasSticker }, send)
          .catch((error) => log(`[capabilities] 复读观察失败：${error?.message ?? error}`));
      }
      return { ok: true, classification: { hasImage: cls.hasImage, hasSticker: cls.hasSticker, stickerOnly: cls.stickerOnly, explicitAnalyze: cls.explicitAnalyze } };
    } catch (error) {
      log(`[capabilities] 入站观察失败：${error?.message ?? error}`);
      return { error: String(error?.message ?? error) };
    }
  }

  /**
   * 回复后的自然度处理。上下文只认显式绑定：
   * - opts.executionId：本轮唤醒执行绑定的上下文（同一轮多批发送复用，不消费）；
   * - opts.replyToMessageId：明确回复的那条消息；
   * - 都没有 → 上下文为空，原文不改（绝不拿任意 FIFO/最新群消息套图规则）。
   */
  function polishOutgoingText(scope, text, opts = {}) {
    if (!enabled()) return { text: String(text ?? ''), changed: false, reason: 'disabled' };
    let ctx = null;
    if (opts.executionId) {
      const binding = turnBindings.get(`${scope}|${opts.executionId}`);
      if (binding && now() - binding.at < 10 * 60000 && binding.contexts.length) {
        // 本轮里取“最新一条被绑定且带图/表情”的上下文；没有就取最新一条
        const withMedia = binding.contexts.filter((c) => c.hasImage || c.hasSticker);
        ctx = (withMedia.length ? withMedia[withMedia.length - 1] : binding.contexts[binding.contexts.length - 1]);
      }
    }
    if (!ctx && opts.replyToMessageId) {
      ctx = contextByRef.get(String(scope))?.get(String(opts.replyToMessageId)) || null;
    }
    if (!ctx) return { text: String(text ?? ''), changed: false, reason: 'no_bound_context' };
    const c = config().speech || {};
    return polishOutgoing(text, { ...ctx, hasImage: ctx.hasImage === true, hasSticker: ctx.hasSticker === true }, c);
  }

  function noteFor(scope, executionId = null) {
    if (!enabled()) return '';
    let ctx = null;
    if (executionId) {
      const binding = turnBindings.get(`${scope}|${executionId}`);
      if (binding?.contexts?.length) ctx = binding.contexts[binding.contexts.length - 1];
    }
    return ctx ? promptNote(ctx, config().speech || {}) : '';
  }

  function injection(scope, persona = '') {
    if (!enabled()) return { text: '', parts: [], batchId: null, items: [], growthText: '', cultureText: '', meme: null };
    const g = growth.injection(scope);
    const gc = culture.injection(scope, persona);
    const meme = memeHints.get(scope) || null;
    const parts = [g.text, gc.text].filter(Boolean);
    if (meme) parts.push(`【梗知识：${meme.title || ''}（词库原文，来源：${meme.source}${meme.hasOrigin ? '' : '，没有可靠来历'}）】${meme.text}`);
    return {
      text: parts.join('\n'),
      parts,
      batchId: g.batchId,
      items: g.items,
      growthText: g.text,
      growthItems: g.items,
      cultureText: gc.text,
      culture: gc.summary || null,
      meme
    };
  }

  /** 真实发送成功后调用（messageId 必填）：记录成长使用。 */  function recordDelivered({ scope, messageId, batchId }) {
    if (!messageId || !enabled()) return 0;
    return growth.recordDelivered({ scope, messageId, batchId });
  }

  /** agent 提示词用：严格按当前 scope（管理员全局状态走 scopeStatus）。 */
  function recentActivity(scope, limit = 3) {
    return activity.recentEvidence(scope, limit);
  }

  async function tick() {
    if (!enabled()) return { skipped: 'disabled' };
    const c = config();
    const result = {};
    try { result.expired = transfer.expire(); } catch (error) { log(`[capabilities] 过期清理失败：${error?.message ?? error}`); }
    try { voice.cleanup(); } catch { /* ignore */ }
    const personaByScope = deps.personaFor || (() => '');
    for (const scope of listScopes()) {
      if (!/^group:/.test(String(scope))) continue;
      if (c.groupCulture?.enabled !== false) {
        try { culture.refresh(scope, personaByScope(scope)); } catch (error) { log(`[capabilities] 摘要刷新失败 ${scope}：${error?.message ?? error}`); }
      }
      if (c.growth?.enabled !== false) {
        try { growth.suggest(scope); } catch (error) { log(`[capabilities] 成长候选失败 ${scope}：${error?.message ?? error}`); }
      }
    }
    try { result.activity = await activity.tick(); } catch (error) { result.activity = { error: String(error?.message ?? error) }; }
    try { result.presence = await presence.tick('background'); } catch (error) { result.presence = { error: String(error?.message ?? error) }; }
    return result;
  }

  function scopeStatus(scope, persona = '') {
    const c = config();
    return {
      ok: true,
      enabled: c.enabled !== false,
      dryRun: c.dryRun !== false,
      config: c,
      scope: scope || null,
      modules: {
        growth: { ...growth.status(scope || ''), config: c.growth, injection: scope ? growth.preview(scope) : null },
        groupCulture: { ...culture.status(scope || '', persona), config: c.groupCulture },
        activity: { ...activity.status(), recent: scope ? recentActivity(scope, 3) : [] },
        presence: presence.status(),
        speech: { enabled: c.speech?.enabled !== false, config: c.speech, note: scope ? noteFor(scope) : '' },
        recreation: recreation.status(scope || ''),
        transfer: transfer.status(),
        voice: voice.status()
      },
      actions: recentActions(db, 40)
    };
  }

  function setConfigPath(p, value) {
    const key = String(p || '').trim();
    if (!key || !CONFIG_WHITELIST_PREFIXES.some((prefix) => key === prefix || key.startsWith(prefix))) {
      throw httpError(400, `不允许修改的配置项：${key}`);
    }
    const okType = typeof value === 'boolean' || typeof value === 'string'
      || (typeof value === 'number' && Number.isFinite(value))
      || (Array.isArray(value) && value.every((x) => typeof x === 'string'));
    if (!okType) throw httpError(400, '配置值必须是布尔/数字/字符串/字符串数组');
    writeOverride(db, key, value, now());
    overrideCache.at = 0;
    return { key, value };
  }

  async function handleRoute({ method, url, body, sendJson }) {
    try {
      if (url.pathname === '/api/capabilities' || url.pathname.startsWith('/api/capabilities/')) {
        if (method === 'GET') {
          const scope = url.searchParams.get('key') || '';
          const persona = url.searchParams.get('persona') || (deps.personaFor ? deps.personaFor(scope) : '');
          return sendJson(scopeStatus(scope, persona));
        }
        const action = String(body?.action || url.pathname.split('/').pop() || '');
        const scope = String(body?.key || '');
        const persona = body?.persona ? String(body.persona) : (deps.personaFor ? deps.personaFor(scope) : '');
        switch (action) {
          case 'set_config': return sendJson({ ok: true, ...setConfigPath(body.path, body.value) });
          case 'set_module': return sendJson({ ok: true, ...setConfigPath(`${body.module}.enabled`, body.enabled === true) });
          case 'growth_propose': return sendJson({ ok: true, item: growth.propose({ scope, kind: body.kind, content: body.content, sources: body.sources, origin: 'admin' }) });
          case 'growth_start_trial': return sendJson({ ok: true, item: growth.startTrial(body.id, 'admin') });
          case 'growth_activate': return sendJson({ ok: true, item: growth.activate(body.id, 'admin') });
          case 'growth_pause': return sendJson({ ok: true, item: growth.pause(body.id) });
          case 'growth_revoke': return sendJson({ ok: true, item: growth.revoke(body.id) });
          case 'growth_restore': return sendJson({ ok: true, item: growth.restore(body.id) });
          case 'growth_suggest': return sendJson({ ok: true, ...growth.suggest(scope) });
          case 'culture_refresh': return sendJson({ ok: true, ...culture.refresh(scope, persona, true) });
          case 'activity_run': return sendJson({ ok: true, ...(await activity.run({ actor: 'admin', force: true, topic: body.topic, kind: body.kind, scope })) });
          case 'activity_mark_publish': return sendJson({ ok: true, ...activity.markPublish(body.id, body.allow !== false) });
          case 'presence_probe': return sendJson({ ok: true, ...(await presence.probe()) });
          case 'presence_run': {
            const result = await presence.run(body.kind, { file: body.file, text: body.text, nickname: body.nickname, target: body.target, tid: body.tid, uin: body.uin, abstime: body.abstime, images: body.images, ugcRight: body.ugc_right, targetUins: body.target_uins }, { actor: 'admin', forceReal: body.real === true, dryRun: body.dryRun === true });
            return sendJson({ ok: !result.error, ...result });
          }
          case 'presence_restore_avatar': return sendJson({ ok: true, ...(await presence.restoreAvatar('admin')) });
          case 'transfer_list': return sendJson({ ok: true, items: transfer.list(scope, body.status) });
          case 'transfer_confirm': return sendJson({ ok: true, item: transfer.confirm(body.id, 'admin') });
          case 'transfer_reject': return sendJson({ ok: true, item: transfer.reject(body.id, 'admin') });
          case 'transfer_relay': {
            const result = await transfer.relay(body.id, body.target, async (target, text) => {
              if (typeof deps.sendText !== 'function') throw new Error('发送适配未接线');
              return deps.sendText(target, text);
            });
            return sendJson({ ok: !result.error, ...result });
          }
          case 'transfer_describe': return sendJson({ ok: true, ...(await transfer.describe({ kind: body.kind, raw: body.raw, url: body.url })) });
          case 'voice_test': {
            const result = await voice.synthesize(body.text || '你好呀', { provider: body.provider });
            // 本地试合成不发送：synthesize 的 file 可能是真实发送复用的共享缓存（cached:true），
            // 绝不能直接删除。这里复制一份本次独占的临时副本，只删副本，并据实核实清理结果。
            let cleanup = { ok: false, error: 'not_attempted' };
            if (result.ok && result.file && fs.existsSync(result.file)) {
              const dir = path.join(stateDir, 'voice-test');
              let copy = null;
              try {
                fs.mkdirSync(dir, { recursive: true });
                const ext = path.extname(result.file) || '.wav';
                copy = path.join(dir, `test-${now().toString(36)}-${crypto.randomBytes(3).toString('hex')}${ext}`);
                fs.copyFileSync(result.file, copy);
                cleanup = { ok: true, copyVerified: fs.existsSync(copy) };
              } catch (error) {
                cleanup = { ok: false, error: String(error?.message ?? error) };
              }
              if (cleanup.ok && copy) {
                try {
                  fs.unlinkSync(copy);
                  cleanup = { ok: !fs.existsSync(copy), copyVerified: false };
                } catch (error) {
                  cleanup = { ok: false, error: String(error?.message ?? error) };
                }
              }
            }
            return sendJson({
              ok: !!result.ok,
              ...result,
              cleaned: cleanup.ok === true,
              cleanupError: cleanup.ok ? null : cleanup.error,
              sharedCache: result.cached === true,
              sharedCacheKept: true
            });
          }
          default: return sendJson({ ok: false, error: `未知操作：${action}` }, 400);
        }
      }
      return false;
    } catch (error) {
      const status = Number(error?.statusCode) || 500;
      if (sendJson) sendJson({ ok: false, error: String(error?.message ?? error) }, status);
      return true;
    }
  }

  function init() {
    const c = config();
    const recovered = c.enabled === false ? 0 : activity.recoverStale();
    try { transfer.expire(); } catch { /* ignore */ }
    log(`[capabilities] 八类能力已加载（总开关 ${c.enabled === false ? '关' : '开'}，演练 ${c.dryRun !== false ? '开' : '关'}，恢复 ${recovered} 个中断任务）`);
    return { recovered, enabled: c.enabled !== false, dryRun: c.dryRun !== false };
  }

  return {
    init, config, enabled, observeIncoming, polishOutgoing: polishOutgoingText, bindTurn, clearTurn, injection, noteFor, recordDelivered,
    recentActivity, tick, handleRoute, scopeStatus, store, gate, sources, growth, culture, activity, presence,
    recreation, transfer, voice, close: store.close
  };
}

function httpError(status, message) {
  const error = new Error(message);
  error.statusCode = status;
  return error;
}

export { DEFAULT_CONFIG, deepMerge };

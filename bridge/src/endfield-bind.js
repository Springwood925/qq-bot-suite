// 终末地的「绑定 + 查询」业务层（隔离文件：bridge.js 只加 1 行 import + 1 个分支 + 1 行 ctx）
// 职责：群临时会话识别 · 扫码绑定流程 · 绑定表持久化 · 发送（临时会话/群）· 按 QQ 查数据出图
import fs from 'node:fs';
import path from 'node:path';
import {
  genQrCode, waitForScan, getProfile, dropProfileCache,
  fetchCardDetail, fetchIndieHard, fetchWarEchoes, fetchUserGameData, fetchGacha, withToken,
} from './endfield.js';
import { renderInfoCard, renderQrToPng, isRenderAvailable } from './endfield-render.js';

const BIND_TRIGGER = /绑定|终末地|森空岛|扫码/;
const QUERY_TRIGGER = /终末地|战绩|抽卡|信息卡|装备|我的数据/;

/** 绑定表：QQ号 → { token, roleId, serverId, nickname, channel }（独立文件，别塞进 social-v2.json） */
export class EndfieldStore {
  constructor(ROOT) {
    this.file = path.join(ROOT, 'state', 'endfield-bindings.json');
    this.data = { bindings: {} };
    this.load();
  }
  load() {
    try {
      if (fs.existsSync(this.file)) {
        const j = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (j && typeof j === 'object' && j.bindings) this.data = j;
      }
    } catch { this.data = { bindings: {} }; }
  }
  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 1));
    } catch { /* 保存失败不影响主流程 */ }
  }
  get(qq) { return this.data.bindings[String(qq)] ?? null; }
  set(qq, info) { this.data.bindings[String(qq)] = { ...info, boundAt: Date.now() }; this.save(); return this.data.bindings[String(qq)]; }
  remove(qq) { const had = Boolean(this.data.bindings[String(qq)]); delete this.data.bindings[String(qq)]; this.save(); return had; }
  list() { return Object.entries(this.data.bindings).map(([qq, v]) => ({ qq, ...v })); }
}

/**
 * 构造桥要注入的上下文：所有发送都走 SnowLuma 的 HTTP 接口（不走桥的 sendChain ——
 * 绑定是一次性低频交互，不影响群聊顺序；代价是这条消息不进 recentMessages，可接受）。
 */
export function createEndfieldCtx({ cfg, log, ROOT }) {
  const store = new EndfieldStore(ROOT);
  const httpUrl = String(cfg.snowluma?.httpUrl || 'http://127.0.0.1:3000').replace(/\/+$/, '');
  const auth = cfg.snowluma?.httpAccessToken || cfg.snowluma?.accessToken || '';
  const H = { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) };

  async function post(action, body, timeout = 90000) {
    try {
      const res = await fetch(`${httpUrl}/${action}`, { method: 'POST', headers: H, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
      const j = await res.json().catch(() => ({}));
      const ok = res.ok && j.status === 'ok' && (j.retcode ?? 0) === 0;
      return { ok, body: j, error: ok ? null : (j.wording || j.message || `HTTP ${res.status}`) };
    } catch (e) {
      return { ok: false, error: e?.message ?? String(e) };
    }
  }
  const imgSeg = (png) => ({ type: 'image', data: { file: 'base64://' + fs.readFileSync(png).toString('base64') } });
  const atSeg = (qq) => ({ type: 'at', data: { qq: String(qq) } });

  return {
    cfg, log, store,
    /** 群临时会话（OneBot：send_private_msg 带 group_id）*/
    sendTempText: (qq, groupId, text) => post('send_private_msg', { user_id: Number(qq), group_id: Number(groupId), message: [{ type: 'text', data: { text } }] }),
    sendTempImage: (qq, groupId, png) => post('send_private_msg', { user_id: Number(qq), group_id: Number(groupId), message: [imgSeg(png)] }, 120000),
    sendGroupText: (groupId, text, atQq) => post('send_group_msg', { group_id: Number(groupId), message: [...(atQq ? [atSeg(atQq)] : []), { type: 'text', data: { text } }] }),
    sendGroupImage: (groupId, png, atQq) => post('send_group_msg', { group_id: Number(groupId), message: [...(atQq ? [atSeg(atQq)] : []), imgSeg(png)] }, 180000),
    sendPrivateText: (qq, text) => post('send_private_msg', { user_id: Number(qq), message: [{ type: 'text', data: { text } }] }),
    sendPrivateImage: (qq, png) => post('send_private_msg', { user_id: Number(qq), message: [imgSeg(png)] }, 180000),
    /** 撤回自己发的消息（QQ 侧约 2 分钟窗口）—— 用来把群里那张二维码擦掉 */
    recallMessage: (messageId) => post('delete_msg', { message_id: Number(messageId) }, 30000),
  };
}

/** 是否是一条"群临时会话"消息（OneBot：message_type=private + sub_type=group，带 group_id） */
export function isGroupTempSession(event) {
  return event?.message_type === 'private' && (event?.sub_type === 'group' || (event?.group_id && String(event.group_id) !== '0'));
}

export function plainText(event) {
  const segs = event?.message;
  if (Array.isArray(segs)) return segs.map((s) => (s.type === 'text' ? String(s.data?.text ?? '') : '')).join('').trim();
  return String(event?.raw_message ?? event?.message ?? '').trim();
}

/**
 * 处理绑定请求（群临时会话 + 私聊两条入口）。
 * · 群临时会话：只认绑定类指令，不匹配也返回 true（临时会话本来聊不起来）
 * · 私聊：只认「绑定终末地」这种明确指令，不匹配就返回 false 放行走正常聊天
 */
export async function handleTempSessionMessage(event, ctx) {
  const { cfg, log, store } = ctx;
  if (cfg.endfield?.enabled === false) return false;
  if (event?.message_type !== 'private') return false;
  const isTemp = isGroupTempSession(event);
  const qq = String(event.user_id);
  const groupId = isTemp ? String(event.group_id ?? '') : '';
  const text = plainText(event);
  if (isTemp) {
    const allowGroups = (cfg.allow?.groups ?? []).map(String);
    if (groupId && allowGroups.length && !allowGroups.includes(groupId)) {
      log(`终末地：忽略非白名单群的临时会话（群 ${groupId}）`);
      return false;
    }
  }
  // 形式一：群友直接贴森空岛令牌（"绑定 <token>"）—— 这条路**不需要机器人回私聊**，
  // 所以能绕开"QQ 不给发临时会话"的限制（2026-10-04 实测 verify identify fail 之后加的兜底）
  const tokenMatch = text.match(/(?:绑定|token|令牌)\s*[:：]?\s*([A-Za-z0-9_\-]{20,})/i);
  if (tokenMatch && !store.get(qq)) {
    runTokenBind(qq, groupId, tokenMatch[1], ctx).catch((e) => log('终末地令牌绑定出错:', e?.message ?? e));
    return true;
  }
  const trigger = isTemp ? BIND_TRIGGER : /绑定\s*终末地|终末地\s*绑定/;
  if (!trigger.test(text)) {
    if (!isTemp) return false; // 私聊不匹配 → 放行走正常聊天
    // 临时会话不匹配：没绑过的提示一次；**已绑过的静默吞掉**（用户要求：绑定完就不再理这个陌生人）
    if (!store.get(qq)) ctx.sendTempText(qq, groupId, '想绑定终末地的话，直接发「绑定终末地」就行～').catch(() => {});
    return true;
  }
  if (store.get(qq)) {
    const reply = '你已经绑定过啦。想换号就先发「解绑终末地」。';
    if (isTemp) ctx.sendTempText(qq, groupId, reply).catch(() => {});
    else ctx.sendPrivateText(qq, reply).catch(() => {});
    return true;
  }
  runBindFlow(qq, groupId, ctx).catch((e) => log('终末地绑定流程出错:', e?.message ?? e));
  return true;
}

async function runBindFlow(qq, groupId, ctx) {
  const { log, store } = ctx;
  if (!isRenderAvailable()) {
    await ctx.sendTempText(qq, groupId, '出图组件不可用（本机没找到 Edge/Chrome），先没法绑定。').catch(() => {});
    return;
  }
  const qr = await genQrCode();
  log(`终末地：为 ${qq} 生成二维码（scanId ${String(qr.scanId).slice(0, 8)}…）`);
  const png = await renderQrToPng(qr.scanUrl);
  // ⚠️ 2026-10-04 实测：**群临时会话能发文字、发不了图片**（发图报 `verify identify fail`）。
  //    用户最终拍板「**就在群里发二维码**」⇒ 私聊发不出去就降级到群里 @ 他发，并继续等扫码。
  const sent = groupId ? await ctx.sendTempImage(qq, groupId, png) : await ctx.sendPrivateImage(qq, png);
  let qrMsgId = null; // 群里那条二维码的 message_id —— 绑定流程结束时要撤回（用户要求：码不留群里）
  if (!sent.ok) {
    log(`终末地：私聊图片发不出去（${sent.error}）→ 改在群里 @ 他发码`);
    if (!groupId) return; // 连好友私聊都发不出去，没辙
    await ctx.sendGroupText(groupId, '私聊发不了图片，二维码我放群里了 —— **只有你能扫，别让别人扫走**（扫完我就把这条撤了）', qq).catch(() => {});
    const imgRes = await ctx.sendGroupImage(groupId, png, qq);
    qrMsgId = imgRes?.body?.data?.message_id ?? null;
  } else if (groupId) {
    await ctx.sendTempText(qq, groupId, '用森空岛 App 扫上面的码（2 分钟内有效），扫完我会在群里 @ 你').catch(() => {});
  } else {
    await ctx.sendPrivateText(qq, '用森空岛 App 扫上面的码（2 分钟内有效），扫完我在这里告诉你').catch(() => {});
  }
  // 不管码发在哪，都继续等扫码；**结束时无论成败都把群里那张码撤掉**（用户要求：码不留群里）
  try {
    const token = await waitForScan(qr.scanId, { onTick: (st) => { if (st.status === 101) log(`终末地：${qq} 已扫码待确认`); } });
    const p = await getProfile(token, { force: true });
    let level = '?';
    try { const d = await fetchCardDetail(p); level = d?.base?.level ?? '?'; } catch { /* 拿不到等级不影响绑定 */ }
    dropProfileCache(token);
    store.set(qq, { token, roleId: p.roleId, serverId: p.serverId, nickname: p.nickname, channel: p.channel, level });
    log(`✅ 终末地：${qq} 绑定成功（${p.nickname} Lv.${level}）`);
    const done = `✅ 绑定成功 → 【${p.nickname}】${p.channel || ''} Lv.${level}\n以后在群里直接 @ 我说「看看我的终末地」就行`;
    if (groupId) await ctx.sendGroupText(groupId, done, qq).catch(() => {});
    else await ctx.sendPrivateText(qq, done).catch(() => {});
  } catch (e) {
    log(`终末地：${qq} 绑定未完成 — ${e?.message ?? e}`);
    const tip = '二维码过期或没扫上，想绑的话再发一次「绑定终末地」。';
    if (groupId) await ctx.sendGroupText(groupId, tip, qq).catch(() => {});
    else await ctx.sendPrivateText(qq, tip).catch(() => {});
  } finally {
    if (qrMsgId) {
      const r = await ctx.recallMessage(qrMsgId).catch(() => ({ ok: false }));
      log(r?.ok
        ? `终末地：已撤回群里的二维码（msg ${qrMsgId}）`
        : `终末地：撤回二维码失败（msg ${qrMsgId}）${r?.error ? ' — ' + r.error : ''}`);
    }
  }
}

/** 解绑 */
export async function handleUnbind(qq, ctx) {
  const had = ctx.store.remove(qq);
  return had;
}

/**
 * 令牌绑定：群友自己从森空岛网页取 token 私聊发来。
 * 好处：**全程不需要机器人给陌生人发私信**，绕开了 QQ 的临时会话限制。
 * ⚠️ token 是账号凭证，日志里只打长度、绝不打内容。
 */
async function runTokenBind(qq, groupId, token, ctx) {
  const { log, store } = ctx;
  log(`终末地：${qq} 提交令牌（长度 ${String(token).length}），开始验证`);
  try {
    const p = await getProfile(token, { force: true });
    let level = '?';
    try { const d = await fetchCardDetail(p); level = d?.base?.level ?? '?'; } catch { /* 拿不到等级不影响绑定 */ }
    store.set(qq, { token, roleId: p.roleId, serverId: p.serverId, nickname: p.nickname, channel: p.channel, level });
    log(`✅ 终末地：${qq} 令牌绑定成功（${p.nickname} Lv.${level}）`);
    const done = `✅ 绑定成功 → 【${p.nickname}】${p.channel || ''} Lv.${level}\n以后在群里直接 @ 我说「看看我的终末地」就行`;
    if (groupId) await ctx.sendGroupText(groupId, done, qq).catch(() => {});
    else await ctx.sendPrivateText(qq, done).catch(() => {});
  } catch (e) {
    log(`终末地：${qq} 令牌无效 — ${e?.message ?? e}`);
    const tip = '这串令牌好像不对（可能复制少了、或者已经过期）。重新登录 skland.com 再取一次，把 content 整段发我（格式：绑定 那串）。';
    if (groupId) await ctx.sendGroupText(groupId, tip, qq).catch(() => {});
    else await ctx.sendPrivateText(qq, tip).catch(() => {});
  }
}

/** 查某个 QQ 的终末地数据并出图（群友 @ 时默认先发账号信息卡）*/
export async function queryAndRender(qq, { ctx, kind = 'info', send }) {
  const bind = ctx.store.get(qq);
  if (!bind) return { ok: false, error: 'not-bound' };
  const p = await getProfile(bind.token);
  const token = bind.token;
  if (kind === 'info') {
    const detail = await fetchCardDetail(p);
    const png = await renderInfoCard(detail, { name: `info-${qq}` });
    await send(png);
    return { ok: true, kind: 'info', png, name: detail.base?.name };
  }
  if (kind === 'gacha') {
    const existing = null; // 缓存由调用方决定
    const pools = await fetchGacha(withToken(p, token), { existing });
    return { ok: true, kind: 'gacha', pools };
  }
  if (kind === 'battle') {
    const [ih, we] = await Promise.all([fetchIndieHard(p), fetchWarEchoes(p)]);
    return { ok: true, kind: 'battle', indieHard: ih, warEchoes: we };
  }
  if (kind === 'gear') {
    const [detail, ug] = await Promise.all([fetchCardDetail(p), fetchUserGameData(p)]);
    return { ok: true, kind: 'gear', detail, userGame: ug };
  }
  return { ok: false, error: 'unknown-kind' };
}

/** 这条群消息是否 @ 了机器人本身 */
export function isAtBot(event) {
  const self = String(event?.self_id ?? '');
  const segs = event?.message;
  if (Array.isArray(segs)) return segs.some((s) => s.type === 'at' && String(s.data?.qq ?? '') === self);
  return /\[CQ:at,qq=\d+\]/.test(String(event?.raw_message ?? ''));
}

/**
 * 群里 @ 机器人要终末地数据。
 * 设计（用户 2026-10-04 纠正后定稿）：
 *   · 没绑定 → 桥直接提示（并消费掉这条，不叫模型，省 token）
 *   · 有绑定 → **不消费**（返回 false），交给模型接管：模型按群友接下来的需求调
 *     qq_endfield_query 出信息卡/抽卡/战绩/装备 —— 不是"指令 bot"，群友不必反复 @
 */
export async function handleGroupQuery(event, ctx) {
  const { cfg, log, store } = ctx;
  if (cfg.endfield?.enabled === false) return false;
  if (event?.message_type !== 'group') return false;
  const groupId = String(event.group_id ?? '');
  const allowGroups = (cfg.allow?.groups ?? []).map(String);
  if (allowGroups.length && !allowGroups.includes(groupId)) return false;
  if (!isAtBot(event)) return false;
  const text = plainText(event);
  if (!QUERY_TRIGGER.test(text)) return false;

  const qq = String(event.user_id);
  // 记住"这个会话最后一次问数据的人"，供 qq_endfield_query 用（模型不知道 QQ 号）
  lastSpeaker.set(`group:${groupId}`, { qq, at: Date.now() });
  const bind = store.get(qq);
  if (bind) {
    log(`终末地：${qq} 在群 ${groupId} 要数据 → 交给模型按需出图`);
    return false; // ★ 有绑定：让模型接管，后续不用再 @
  }
  // 未绑定：群里直接说「绑定终末地」就开绑（二维码发群里 —— 用户 2026-10-04 拍板）
  if (BIND_TRIGGER.test(text)) {
    log(`终末地：${qq} 在群 ${groupId} 发起绑定`);
    runBindFlow(qq, groupId, ctx).catch((e) => log('终末地绑定流程出错:', e?.message ?? e));
    return true;
  }
  log(`终末地：${qq} 在群 ${groupId} 要数据但没绑定`);
  await ctx.sendGroupText(groupId, '你还没绑定终末地哦 —— 发一句「绑定终末地」，我把二维码发在这里，你用森空岛 App 扫一下就行（码只有你能扫，别让别人扫走）', qq).catch(() => {});
  return true;
}

const lastSpeaker = new Map(); // key → { qq, at }

export function getLastSpeaker(key) { return lastSpeaker.get(key) ?? null; }
export function setLastSpeaker(key, qq) { lastSpeaker.set(key, { qq: String(qq), at: Date.now() }); }

/**
 * 供端点和 MCP 工具调用：给「这个会话里最后问数据的那个人」出图。
 * kind: info（账号信息卡）/ gacha（抽卡分析）/ battle（战绩）/ gear（角色装备）
 */
export async function queryForSession(key, kind, ctx) {
  const [chatKind, chatId] = String(key).split(':');
  // 查「谁的」数据：优先这个会话里最后一次 @ 机器人问数据的人；
  // 私聊（private:<qq>）没有 @ 这回事，就直接查会话本人 —— 否则私聊里查数据永远 no-speaker
  let sp = getLastSpeaker(key);
  if (!sp && chatKind === 'private' && /^\d+$/.test(String(chatId))) {
    sp = { qq: String(chatId), at: Date.now(), derived: true };
  }
  if (!sp) return { ok: false, error: 'no-speaker', message: '这个会话里还没人问过数据' };
  const bind = ctx.store.get(sp.qq);
  if (!bind) return { ok: false, error: 'not-bound', qq: sp.qq, message: '对方还没绑定终末地' };
  const p = await getProfile(bind.token);
  const sendPng = async (png) => {
    if (chatKind === 'group') return await ctx.sendGroupImage(chatId, png, sp.qq);
    return await ctx.sendPrivateImage(chatId, png);
  };
  const { renderInfoCard, renderGachaCard, renderBattleCards, renderGearCard, renderCharsCard } = await import('./endfield-render.js');

  if (kind === 'info') {
    const detail = await fetchCardDetail(p);
    const png = await renderInfoCard(detail, { name: `info-${sp.qq}` });
    await sendPng(png);
    return { ok: true, kind, name: detail.base?.name, png };
  }
  if (kind === 'gacha') {
    const pools = await fetchGacha(withToken(p, bind.token), { existing: bind.gachaCache ?? null });
    const png = await renderGachaCard({ detail: await fetchCardDetail(p), pools });
    await sendPng(png);
    return { ok: true, kind, png };
  }
  if (kind === 'battle') {
    const [detail, ih, we] = await Promise.all([fetchCardDetail(p), fetchIndieHard(p), fetchWarEchoes(p)]);
    const pngs = await renderBattleCards({ detail, indieHard: ih, warEchoes: we, tag: String(sp.qq) });
    for (const png of pngs) await sendPng(png);
    return { ok: true, kind, count: pngs.length, pngs };
  }
  if (kind === 'gear' || kind === 'chars') {
    const detail = await fetchCardDetail(p);
    const png = kind === 'gear' ? await renderGearCard(detail) : await renderCharsCard(detail);
    await sendPng(png);
    return { ok: true, kind, png };
  }
  return { ok: false, error: 'unknown-kind', message: '不认识的类型，可选：info / gacha / battle / gear / chars' };
}

export { BIND_TRIGGER, QUERY_TRIGGER, isRenderAvailable };

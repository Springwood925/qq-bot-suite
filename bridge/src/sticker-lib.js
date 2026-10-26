// 表情包体系（二代仿真模式）——本地表情知识库与策略提示纯函数。
//
// 职责：
// - state/stickers.json 的读写与字段归一化
// - 把 SnowLuma `fetch_custom_face_detail` 返回的 QQ 收藏表情合并进本地库
// - 支持按 emoji_id / md5 / url 查找、按备注/本地笔记/标签搜索
// - 生成注入 AI 的“表情包策略/可用表情”摘要
//
// 设计原则：
// - QQ 账号的收藏表情是“源”，本地库是“AI 认知层”：保留 AI 学习到的含义/标签/使用次数，
//   不覆盖 QQ 的备注；QQ desc 为空时 AI 可以看图后用 qq_sticker_note 记录自己的理解。
// - 所有文本只做展示/提示，不执行任何本地操作。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function nowIso() {
  return new Date().toISOString();
}

export function normalizeStickerEntry(raw) {
  const entry = raw && typeof raw === 'object' ? raw : {};
  const id = String(entry.id || entry.emoji_id || entry.resId || '').trim();
  if (!id) return null;
  const tags = Array.isArray(entry.tags)
    ? entry.tags.map((t) => String(t ?? '').trim()).filter(Boolean).slice(0, 20)
    : [];
  return {
    id,
    resId: String(entry.resId || entry.emoji_id || id).trim(),
    url: String(entry.url || '').trim(),
    md5: String(entry.md5 || '').trim().toUpperCase(),
    desc: String(entry.desc ?? '').trim(),
    localNote: String(entry.localNote ?? '').trim(),
    tags,
    usage: String(entry.usage ?? '').trim(),
    source: entry.source === 'manual' ? 'manual' : (entry.source === 'ai' ? 'ai' : 'qq'),
    useCount: Math.max(0, Number(entry.useCount) || 0),
    lastUsedAt: Number(entry.lastUsedAt) || 0,
    lastContext: String(entry.lastContext ?? '').slice(0, 200),
    createdAt: String(entry.createdAt || nowIso()),
    updatedAt: String(entry.updatedAt || nowIso())
  };
}

export function loadStickerStore(file) {
  try {
    let text = fs.readFileSync(file, 'utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeStickerEntry).filter(Boolean);
  } catch {
    return [];
  }
}

export function saveStickerStore(file, entries) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
}

// 把 SnowLuma 返回的 QQ 收藏表情详情合并进本地库。
// 保留本地 AI 认知字段（localNote/tags/usage/useCount/lastUsedAt/lastContext），
// 只更新 QQ 侧字段（id/resId/url/md5/desc）。
export function mergeStickerLibrary(existing, fetched) {
  const out = existing.map(normalizeStickerEntry).filter(Boolean);
  const byId = new Map(out.map((e) => [e.id, e]));
  const fetchedIds = new Set();
  for (const item of Array.isArray(fetched) ? fetched : []) {
    const id = String(item?.emoji_id || item?.resId || item?.id || '').trim();
    if (id) fetchedIds.add(id);
  }
  for (const item of Array.isArray(fetched) ? fetched : []) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.emoji_id || item.resId || item.id || '').trim();
    if (!id) continue;
    const old = byId.get(id);
    const merged = normalizeStickerEntry({
      ...(old || {}),
      id,
      resId: String(item.resId || item.emoji_id || id).trim(),
      url: String(item.url || old?.url || '').trim(),
      md5: String(item.md5 || old?.md5 || '').trim().toUpperCase(),
      desc: String(item.desc ?? old?.desc ?? '').trim(),
      localNote: old?.localNote || '',
      tags: old?.tags || [],
      usage: old?.usage || '',
      source: old?.source || 'qq',
      useCount: old?.useCount || 0,
      lastUsedAt: old?.lastUsedAt || 0,
      lastContext: old?.lastContext || '',
      createdAt: old?.createdAt || nowIso(),
      updatedAt: nowIso()
    });
    if (!merged) continue;
    if (!byId.has(id)) {
      out.push(merged);
      byId.set(id, merged);
    } else {
      const idx = out.findIndex((e) => e.id === id);
      if (idx >= 0) out[idx] = merged;
    }
  }
  // 清理已被 QQ 端删除的收藏表情（保留手动/本地新增的非 qq 来源条目）。
  return out.filter((e) => e.source !== 'qq' || fetchedIds.has(e.id));
}

// 通过 emoji_id / md5 / url（支持模糊：去掉大小写、尾斜杠、URL 查询）查找。
export function findSticker(entries, ref) {
  const raw = String(ref ?? '').trim();
  if (!raw) return null;
  const id = raw;
  const md5 = raw.toUpperCase();
  const md5Lower = raw.toLowerCase();
  const urlNormalized = raw.replace(/\/+$/, '').replace(/^https?:\/\//i, '');
  // 短 id：唤醒提示里给 AI 看的是 md5 末 8 位（完整 id 太长），发送时要把短 id 还原。
  // 长度 >= 6 才当短 id 处理 —— 太短会撞车（例如 "0_0"）。
  const asShortMd5 = md5Lower.length >= 6 && /^[0-9a-f]+$/.test(md5Lower);
  return (Array.isArray(entries) ? entries : []).find((e) => {
    if (!e) return false;
    if (e.id === id || e.resId === id) return true;
    if (e.md5 && e.md5 === md5) return true;
    if (asShortMd5 && e.md5 && String(e.md5).toUpperCase().endsWith(md5)) return true;
    const eUrl = String(e.url || '').replace(/\/+$/, '').replace(/^https?:\/\//i, '');
    if (eUrl && urlNormalized && (eUrl === urlNormalized || eUrl.includes(urlNormalized) || urlNormalized.includes(eUrl))) return true;
    return false;
  }) || null;
}

// 给 AI 看的短 id：md5 末 8 位。完整 id 是 `机器人QQ_0_0_0_<32位hex>_0_0`，
// 32 位 hex 对模型是纯噪音（占字符、还容易抄错），末 8 位足够唯一。
export function shortStickerId(entry) {
  const md5 = String(entry?.md5 || '').toUpperCase();
  if (md5.length >= 8) return md5.slice(-8);
  const id = String(entry?.id || '');
  const m = /([0-9A-Fa-f]{8,})/.exec(id);
  return m ? m[1].toUpperCase().slice(-8) : id.slice(-8);
}

// 店主明确标记为禁用的表情（localNote 以【禁用】开头）。
//
// 为什么用备注前缀、而不是加一个 blocked 字段：normalizeStickerEntry 是**白名单**字段
// （见 L29-44），任何自定义字段在下一次从 QQ 同步时都会被丢掉；而 localNote 会被
// mergeStickerLibrary 保留（L89 `localNote: old?.localNote || ''`），所以只有它能长期存活。
export const STICKER_BLOCK_TAG = '【禁用】';
export function isStickerBlocked(entry) {
  return String(entry?.localNote || '').trim().startsWith(STICKER_BLOCK_TAG);
}

// 格式化给 AI 看的表情列表；query 会匹配 desc/localNote/tags/usage/id/md5。
export function formatStickerList(entries, query = '', limit = 48) {
  const list = (Array.isArray(entries) ? entries : []).map(normalizeStickerEntry).filter(Boolean);
  const q = String(query ?? '').trim().toLowerCase();
  const filtered = q
    ? list.filter((e) => {
        const haystack = [e.desc, e.localNote, e.usage, e.id, e.resId, e.md5, ...(e.tags || [])].join(' ').toLowerCase();
        return haystack.includes(q);
      })
    : list;
  const max = Math.max(1, Math.min(500, Number(limit) || 100));
  // 2026-10-02 加排序治「偏食」：原来直接 slice 原始顺序（= QQ 返回顺序，老图在前），
  // 模型天然挑列表靠前的 ⇒ 54 张里只用过 18 张、前 3 名占 61% 的使用量。
  // 现在：① 【禁用】的一律排最后；② 用得少的排前面（轮换，避免马太效应）；
  //       ③ 都没用过时新加的排前面（用户刚传的能先被看到）。
  const stamp = (e) => {
    const v = e && e.createdAt;
    const n = typeof v === 'number' ? v : Date.parse(String(v ?? ''));
    return Number.isFinite(n) ? n : 0;
  };
  const ranked = [...filtered].sort((a, b) => {
    const ab = isStickerBlocked(a) ? 1 : 0;
    const bb = isStickerBlocked(b) ? 1 : 0;
    if (ab !== bb) return ab - bb;
    const au = Number(a.useCount) || 0;
    const bu = Number(b.useCount) || 0;
    if (au !== bu) return au - bu;
    return stamp(b) - stamp(a);
  });
  const items = ranked.slice(0, max).map((e) => ({
    id: e.id,
    resId: e.resId,
    md5: e.md5,
    url: e.url,
    desc: e.desc || '',
    localNote: e.localNote || '',
    tags: e.tags || [],
    usage: e.usage || '',
    useCount: e.useCount || 0,
    lastUsedAt: e.lastUsedAt || 0,
    blocked: isStickerBlocked(e),
    source: e.source || 'qq'
  }));
  return {
    total: list.length,
    matched: filtered.length,
    truncated: filtered.length > max,
    stickers: items
  };
}

// 生成注入 AI 的“可用表情包”摘要（不暴露完整 URL，避免上下文爆炸）。
export function buildStickerContext(entries, max = 8) {
  const all = (Array.isArray(entries) ? entries : []).map(normalizeStickerEntry).filter(Boolean);
  if (!all.length) return '';
  // 被店主标记【禁用】的表情不进候选清单（发送侧还有一层硬拦截，见 bridge.js sendStickerV2）。
  const list = all.filter((e) => !isStickerBlocked(e));
  if (!list.length) return '';
  const blockedCount = all.length - list.length;
  // 2026-10-02 改（用户要求提高发表情频率）。原来是 useCount 降序取前 N ⇒ 每轮注入的都是**同样那几张
  // 热门图**，模型容易觉得"没有对得上语境的"干脆不发。
  // 现在拆成两半，兼顾"新鲜"和"贴题"：约 6 成位子给从没用过的冷门图（每轮随机，轮换着挖），
  // 其余给"用过至少 1 次"的图（这些是验证过能对上语境的，留几张托底，免得真需要时反而找不到）。
  // ⚠️ 注意：`formatStickerList`（按需查询那条路）是另一个函数，上次单独改过；这里才是每轮注入那条路。
  const cap = Math.max(1, Math.min(30, Number(max) || 8));
  const useOf = (e) => Number(e.useCount) || 0;
  const shuffled = (arr) => arr.map((x) => ({ x, r: Math.random() })).sort((a, b) => a.r - b.r).map((o) => o.x);
  const coldPool = list.filter((e) => useOf(e) === 0);
  const warmPool = list.filter((e) => useOf(e) > 0);
  const coldSlots = Math.min(coldPool.length, Math.max(1, Math.round(cap * 0.6)));
  const chosen = shuffled(coldPool).slice(0, coldSlots);
  const chosenIds = new Set(chosen.map((e) => e.id));
  for (const e of shuffled(warmPool)) { if (chosen.length >= cap) break; chosen.push(e); chosenIds.add(e.id); }
  for (const e of shuffled(coldPool)) { if (chosen.length >= cap) break; if (!chosenIds.has(e.id)) { chosen.push(e); chosenIds.add(e.id); } }
  const top = shuffled(chosen);
  const lines = top.map((e) => {
    const label = e.desc || e.localNote || '（无备注，可先看图）';
    const extra = e.tags?.length ? ` [${e.tags.join('/')}]` : '';
    const used = e.useCount ? `（用过${e.useCount}次）` : '';
    // 2026-09-20 加：把短 id 直接列出来。
    // 起因：清单原来只有描述、没有 id，于是"想发表情"必须先调一次 qq_list_stickers
    // 才知道 id —— 一次调用返回 40 条完整对象（含 url/md5/tags/usage）约 3~4K tokens，
    // 实测一天 16 次 ≈ 6 万 tokens；而且模型偶尔会图省事把**备注文字**当 id 传进去，
    // 报「找不到表情 鲸鱼娘女仆双手比耶…」。给了 id 之后这两件事一起解决。
    return `- [${shortStickerId(e)}] ${label}${extra}${used}`;
  });
  return `【可用表情包】你的 QQ 收藏表情里有 ${list.length} 个可用表情${blockedCount ? `（另有 ${blockedCount} 个被店主禁用，任何场合都绝对不要发）` : ''}。方括号里就是发送用的 stickerId，**直接用它调用 qq_send_sticker 即可，不要再调 qq_list_stickers 去查**（想找更多/按关键词搜时才需要查）：\n${lines.join('\n')}`;
}

// 二代仿真模式下的“真人发表情包”策略提示。
// 这是软策略：AI 仍自主判断是否使用，桥接不强制。
export function buildStickerStrategyHint() {
  return [
    '【表情包策略：像真人一样用，不刷屏】',
    '- 合适时机：被戳中笑点/槽点、接梗、怼人、赞同、自嘲、安慰、无语、赢了/输了、告别/晚安、别人发了表情时回一张，都可以自然用。',
    '- 频率：普通闲聊经常自然用表情，留意桥接按文字条数给出的提醒，不要长期只发文字。生气、无语、低落也可以用对应的图；严肃或敏感话题不硬塞，没有贴切的可跳过。不要连续刷屏。',
    '- 选择：优先用备注（desc）和你的记忆（localNote/tags）能准确对上语境的；没有备注/不确定的表情，先 qq_get_sticker_image 看图再决定，不要瞎发。',
    '- 发送：用 qq_send_sticker；一条消息只能是一张表情，不能在同一气泡里附带文字；想说的话先用 qq_send_message / qq_reply 作为单独气泡发出，再单独发表情。需要引用/点名时传 replyToMessageId / atUserId（群聊）。',
    '- 不要：在严肃/正式/敏感话题硬塞表情；不要每次都用同一个；不要一条消息里塞多个表情；不要把文字和表情混在同一个气泡里；不要把表情包当回复的唯一内容（偶尔可以，但别让群友觉得你在敷衍）。',
    '- 禁用：备注以【禁用】开头的表情，任何场合都绝对不要发（发送会被桥接直接拒绝，qq_list_stickers 里会标 blocked: true），也不要问别人"要不要发这张"。',
    '- 学习：看到新表情不确定含义时，先用 qq_get_sticker_image 看图，再用 qq_sticker_note 记下你的理解，下次就能更准地选。'
  ].join('\n');
}

// 把 AI 本地认知（note/tags/usage）更新到一条表情记录上，并返回新数组。
export function applyStickerNote(entries, id, patch = {}) {
  const list = (Array.isArray(entries) ? entries : []).map(normalizeStickerEntry).filter(Boolean);
  const target = findSticker(list, id);
  if (!target) return { entries: list, entry: null };
  const idx = list.findIndex((e) => e.id === target.id);
  const next = normalizeStickerEntry({
    ...target,
    localNote: patch.note !== undefined ? String(patch.note ?? '').trim() : target.localNote,
    tags: Array.isArray(patch.tags) ? patch.tags.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 20) : target.tags,
    usage: patch.usage !== undefined ? String(patch.usage ?? '').trim() : target.usage,
    source: patch.source || target.source || 'ai',
    updatedAt: nowIso()
  });
  if (!next) return { entries: list, entry: null };
  list[idx] = next;
  return { entries: list, entry: next };
}

// 记录一次“使用”，返回新数组。
export function markStickerUsed(entries, id, context = '') {
  const list = (Array.isArray(entries) ? entries : []).map(normalizeStickerEntry).filter(Boolean);
  const target = findSticker(list, id);
  if (!target) return { entries: list, entry: null };
  const idx = list.findIndex((e) => e.id === target.id);
  const next = normalizeStickerEntry({
    ...target,
    useCount: (target.useCount || 0) + 1,
    lastUsedAt: Date.now(),
    lastContext: String(context || '').slice(0, 200),
    updatedAt: nowIso()
  });
  if (!next) return { entries: list, entry: null };
  list[idx] = next;
  return { entries: list, entry: next };
}

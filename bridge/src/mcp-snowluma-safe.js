// 安全版 QQ MCP server（stdio）。由 DSH 的 MCP 客户端 spawn。
//
// 安全设计：
// - 只暴露聊天所需的**安全动作子集**（查状态/查群/查消息/发消息），
//   不暴露任何管理类动作（禁言、踢人、改群设置、文件上传下载等）。
// - 发送类工具强制校验白名单：目标群/私聊必须命中 config.json 的
//   allow.groups / allow.private，否则拒绝 —— agent 只能往被允许的地方发消息。
// - 所有调用走 OneBot HTTP API（httpUrl + accessToken）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { SENSITIVE_RE } from './sensitive.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function loadConfig() {
  try {
    let text = fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    return JSON.parse(text);
  } catch {
    return {};
  }
}

const cfg = loadConfig();

function getConfig() {
  return loadConfig();
}

function getAccess() {
  const c = getConfig();
  return {
    allowGroups: (c.allow?.groups ?? []).map(String),
    allowPrivate: (c.allow?.private ?? []).map(String),
    denyGroups: (c.deny?.groups ?? []).map(String),
    denyPrivate: (c.deny?.private ?? []).map(String),
    allowAllWhenEmpty: c.allowAllWhenEmpty === true
  };
}

function getOneBotConfig() {
  const c = getConfig();
  return {
    httpUrl: (c.snowluma?.httpUrl ?? 'http://127.0.0.1:3000').replace(/\/+$/, ''),
    token: c.snowluma?.httpAccessToken || c.snowluma?.accessToken || ''
  };
}

// 与 bridge.allowed 保持一致：allow 列表为空时按 allowAllWhenEmpty 放行
function isAllowed(allowList, denyList, id, allowAllWhenEmpty) {
  const s = String(id);
  if (denyList.includes(s)) return false;
  if (allowList.length > 0) return allowList.includes(s);
  return allowAllWhenEmpty;
}

// 防止底层网关把文本中的 [CQ: 当作 CQ 码解析：替换为全角冒号。
function escapeCqText(text) {
  return String(text ?? '').replace(/\[CQ:/gi, '[CQ：');
}

// 兼容模型把单条消息序列化成 JSON 字符串的情况，例如 "\"你好\"" → "你好"。
function unquoteJsonString(value) {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  if (t.startsWith('"')) {
    try {
      const parsed = JSON.parse(t);
      if (typeof parsed === 'string') return parsed;
    } catch {}
  }
  return value;
}

// 构造可选的“引用/回复”消息段：
// - 传了 replyToMessageId 时，在文本前追加 reply 段，让 QQ 显示“引用了某条消息”；
// - 使用结构化消息段而不是 CQ 码，避免注入；
// - replyToMessageId 必须是非零整数（字符串数字也接受；QQ 消息 id 可能为负数）。
function messageSegments(message, replyToMessageId) {
  const segments = [];
  const replyId = replyToMessageId !== undefined && replyToMessageId !== null && String(replyToMessageId).trim() !== ''
    ? String(replyToMessageId).trim()
    : null;
  if (replyId !== null) {
    if (!/^-?[1-9]\d*$/.test(replyId)) {
      throw new Error('replyToMessageId 必须是非零整数（消息 id 可能为负数）');
    }
    segments.push({ type: 'reply', data: { id: replyId } });
  }
  segments.push({ type: 'text', data: { text: escapeCqText(String(message ?? '')) } });
  return segments;
}

async function onebot(action, params = {}) {
  const { httpUrl, token } = getOneBotConfig();
  const res = await fetch(`${httpUrl}/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(params),
    // 60 秒（2026-09-20 从 15 秒上调，与 agentApi 的默认值保持一致）。
    // 这些是"直连协议端"的读写调用，正常都很快；但群成员列表、消息历史这类在大群/首次
    // 查询时可能超过 15 秒，被掐断后 AI 拿到的是一句 aborted 报错，容易误判成"桥不稳定"。
    signal: AbortSignal.timeout(60000)
  });
  if (!res.ok) {
    const hint = res.status === 426 ? '；HTTP 426 通常表示 httpUrl 指向了 WebSocket 端口，请检查 config.json 的 snowluma.httpUrl 是否为 OneBot HTTP API 地址' : '';
    throw new Error(`HTTP ${res.status}${hint}`);
  }
  const body = await res.json();
  if (body.status !== 'ok' || body.retcode !== 0) {
    throw new Error(`OneBot ${action} 失败: retcode=${body.retcode} ${body.wording ?? ''}`);
  }
  return body.data;
}

// 桥接控制台/内部 Agent API 访问：二代仿真模式的状态工具都通过这里读写桥接内存态。
function agentApiBase() {
  const port = Number(getConfig().consolePort) || 3100;
  return `http://127.0.0.1:${port}`;
}
function readConsoleToken() {
  // 每次请求都重新读取，优先 config.json 里的 consoleToken，其次 state/console-token，
  // 避免 token 变化后 MCP 仍使用启动时缓存的旧值导致一直 401。
  try {
    const c = getConfig();
    if (c.consoleToken) return String(c.consoleToken);
  } catch {}
  try {
    const tokenFile = path.join(ROOT, 'state', 'console-token');
    return fs.readFileSync(tokenFile, 'utf8').trim();
  } catch {
    return '';
  }
}

async function agentApi(path, init = {}) {
  // 默认超时 60 秒（2026-09-20 从 15 秒上调）。
  //
  // 为什么上调：盘了一遍 41 个工具，**27 个没传 timeoutMs ⇒ 全部吃这个默认值**。
  // 其中几种真会超过 15 秒：
  //   · qq_send_group_message / qq_reply / qq_send_private_message —— 走协议端 highway 上传，
  //     和 qq_send_message / qq_send_burst 是同一条路（那两个显式给了 120 秒，这几个漏了）
  //   · qq_mark_read / qq_set_wake_config —— 有"沉睡前观察"闸门
  //   · qq_list_stickers —— 会触发一次收藏表情同步
  // 被掐断时 AI 看到的是 Node 的 `The operation was aborted due to timeout`，
  // 它会理解成"桥接接口不稳定"（实测：机器人在群里就这么说过），然后放弃发言。
  // 真正的长时间操作（wait / 语音转写 / 发媒体 / B站搜索）都自己传了超时，不受此默认值影响。
  const timeoutMs = init.timeoutMs || 60000;
  const { timeoutMs: _omit, ...rest } = init;
  const consoleToken = readConsoleToken();
  const headers = {
    'content-type': 'application/json',
    ...(consoleToken ? { 'x-console-token': consoleToken } : {}),
    ...(rest.headers ?? {})
  };
  const res = await fetch(`${agentApiBase()}${path}`, { ...rest, headers, signal: AbortSignal.timeout(timeoutMs) });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok) {
    throw new Error(body?.error || `桥接 API HTTP ${res.status}`);
  }
  return body;
}

async function authorizeRead(key, token) {
  await agentApi('/api/authorize/read', { method: 'POST', body: JSON.stringify({ key, token: token || undefined }) });
}

const server = new McpServer({ name: 'snowluma-safe', version: '0.1.0' });

// ── 工具裁剪（2026-09-17 加）────────────────────────────────────────────────
// 为什么：本文件所有工具的 description + inputSchema 加起来约 19,400 字符
// （≈12,000 token），而这段内容在**每一次** LLM 调用里都要重发一遍。
// 对一个群聊人格机器人来说，一半以上的工具根本用不上。
//
// 用法：config.json 里写 socialV2.disabledTools: ["qq_status", ...]，
// 或在 config 里设 socialV2.toolProfile = "minimal" 用内置的最小集。
// 不配置 = 行为完全不变。
const MINIMAL_TOOLS = new Set([
  'qq_send_message', 'qq_reply', 'qq_wait_for_messages', 'qq_set_wake_config',
  'qq_mark_read', 'qq_get_unread_messages', 'qq_get_recent_messages',
  'qq_get_message_images', 'qq_get_forward_msg', 'qq_get_prompt',
  'qq_send_sticker', 'qq_list_stickers', 'qq_collect_sticker', 'qq_sticker_note',
  'qq_get_sticker_image', 'qq_memory_append', 'qq_memory_query', 'qq_memory_remove',
  'qq_send_poke', 'qq_get_message_detail'
]);

function disabledToolNames() {
  const c = getConfig();
  const explicit = Array.isArray(c.socialV2?.disabledTools) ? c.socialV2.disabledTools.map(String) : null;
  if (explicit) return new Set(explicit);
  if (c.socialV2?.toolProfile === 'minimal') return MINIMAL_TOOLS;
  return null;
}

const DISABLED_TOOLS = disabledToolNames();
const _registerTool = server.tool.bind(server);
server.tool = (name, ...rest) => {
  if (DISABLED_TOOLS && !DISABLED_TOOLS.has(String(name))) return undefined;
  return _registerTool(name, ...rest);
};
if (DISABLED_TOOLS) {
  console.error(`[mcp-snowluma-safe] 工具裁剪生效：只注册 ${DISABLED_TOOLS.size} 个工具`);
}

server.tool(
  'qq_status',
  '查询 QQ 机器人登录状态与账号信息（只读）。',
  {},
  async () => {
    try {
      const login = await onebot('get_login_info');
      let status = {};
      try { status = await onebot('get_status'); } catch {}
      return { content: [{ type: 'text', text: JSON.stringify({ ...login, online: status.online, good: status.good }, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `查询失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_list_groups',
  '列出机器人所在的全部 QQ 群（只读）：群号、群名。',
  {},
  async () => {
    // 旧只读工具没有 agent token；reserved2 模式下通过桥接 /api/status 直接拒绝，
    // 避免绕过二代仿真模式的令牌隔离。
    try {
      const status = await agentApi('/api/status');
      if (status?.mode === 'reserved2') {
        return { content: [{ type: 'text', text: 'reserved2 模式下旧只读工具不可用，请使用带会话令牌的 v2 读工具' }], isError: true };
      }
    } catch (error) {
      return { content: [{ type: 'text', text: `无法确认当前模式，拒绝执行：${error?.message ?? error}` }], isError: true };
    }
    try {
      const a = getAccess();
      const data = await onebot('get_group_list');
      const list = (Array.isArray(data) ? data : (data?.data ?? []))
          .filter((g) => isAllowed(a.allowGroups, a.denyGroups, g.group_id, a.allowAllWhenEmpty))
          .map((g) => ({ group_id: g.group_id, group_name: g.group_name }));
      return { content: [{ type: 'text', text: JSON.stringify(list, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `查询失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_get_group_members',
  '列出指定群的成员列表（只读）：QQ 号、昵称、群名片。',
  { groupId: z.union([z.number(), z.string()]).describe('群号') },
  async ({ groupId }) => {
    const g = String(groupId);
    const a = getAccess();
    if (!isAllowed(a.allowGroups, a.denyGroups, g, a.allowAllWhenEmpty)) {
      return { content: [{ type: 'text', text: `拒绝：群 ${g} 不在只读白名单中。白名单：${a.allowGroups.join(', ') || '（空）'}` }], isError: true };
    }
    try { await authorizeRead(`group:${g}`); } catch (error) {
      return { content: [{ type: 'text', text: `拒绝读取：${error?.message ?? error}` }], isError: true };
    }
    try {
      const data = await onebot('get_group_member_list', { group_id: Number(g) });
      const list = (Array.isArray(data) ? data : (data?.data ?? [])).map((m) => ({ user_id: m.user_id, nickname: m.nickname, card: m.card }));
      return { content: [{ type: 'text', text: JSON.stringify(list, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `查询失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_get_group_history',
  '获取指定群的最近消息历史（只读）。一次最多 200 条。翻页用 messageId：传上一批里最早那条的 message_id 就能继续往前取'
  + '（⚠️ 实测 message_seq 不生效，SnowLuma 会忽略它，所以别再用它翻页）。要找某个词在哪说过，用 qq_search_history 更快。',
  {
    groupId: z.union([z.number(), z.string()]).describe('群号'),
    messageId: z.union([z.number(), z.string()]).optional().describe('翻页游标：上一批最早那条的 message_id（可选）'),
    messageSeq: z.number().optional().describe('⚠️ 实测不生效，保留仅为兼容')
  },
  async ({ groupId, messageId, messageSeq }) => {
    const g = String(groupId);
    const a = getAccess();
    if (!isAllowed(a.allowGroups, a.denyGroups, g, a.allowAllWhenEmpty)) {
      return { content: [{ type: 'text', text: `拒绝：群 ${g} 不在只读白名单中。白名单：${a.allowGroups.join(', ') || '（空）'}` }], isError: true };
    }
    try { await authorizeRead(`group:${g}`); } catch (error) {
      return { content: [{ type: 'text', text: `拒绝读取：${error?.message ?? error}` }], isError: true };
    }
    try {
      const params = { group_id: Number(g), count: 200 };
      if (messageId !== undefined && messageId !== null && String(messageId).trim() !== '') params.message_id = String(messageId).trim();
      if (messageSeq !== undefined) params.message_seq = messageSeq;
      const data = await onebot('get_group_msg_history', params);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `查询失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_send_group_message',
  '向指定 QQ 群发送一条纯文本消息；如需引用某条消息，可传 replyToMessageId（非零整数，可为负数），可先用 qq_get_recent_messages / qq_get_message_detail 查询。二代模式（reserved2）下这是可用的发送工具之一，但优先使用 qq_send_message；reserved2 下调用时必须携带会话令牌 token，否则会被拒绝。不要在发送后输出“已发送”类汇报。目标群必须命中系统白名单（config.json 的 allow.groups），否则拒绝。',
  {
    groupId: z.union([z.number(), z.string()]).describe('群号（必须在白名单内）'),
    message: z.string().describe('消息文本，纯文本，不要用 Markdown 或 CQ 码'),
    replyToMessageId: z.union([z.number(), z.string()]).optional().describe('要引用/回复的消息 id（非零整数，可为负数，可选）'),
    token: z.string().optional().describe('二代会话令牌（reserved2 模式下必填；closed-agent 模式不需要）')
  },
  async ({ groupId, message, replyToMessageId, token }) => {
    try {
      const cleanMessage = unquoteJsonString(message);
      const data = await agentApi('/api/send/group', {
        method: 'POST',
        body: JSON.stringify({ groupId: String(groupId), message: cleanMessage, replyToMessageId, token: token || undefined })
      });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `发送失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_reply',
  '在指定 QQ 群里引用/回复某条消息，并发送一条文本。适合群消息很多、需要明确“我回的是哪条”时使用；replyToMessageId 是被引用消息的 id（非零整数，QQ 消息 id 可能为负数），可先用 qq_get_recent_messages / qq_get_unread_messages / qq_get_message_detail 查到具体消息内容和 id。发送前桥接会校验该 id 存在且属于当前会话。二代模式下这是你正常可用的引用工具，但不要每条都引用。只有以下情况才需要引用：① 你这条消息指向的人或消息并非最新一条别人的消息（也就是你在回更早的某条）；② 你连续几句话里不同消息指代的是不同的消息或不同的人。其他情况（上下文唯一、刚在接同一条最新消息）不要引用，别让对方猜，也别为了用工具而用。reserved2 下调用时必须携带会话令牌 token。目标群必须命中系统白名单（config.json 的 allow.groups），否则拒绝。',
  {
    groupId: z.union([z.number(), z.string()]).describe('群号（必须在白名单内）'),
    replyToMessageId: z.union([z.number(), z.string()]).describe('被引用/回复的消息 id（非零整数，可为负数）'),
    message: z.string().describe('要发送的文本，纯文本，不要用 Markdown 或 CQ 码'),
    token: z.string().optional().describe('二代会话令牌（reserved2 模式下必填；closed-agent 模式不需要）')
  },
  async ({ groupId, replyToMessageId, message, token }) => {
    try {
      const cleanMessage = unquoteJsonString(message);
      const data = await agentApi('/api/send/reply', {
        method: 'POST',
        body: JSON.stringify({ groupId: String(groupId), replyToMessageId, message: cleanMessage, token: token || undefined })
      });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `发送失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_send_private_message',
  '向指定 QQ 好友发送一条私聊消息。若提供 replyToMessageId，会以 QQ 引用/回复形式发出（引用条 + 文本）。replyToMessageId 必须是非零整数消息 id（QQ 消息 id 可能为负数），可先用 qq_get_message_detail 查询。二代模式（reserved2）下这是可用的发送工具之一，但优先使用 qq_send_message；调用时必须携带会话令牌 token，否则会被拒绝。不要在发送后输出“已发送”类汇报。目标 QQ 必须命中系统白名单（config.json 的 allow.private），否则拒绝。',
  {
    userId: z.union([z.number(), z.string()]).describe('好友 QQ 号（必须在白名单内）'),
    message: z.string().describe('消息文本，纯文本，不要用 Markdown 或 CQ 码'),
    replyToMessageId: z.union([z.number(), z.string()]).optional().describe('要引用/回复的消息 id（非零整数，可为负数，可选）'),
    token: z.string().optional().describe('二代会话令牌（reserved2 模式下必填；closed-agent 模式不需要）')
  },
  async ({ userId, message, replyToMessageId, token }) => {
    try {
      const cleanMessage = unquoteJsonString(message);
      const data = await agentApi('/api/send/private', {
        method: 'POST',
        body: JSON.stringify({ userId: String(userId), message: cleanMessage, replyToMessageId, token: token || undefined })
      });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `发送失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

// ── 二代仿真模式（reserved2）工具 ─────────────────────────────────────────
server.tool(
  'qq_get_prompt',
  '查看当前二代仿真模式的提示词/角色/推荐值/可用工具/当前唤醒配置（只读）。',
  { key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'), token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）') },
  async ({ key, token }) => {
    try {
      const data = await agentApi(`/api/socialV2/prompt?key=${encodeURIComponent(key)}`, { headers: { 'x-agent-token': token } });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `获取提示词失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_get_unread_messages',
  '查看指定会话的未读消息（只读，不自动标记已读）。',
  { key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'), token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'), limit: z.number().optional().describe('最多返回条数，默认 30，最大 100') },
  async ({ key, token, limit }) => {
    try {
      const data = await agentApi(`/api/socialV2/unread?key=${encodeURIComponent(key)}&limit=${limit ?? 30}`, { headers: { 'x-agent-token': token } });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `获取未读消息失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_get_recent_messages',
  '查看指定会话的最近消息（只读），支持 offset 扩大范围。',
  {
    key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
    token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
    limit: z.number().optional().describe('最多返回条数，默认 20，最大 100'),
    offset: z.number().optional().describe('跳过最近 N 条，用于向前翻看更早消息，默认 0')
  },
  async ({ key, token, limit, offset }) => {
    try {
      const data = await agentApi(`/api/socialV2/recent?key=${encodeURIComponent(key)}&limit=${limit ?? 20}&offset=${offset ?? 0}`, { headers: { 'x-agent-token': token } });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `获取最近消息失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_social_state',
  '查看指定会话的二代仿真状态：WakeConfig、未读数、上次唤醒原因、上次发言时间等（只读）。',
  { key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'), token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）') },
  async ({ key, token }) => {
    try {
      const data = await agentApi(`/api/socialV2/state?key=${encodeURIComponent(key)}`, { headers: { 'x-agent-token': token } });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `获取状态失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_mark_read',
  '将指定会话的当前未读消息标记为已读（用于“看过但决定不回复”后避免重复未读）。注意：每次设置潜水/下一次唤醒前，桥接要求先用 qq_wait_for_messages(timeoutMs=300000) 完成一次沉睡前观察：5 分钟内没人说话可 mark_read 收尾沉睡；期间有人发新消息则先查看 newMessages，判断不需要你参与也可直接 mark_read 收尾；若你参与了回复，则下次想睡需重新等待观察窗口。',
  { key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'), token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）') },
  async ({ key, token }) => {
    try {
      const data = await agentApi('/api/socialV2/mark-read', { method: 'POST', body: JSON.stringify({ key }), headers: { 'x-agent-token': token } });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `标记已读失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_set_wake_config',
  '设置指定会话的二代唤醒配置：mode/无限期或有限时间/提前唤醒条件（@、名字、关键词、提问、拍一拍、概率、anyMessage、指定成员）。triggers.speakerIds 是可选的“指定群友发言唤醒”：填一个或多个群友 QQ 号后，只要其中任意一位在群里发言就会唤醒你；不设置则不启用。适合在等某个人回复、或某人反应慢怕错过时使用。triggers.poke 开启后，群里有人拍一拍（包括拍你或拍别人）会唤醒你。注意：每次设置潜水/下一次唤醒前需先用 qq_wait_for_messages(timeoutMs=300000) 完成一次沉睡前观察：5 分钟内没人说话可设置并沉睡；期间有人发新消息则先查看 newMessages，判断不需要你参与可直接设置并沉睡；若你参与了回复，则下次想睡需重新等待观察窗口。',
  {
    key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
    token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
    config: z.object({
      mode: z.enum(['diving', 'active']).optional().describe('diving=潜水，active=活跃（anyMessage 开启）'),
      infinite: z.boolean().optional().describe('true=无限期，只有条件命中才唤醒；false=有限时间'),
      sleepMs: z.number().optional().describe('有限潜水毫秒数（从当前时间起算）'),
      sleepUntil: z.string().optional().describe('有限潜水截止时间 ISO 字符串，优先级高于 sleepMs'),
      triggers: z.object({
        atMention: z.boolean().optional().describe('被 @ 或引用自己时唤醒'),
        nameMention: z.boolean().optional().describe('被叫名字/昵称时唤醒'),
        speakerIds: z.array(z.union([z.number(), z.string()])).max(20).optional().describe('指定群友 QQ 号数组：这些群友中任意一位发言时唤醒（可选，最多 20 个，不设置则不启用；私聊不适用，设置会被桥接清除；可从 qq_get_active_members / qq_get_group_members / qq_get_message_detail 的 userId/user_id 获取）'),
        keywords: z.array(z.string()).optional().describe('出现任意关键词时唤醒'),
        question: z.boolean().optional().describe('被直接提问/点名挑战时唤醒'),
        poke: z.boolean().optional().describe('有人拍一拍时唤醒（群聊包括拍你和拍别人，私聊为对方拍你）'),
        anyMessage: z.boolean().optional().describe('任意新消息都唤醒（活跃模式）'),
        probability: z.number().optional().describe('普通消息按该概率随机唤醒（0~1）')
      }).optional(),
      batchWindowMs: z.number().optional().describe('多条消息合并唤醒窗口（毫秒，>=1000）')
    }).describe('要设置的唤醒配置，缺省字段保留原值')
  },
  async ({ key, token, config }) => {
    try {
      const data = await agentApi('/api/socialV2/wake-config', { method: 'POST', body: JSON.stringify({ key, config }), headers: { 'x-agent-token': token } });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `设置唤醒配置失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_send_burst',
  '在指定 QQ 群分多条发送消息（二代仿真模式专用），桥接会按真人化随机间隔发送。暂不支持引用，需要引用请用 qq_reply。注意：数组里的每个字符串就是一条 QQ 消息，字符串内部不要用空格分隔中文短句，需要多条请用数组元素；每条消息要读起来完整，不要把同一句话拆到两条里。',
  {
    groupId: z.union([z.number(), z.string()]).describe('群号（必须在白名单内）'),
    token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
    messages: z.union([z.array(z.string()).min(1), z.string()]).describe('要发送的消息数组，每条为纯文本；也兼容传入 JSON 数组字符串')
  },
  async ({ groupId, token, messages }) => {
    try {
      const key = `group:${groupId}`;
      let finalMessages = messages;
      if (typeof finalMessages === 'string') {
        const trimmed = finalMessages.trim();
        // 兼容模型把数组序列化成 JSON 字符串传入的情况，例如 "[...]"。
        if (trimmed.startsWith('[')) {
          try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) finalMessages = parsed.map(String);
          } catch {}
        } else if (trimmed.startsWith('"')) {
          // 兼容模型把单条消息序列化成 JSON 字符串的情况，例如 "\"你好\"" → "你好"。
          try {
            const parsed = JSON.parse(trimmed);
            if (typeof parsed === 'string') finalMessages = parsed;
            else if (Array.isArray(parsed)) finalMessages = parsed.map(String);
          } catch {}
        }
      }
      const data = await agentApi('/api/socialV2/send-burst', {
        method: 'POST',
        body: JSON.stringify({ key, messages: finalMessages }),
        headers: { 'x-agent-token': token },
        timeoutMs: 300000
      });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `分条发送失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_send_message',
  '统一发送工具：可发一条或多条，可引用某条消息，可自定义/按字数计算条间时间差。二代仿真模式专用。注意：字符串=一条消息，数组=多条消息；每个字符串内部不要用空格分隔中文短句，需要多条请用数组元素；每条消息要读起来完整，不要把同一句话拆到两条里。只有以下情况才需要传 replyToMessageId 引用：① 你这条消息指向的人或消息并非最新一条别人的消息（也就是你在回更早的某条）；② 你连续几句话里不同消息指代的是不同的消息或不同的人。其他情况（上下文唯一、刚在接同一条最新消息）不要引用，别让对方猜，也别为了用工具而用。',
  {
    key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
    token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
    messages: z.union([z.string(), z.array(z.string()).min(1)]).describe('要发送的内容：字符串=一条；数组=分多条'),
    replyToMessageId: z.union([z.number(), z.string()]).optional().describe('要引用/回复的消息 id（非零整数，可为负数，可选）'),
    atUserId: z.union([z.number(), z.string()]).optional().describe('要 @ 的群成员 QQ 号（群聊中用于点名某个人；与引用二选一即可，不要滥用）'),
    gapMode: z.enum(['auto', 'fixed', 'byLength']).optional().describe('auto=桥接随机；fixed=固定间隔；byLength=按字数计算'),
    gapMs: z.number().optional().describe('fixed 模式下的统一间隔（毫秒）'),
    gaps: z.array(z.number()).optional().describe('fixed 模式下逐条间隔（长度=条数-1）')
  },
  async ({ key, token, messages, replyToMessageId, atUserId, gapMode, gapMs, gaps }) => {
    try {
      let finalMessages = messages;
      if (typeof finalMessages === 'string') {
        const trimmed = finalMessages.trim();
        // 兼容模型把数组序列化成 JSON 字符串传入的情况，例如 "[...]"。
        if (trimmed.startsWith('[')) {
          try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) finalMessages = parsed.map(String);
          } catch {}
        } else if (trimmed.startsWith('"')) {
          // 兼容模型把单条消息序列化成 JSON 字符串的情况，例如 "\"你好\"" → "你好"。
          try {
            const parsed = JSON.parse(trimmed);
            if (typeof parsed === 'string') finalMessages = parsed;
            else if (Array.isArray(parsed)) finalMessages = parsed.map(String);
          } catch {}
        }
      }
      const data = await agentApi('/api/socialV2/send-message', {
        method: 'POST',
        body: JSON.stringify({ key, messages: finalMessages, replyToMessageId, atUserId: atUserId ?? null, gapMode, gapMs, gaps }),
        headers: { 'x-agent-token': token },
        timeoutMs: 300000
      });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `发送失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

if (cfg.socialV2?.tools?.sendPoke !== false) {
  server.tool(
    'qq_send_poke',
    '发送 QQ 拍一拍（群聊/私聊）。适合用“戳一下”代替一句废话、提醒对方、自然回应别人的拍一拍，或偶尔主动戳一下正在聊的人/熟人——这样更拟真；但别频繁，真人不会一直戳人。群聊必须传 targetUserId（要拍的群友 QQ 号，可从 qq_get_active_members / qq_get_message_detail 的 userId 获取）；私聊可不传 targetUserId（默认拍当前私聊对象）。reserved2 下必须携带会话令牌 token，发送会受桥接白名单与发送频率限制。',
    {
      key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
      token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
      targetUserId: z.union([z.number(), z.string()]).optional().describe('要拍的群友 QQ 号（群聊必填；私聊可选）')
    },
    async ({ key, token, targetUserId }) => {
      try {
        const data = await agentApi('/api/socialV2/send-poke', {
          method: 'POST',
          body: JSON.stringify({ key, targetUserId: targetUserId != null ? String(targetUserId) : '' }),
          headers: { 'x-agent-token': token },
          timeoutMs: 60000
        });
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `拍一拍失败：${error?.message ?? error}` }], isError: true };
      }
    }
  );
}

server.tool(
  'qq_wait_for_messages',
  '等待群友消息：可指定“静默窗口”来判断对方是否说完了。收到新消息后如果还想要更多上下文，设置 quietMs（例如 10000~20000）继续等一小段没有新消息的时间；桥接会强制至少等后台“收到新消息后最小静默”（默认 10000ms=10 秒）再返回，防止抢话。返回 timeout=true 表示这段时间内没有等到新消息/没人说话，这不是错误；可以再用 qq_get_unread_messages / qq_get_recent_messages 查看是否有新消息，再决定继续等、发言或潜水。沉睡前观察：准备设置潜水/下一次唤醒前，必须用 timeoutMs=300000 发起一次完整观察（短等待不会满足沉睡前观察）。如果全程没人说话，返回 preSleepWaitSatisfied=true；如果等待期间等到新消息，会返回 preSleepWaitObserved=true 和 newMessages，表示你已完成一次沉睡前观察，查看后认为不需要你参与即可直接设置潜水。响应里还会给出 preSleepWaitRemainingMs，帮助你判断还差多久。',
  {
    key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
    token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
    timeoutMs: z.number().optional().describe('总等待毫秒数；普通等待默认 30000，沉睡前观察请传 300000（最大 600000）'),
    minNewMessages: z.number().optional().describe('至少等到多少条新消息才提前返回，默认 1'),
    quietMs: z.number().optional().describe('检测到新消息后继续等待的静默窗口（毫秒），用于判断对方是否说完了；建议 8000~12000，默认取 socialV2.wait.defaultQuietMs（当前 8000）')
  },
  async ({ key, token, timeoutMs, minNewMessages, quietMs }) => {
    try {
      // ⚠️ 客户端预算必须**覆盖桥那侧的真实上限**（2026-09-20 修，实测踩到）。
      //
      // 桥的 /api/socialV2/wait 里，"等到安静"那段内层循环刻意允许超出 timeoutMs：
      //     Date.now() - start < timeoutMs + maxQuietMs + 5000
      //   其中 maxQuietMs 最大可到 120000，而且 quietMs 会被抬到 suggestedQuietMs
      //   （可能远大于 AI 传进来的值）。
      // 旧算法只按 AI 传的 quietMs 算：60000 + max(15000,10000) + 20000 = 95 秒，
      // 而桥按规定可以跑到 timeoutMs + 120000 + 5000 = 185 秒
      //   ⇒ 客户端在桥还没返回时就被 AbortSignal.timeout 掐断，
      //     抛的是**异常**而不是正常的 {timeout:true} 响应 ⇒ AI 看到
      //     "The operation was aborted due to timeout" 就误判成"桥接接口不稳定"，放弃发言
      //     （实测两次失败都发生在 90~95 秒，正是旧预算的上限）。
      // 现在按桥的上限算：timeoutMs + 120000 + 20 秒余量，再夹到 725000。
      const wantMs = Math.min(600000, Math.max(5000, Number(timeoutMs) || 30000));
      const budget = Math.min(725000, wantMs + 120000 + 20000);
      const data = await agentApi('/api/socialV2/wait', {
        method: 'POST',
        body: JSON.stringify({ key, timeoutMs, minNewMessages, quietMs }),
        headers: { 'x-agent-token': token },
        timeoutMs: budget
      });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      // 被掐断 / 网络异常时，**不要**回一个"失败"给 AI（2026-09-20 加）。
      // 原因：等待超时本来是正常结果，桥的 timeout 响应形如 {timeout:true}。
      // 但如果客户端先超时/连接被断，AI 收到的是 "等待失败：The operation was aborted..." ——
      // 它会把这句理解成"桥接接口不稳定"（实测它在群里就是这么说的），然后放弃发言。
      // 所以这里把"看起来很像是没等到"的错误，翻译成和桥一致的结果结构，
      // 让 AI 按正常超时处理（可以再等、可以发言、可以收尾），而不是以为系统坏了。
      const msg = String(error?.message ?? error);
      const looksLikeTimeout = /aborted|timeout|中断|ECONNRESET|socket hang up/i.test(msg);
      if (looksLikeTimeout) {
        const payload = {
          ok: true,
          key,
          arrived: false,
          timeout: true,
          waitedMs: budget,
          newMessages: [],
          note: '这次等待在客户端侧到点结束了（没有等到新消息）。这不是错误，也不代表桥接出了问题；可以直接继续对话/再等一次/正常收尾。'
        };
        return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
      }
      return { content: [{ type: 'text', text: `等待失败：${msg}` }], isError: true };
    }
  }
);

server.tool(
  'qq_report_feedback',
  '向控制台/管理端反馈 AI 遇到的问题、困惑或需要管理员介入的情况。',
  {
    key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
    token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
    level: z.enum(['info', 'warning', 'error']).optional().describe('反馈级别，默认 info'),
    message: z.string().describe('反馈内容')
  },
  async ({ key, token, level, message }) => {
    try {
      const data = await agentApi('/api/socialV2/feedback', {
        method: 'POST',
        body: JSON.stringify({ key, level, message }),
        headers: { 'x-agent-token': token }
      });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `反馈失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_get_my_recent_messages',
  '查看自己最近发过的消息（只读），避免重复/保持人设。返回里的 messageId 就是撤回时要用的 id —— 可以用 qq_recall_message 撤掉自己某条说错的话。',
  {
    key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
    token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
    limit: z.number().optional().describe('最多返回条数，默认 10，最大 50')
  },
  async ({ key, token, limit }) => {
    try {
      const data = await agentApi(`/api/socialV2/my-recent?key=${encodeURIComponent(key)}&limit=${limit ?? 10}`, { headers: { 'x-agent-token': token } });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `获取自己消息失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_get_message_detail',
  '按 message_id 查看单条消息的完整内容、发送者、引用信息（只读）。',
  {
    key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
    token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
    messageId: z.union([z.number(), z.string()]).describe('要查看的消息 id（QQ 消息 id 可能为负数）')
  },
  async ({ key, token, messageId }) => {
    try {
      const data = await agentApi(`/api/socialV2/message-detail?key=${encodeURIComponent(key)}&messageId=${encodeURIComponent(String(messageId))}`, { headers: { 'x-agent-token': token } });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `获取消息详情失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_get_active_members',
  '查看最近活跃成员列表（只读），帮助判断话题参与者。',
  {
    key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
    token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
    limit: z.number().optional().describe('最多返回人数，默认 10，最大 20')
  },
  async ({ key, token, limit }) => {
    try {
      const data = await agentApi(`/api/socialV2/active-members?key=${encodeURIComponent(key)}&limit=${limit ?? 10}`, { headers: { 'x-agent-token': token } });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `获取活跃成员失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_transcribe_voice',
  '把一条语音消息转成文字（本地 whisper 识别，音频不上传、不出网）。什么时候该用：消息里出现「[语音·可转写]」，而你确实需要知道内容时 —— 比如有人 @ 你、问你问题、或这条语音明显是对话的一部分。什么时候别用：纯打招呼、背景闲聊、明显与你无关的语音，可以不转（省几秒）。同一条语音只会真正识别一次，之后再问直接返回缓存。也可能失败：纯音乐/噪音/太短的语音识别为空是正常的。',
  {
    key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
    token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
    messageId: z.union([z.string(), z.number()]).describe('那条语音消息的 messageId（从 qq_get_unread_messages / qq_get_recent_messages 的返回里取；消息文本会显示为 [语音·可转写]）')
  },
  async ({ key, token, messageId }) => {
    try {
      const data = await agentApi('/api/socialV2/transcribe', {
        method: 'POST',
        headers: { 'x-agent-token': token },
        body: JSON.stringify({ key, messageId }),
        timeoutMs: 120000
      });
      if (!data?.ok) {
        return { content: [{ type: 'text', text: `语音转写失败：${data?.error ?? '未知原因'}` }], isError: true };
      }
      const note = data.cached ? '（缓存）' : (data.elapsedMs ? `（${(data.elapsedMs / 1000).toFixed(1)} 秒）` : '');
      return { content: [{ type: 'text', text: `这条语音说的是：${data.text}${note}` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `语音转写失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_bili_search',
  '到 B站搜视频，返回候选列表（标题 / UP主 / 播放量 / 时长 / BV号）。什么时候用：有人让你"找个什么视频发群里""来个热门视频""搜个标题带某某的"时 —— 先搜，看完候选再决定发哪条。默认按播放量降序（热度最高的排前面）。注意：B站已风控匿名搜索，需要桥的 config.json 里配了登录态（media.bilibiliCookie），没配会直接告诉你原因。',
  {
    key: z.string().describe('当前会话 key（鉴权用），格式 group:群号 或 private:QQ号'),
    token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
    keyword: z.string().describe('搜索关键词，例如「某个UP主的名字」「科目二 搞笑」「热门动画短片」'),
    sort: z.enum(['play', 'default']).optional().describe('排序：play=按播放量（默认，热度最高在前）；default=B站默认相关度')
  },
  async ({ key, token, keyword, sort }) => {
    try {
      const data = await agentApi('/api/socialV2/bili-search', {
        method: 'POST',
        headers: { 'x-agent-token': token },
        body: JSON.stringify({ key, keyword, sort: sort || 'play' }),
        timeoutMs: 60000
      });
      if (!data?.ok) return { content: [{ type: 'text', text: `搜索失败：${data?.error ?? '未知原因'}` }], isError: true };
      const lines = (data.results || []).map((r, i) =>
        `${i + 1}. ${r.title}\n   UP：${r.author}｜播放：${r.play}｜时长：${r.duration}｜${r.bvid}`);
      return {
        content: [{
          type: 'text',
          text: `「${keyword}」搜到 ${data.count} 条，按${data.sort === 'play' ? '播放量' : '相关度'}排的前 ${lines.length} 条：\n${lines.join('\n')}\n\n要发哪条，就把它的 BV 号传给 qq_send_media。`
        }]
      };
    } catch (error) {
      return { content: [{ type: 'text', text: `搜索失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_send_media',
  '把一个 B站/抖音视频下下来、发到**指定会话**（群或私聊）。什么时候用：有人明确要求把某个视频发到某个群 / 发给某人时 —— 比如你刚用 qq_bili_search 搜到一条要发出去，或有人给了链接要转投别处。url 可以是完整链接、b23.tv 短链、或 BV 号。下载要几秒到几十秒；视频太长、链接坏了会如实报错。目标会话必须在白名单里，否则会被拒。',
  {
    key: z.string().describe('当前会话 key（鉴权用），格式 group:群号 或 private:QQ号'),
    token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
    target: z.string().describe('要发到哪：group:群号 或 private:QQ号'),
    url: z.string().describe('B站/抖音链接、b23.tv 短链，或 BV 号（如 BV1JWeu67E9Z）')
  },
  async ({ key, token, target, url }) => {
    try {
      const data = await agentApi('/api/socialV2/send-media', {
        method: 'POST',
        headers: { 'x-agent-token': token },
        body: JSON.stringify({ key, target, url }),
        timeoutMs: 300000
      });
      if (!data?.ok) return { content: [{ type: 'text', text: `发送失败：${data?.error ?? '未知原因'}` }], isError: true };
      const what = data.kind === 'images'
        ? `${data.count ?? '若干'} 张图`
        : `视频${data.durationSec ? `（${data.durationSec} 秒）` : ''}`;
      return { content: [{ type: 'text', text: `已把《${data.title ?? url}》${what}发到 ${data.target}。` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `发送失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_send_random_image',
  '随机找一张图发到当前会话。什么时候用：有人让你"来张图""发张猫""来个动漫图"这类没有具体内容的看图请求。category 不填就按默认分类随机。注意：这不是画图（画图用 qq_draw_image），是从公开图库随机拿现成的；猫狗是实拍照片，其余都是动漫插画。',
  {
    key: z.string().describe('当前会话 key（鉴权用），格式 group:群号 或 private:QQ号'),
    token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
    category: z.enum([
      'neko', 'waifu', 'fox_girl', 'avatar', 'wallpaper',
      'pat', 'hug', 'cuddle', 'kiss', 'smug', 'slap', 'tickle', 'feed',
      'meow', 'lizard', 'goose', 'cat', 'dog', 'pixiv'
    ])
      .optional()
      .describe('图分类。角色图：neko=猫娘、waifu=动漫少女、fox_girl=狐娘、avatar=头像、wallpaper=壁纸；反应动图（会动的）：pat=摸摸头、hug=抱抱、cuddle=蹭蹭、kiss=亲亲、smug=得意脸、slap=一巴掌、tickle=挠痒痒、feed=投喂；动物：meow=猫、lizard=蜥蜴、goose=鹅、cat=猫（实拍）、dog=狗（实拍）；pixiv=按标签搜 Pixiv（必须同时给 query，画质最好）'),
    query: z.string().optional().describe('仅 category=pixiv 时用：Pixiv 的搜索标签，例如「原神」「猫耳」「風景」。⚠️ 多个词之间是 AND 关系（写「原神 猫耳」= 两个标签都要有），写太多会搜不到结果。'),
    target: z.string().optional().describe('发到哪，默认当前会话；要发到别处才填：group:群号 或 private:QQ号')
  },
  async ({ key, token, category, query, target }) => {
    try {
      const data = await agentApi('/api/socialV2/random-image', {
        method: 'POST',
        headers: { 'x-agent-token': token },
        body: JSON.stringify({ key, category, query, target: target || key }),
        timeoutMs: 120000
      });
      if (!data?.ok) return { content: [{ type: 'text', text: `发图失败：${data?.error ?? '未知原因'}` }], isError: true };
      const extra = data.pid
        ? `（Pixiv pid ${data.pid}，标题《${data.title}》，作者 ${data.author}）`
        : '';
      return {
        content: [{
          type: 'text',
          text: `已发一张「${data.category}」到 ${data.target}（${(Number(data.bytes) / 1024).toFixed(0)}KB）。${extra}\n`
            + `不用再描述图片内容，你也没看过这张图 —— 直接说一句"图来了"之类的话就行，别编图里有什么。`
        }]
      };
    } catch (error) {
      return { content: [{ type: 'text', text: `发图失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_memory_append',
  '记录一条轻量记忆：activeTopic=进行中的话题；pendingThought=你想说但还没说的话；memberImpression=对某位群友的印象。记忆会持久化，并在后续唤醒/qq_get_prompt 中自动出现。',
  {
    key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
    token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
    category: z.enum(['activeTopic', 'pendingThought', 'memberImpression']).describe('记忆类别'),
    content: z.string().describe('记忆内容，例如话题、想说的话、对某人的印象标签'),
    extra: z.object({
      target: z.string().optional().describe('memberImpression 时的群友名字/昵称'),
      participants: z.array(z.string()).optional().describe('activeTopic 的参与者列表'),
      pendingQuestion: z.string().optional().describe('activeTopic 里还没问出口的问题'),
      motivation: z.string().optional().describe('pendingThought 的动机，如 curiosity/sociability'),
      expiresAtMs: z.number().optional().describe('pendingThought 过期毫秒数，默认 2 小时')
    }).optional().describe('附加信息')
  },
  async ({ key, token, category, content, extra }) => {
    try {
      const data = await agentApi('/api/socialV2/memory-append', {
        method: 'POST',
        body: JSON.stringify({ key, category, content, extra: extra || {} }),
        headers: { 'x-agent-token': token }
      });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `记忆写入失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_memory_query',
  '查看当前会话的轻量记忆：进行中的话题、你想说但还没说的话、对群友的印象（只读）。',
  {
    key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
    token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
    category: z.enum(['activeTopic', 'pendingThought', 'memberImpression']).optional().describe('可选：只看某一类记忆')
  },
  async ({ key, token, category }) => {
    try {
      const q = new URLSearchParams({ key });
      if (category) q.set('category', category);
      const data = await agentApi(`/api/socialV2/memory?${q.toString()}`, { headers: { 'x-agent-token': token } });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `记忆读取失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_memory_remove',
  '删除一条轻量记忆：activeTopic/pendingThought 用 content 匹配原文删除；memberImpression 用 target 参数指定群友名字删除。',
  {
    key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
    token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
    category: z.enum(['activeTopic', 'pendingThought', 'memberImpression']).describe('记忆类别'),
    content: z.string().optional().describe('要删除的话题/想法原文（memberImpression 不需要）'),
    target: z.string().optional().describe('memberImpression 时要删除的群友名字')
  },
  async ({ key, token, category, content, target }) => {
    try {
      const data = await agentApi('/api/socialV2/memory-remove', {
        method: 'POST',
        body: JSON.stringify({ key, category, content: content || '', target: target || '' }),
        headers: { 'x-agent-token': token }
      });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `记忆删除失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_memory_clear',
  '清空轻量记忆：不传 category 清空全部；传 activeTopic/pendingThought/memberImpression 只清空对应类别。',
  {
    key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
    token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
    category: z.enum(['activeTopic', 'pendingThought', 'memberImpression']).optional().describe('要清空的类别，缺省清空全部')
  },
  async ({ key, token, category }) => {
    try {
      const data = await agentApi('/api/socialV2/memory-clear', {
        method: 'POST',
        body: JSON.stringify({ key, category: category || '' }),
        headers: { 'x-agent-token': token }
      });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `记忆清空失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_slang_query',
  '查看当前已确认的群聊黑话/梗/网络表达（只读）。返回已确认词条列表和格式化黑话表；遇到不熟悉的词可先查这里，再决定是否搜索/使用。',
  {
    key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
    token: z.string().min(1).describe('会话令牌（见唤醒提示中的【会话令牌】）'),
    q: z.string().optional().describe('可选搜索词，按词条/含义/用法/示例过滤')
  },
  async ({ key, token, q }) => {
    try {
      const query = q ? `&q=${encodeURIComponent(String(q))}` : '';
      const data = await agentApi(`/api/socialV2/slang/query?key=${encodeURIComponent(key)}${query}`, { headers: { 'x-agent-token': token } });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `查询黑话失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

server.tool(
  'qq_slang_submit',
  '把你在群里经常看到但不确定含义/用法的陌生词、黑话、梗或网络表达提交给管理员筛选。提交后进入候选库，管理员确认后会被写入黑话提示词，成为你后续可查询和使用的记忆。',
  {
    key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
    token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
    content: z.string().describe('要提交的陌生词/黑话/梗（最多 50 字）'),
    context: z.string().optional().describe('可选：你是在什么语境/哪条消息里看到的，帮助管理员判断')
  },
  async ({ key, token, content, context }) => {
    try {
      const data = await agentApi('/api/socialV2/slang/submit', {
        method: 'POST',
        body: JSON.stringify({ key, content, context: context || '' }),
        headers: { 'x-agent-token': token }
      });
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `提交黑话失败：${error?.message ?? error}` }], isError: true };
    }
  }
);

// ── 图片/表情查看工具（一代/二代仿真共用） ─────────────────────────────────
if (cfg.socialV2?.tools?.getImages !== false) {
  server.tool(
    'qq_get_message_images',
    '获取指定消息中的图片/表情，并直接以图像内容返回给模型（视觉模型可“看懂”）。当消息文本里出现 [图片]、[表情] 或 hasMedia=true 时调用。**QQ 与微信都支持**：微信会话的 key 形如 wx:private:昵称，messageId 用消息行前面的 #编号（形如 wx-<账号>-26，纯数字也可以）；微信图片是从本地缓存解密出来的，群聊图若对方没在微信里点开过原图，拿到的是缩略图（工具会注明）。支持一条消息里的多张图片/表情；二代模式下必须携带会话令牌。读不出来时返回的文本会写清原因（多大、超了哪个上限）。这种时候要照实告诉对方「图太大/像素太高，我读不了，压缩一下或单独发一张」，**不要**含糊地说「图没加载出来」。',
    {
      key: z.string().describe('会话 key：QQ 形如 group:群号 / private:QQ号；微信形如 wx:group:群名 / wx:private:昵称'),
      messageId: z.union([z.number(), z.string()]).describe('要查看的消息 id（QQ 可为负数，二代也可用本地 seq；微信用消息行前的 #编号，纯数字或 wx-<账号>-<编号> 都行）'),
      token: z.string().optional().describe('二代会话令牌（reserved2 下必填，见唤醒提示中的【会话令牌】）')
    },
    async ({ key, messageId, token }) => {
      try {
        const q = new URLSearchParams({ key, messageId: String(messageId) });
        const data = await agentApi(`/api/images/message?${q.toString()}`, {
          headers: token ? { 'x-agent-token': token } : {},
          timeoutMs: 180000
        });
        const images = Array.isArray(data?.images) ? data.images : [];
        // 有图但一张都没读出来（图太大 / 像素超限 / 下载失败）时，把原因讲清楚（2026-09-23 加）：
        // 以前这里会走到下面的占位分支，AI 只看到“（获取失败）”，于是含糊地回“图我这边没加载出来”。
        const usable = images.filter((img) => img?.data && img?.mimeType);
        if (!usable.length) {
          const why = data?.note
            || images.map((img) => String(img?.text ?? '').trim()).filter(Boolean).join('；')
            || '未找到';
          return { content: [{ type: 'text', text: `消息 ${messageId} 的图片/表情读不出来：${why}` }] };
        }
        const content = [];
        const textParts = [];
        for (const img of images) {
          if (img?.data && img?.mimeType) {
            textParts.push(`[${img.kind === 'face' ? '表情' : '图片'}${img.index ?? ''}${img.text ? ' ' + img.text : ''}]`);
            content.push({ type: 'image', mimeType: img.mimeType, data: img.data });
          } else {
            textParts.push(`[${img.kind === 'face' ? '表情' : '图片'}${img.index ?? ''}${img.text ? ' ' + img.text : '（获取失败）'}]`);
          }
        }
        if (textParts.length) {
          content.unshift({ type: 'text', text: `消息 ${messageId} 的媒体内容（${images.length} 项）：\n${textParts.join('\n')}` });
        }
        return { content };
      } catch (error) {
        return { content: [{ type: 'text', text: `获取图片失败：${error?.message ?? error}` }], isError: true };
      }
    }
  );
}

// ── 表情包体系工具（二代仿真模式） ─────────────────────────────────────────
if (cfg.socialV2?.sticker?.enabled !== false && cfg.socialV2?.tools?.listStickers !== false) {
  server.tool(
    'qq_list_stickers',
    '查看 QQ 账号上已收藏的表情包（自定义表情）列表：包含 emoji_id、备注 desc、本地笔记 localNote、标签 tags、使用次数等。可通过 query 按备注/笔记/标签搜索；无备注的表情可以先调用 qq_get_sticker_image 看图理解，再用 qq_sticker_note 记下含义。刚新增/删除表情后如需立即同步，请传 refresh=true。',
    {
      key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
      token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
      query: z.string().optional().describe('可选搜索词，按备注/本地笔记/标签/用法过滤'),
      count: z.number().optional().describe('最多返回条数，默认 48，受 socialV2.sticker.maxListCount 配置上限约束（当前通常 100）'),
      refresh: z.boolean().optional().describe('是否强制从 QQ 重新同步收藏表情，默认 false（走缓存）')
    },
    async ({ key, token, query, count, refresh }) => {
      try {
        const q = new URLSearchParams({ key });
        if (query) q.set('query', String(query));
        if (count != null) q.set('count', String(count));
        if (refresh) q.set('refresh', '1');
        const data = await agentApi(`/api/socialV2/sticker-list?${q.toString()}`, { headers: { 'x-agent-token': token } });
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `获取表情列表失败：${error?.message ?? error}` }], isError: true };
      }
    }
  );
}

if (cfg.socialV2?.sticker?.enabled !== false && cfg.socialV2?.tools?.getStickerImage !== false) {
  server.tool(
    'qq_get_sticker_image',
    '获取指定收藏表情的图片内容并直接以图像返回给模型（视觉模型可“看懂”）。当 qq_list_stickers 返回的表情 desc/localNote 为空、或你想确认表情实际长什么样时调用。stickerId 可用 qq_list_stickers 返回的 id / md5 / url。',
    {
      key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
      token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
      stickerId: z.string().describe('表情标识：emoji_id / md5 / 图片 URL（来自 qq_list_stickers）')
    },
    async ({ key, token, stickerId }) => {
      try {
        const q = new URLSearchParams({ key, stickerId: String(stickerId) });
        const data = await agentApi(`/api/socialV2/sticker-image?${q.toString()}`, { headers: { 'x-agent-token': token }, timeoutMs: 180000 });
        if (!data?.image?.data || !data?.image?.mimeType) {
          return { content: [{ type: 'text', text: `表情没有可返回的图片：${data?.error || '未知'}` }], isError: true };
        }
        const content = [
          { type: 'text', text: `表情 ${data.sticker?.id || stickerId}${data.sticker?.desc ? '（备注：' + data.sticker.desc + '）' : ''} 的图片内容：` },
          { type: 'image', mimeType: data.image.mimeType, data: data.image.data }
        ];
        return { content };
      } catch (error) {
        return { content: [{ type: 'text', text: `获取表情图片失败：${error?.message ?? error}` }], isError: true };
      }
    }
  );
}

if (cfg.socialV2?.sticker?.enabled !== false && cfg.socialV2?.tools?.sendSticker !== false) {
  server.tool(
    'qq_send_sticker',
    '在指定会话发送一个 QQ 收藏表情包（自定义表情）。stickerId 用 qq_list_stickers 返回的 id / md5 / url。注意：一条消息只能是一张表情，不能在同一气泡里附带文字；想说的话请先用 qq_send_message / qq_reply 作为单独气泡发送，再单独发这张表情。需要引用/点名时可用 replyToMessageId / atUserId（群聊）。真人偶尔用表情包很自然，但别刷屏。',
    {
      key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
      token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
      stickerId: z.string().describe('表情标识：emoji_id / md5 / 图片 URL（来自 qq_list_stickers）'),
      replyToMessageId: z.union([z.number(), z.string()]).optional().describe('要引用/回复的消息 id（非零整数，可为负数，可选）'),
      atUserId: z.union([z.number(), z.string()]).optional().describe('要 @ 的群成员 QQ 号（群聊中可选，私聊不可用）')
    },
    async ({ key, token, stickerId, replyToMessageId, atUserId }) => {
      try {
        const data = await agentApi('/api/socialV2/send-sticker', {
          method: 'POST',
          body: JSON.stringify({ key, stickerId: String(stickerId), replyToMessageId, atUserId: atUserId ?? null }),
          headers: { 'x-agent-token': token },
          timeoutMs: 300000
        });
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `发送表情失败：${error?.message ?? error}` }], isError: true };
      }
    }
  );
}

if (cfg.socialV2?.tools?.sendVoice !== false) {
  server.tool(
    'qq_send_voice',
    '让机器人「开口说话」：发一条语音（群聊、私聊都可以）。'
    + '什么时候用：只在你「说话的语气」本身就是内容的时候 —— 想哼一声、学某个腔调、强调一句、或者文字表达不出那股情绪。'
    + '⚠️ 这是偶尔的骚操作，不是常规回复方式：绝大多数回复仍然用文字；同一次唤醒最多发 1 条；不要用它代替文字回答。'
    + 'text 建议 30 字以内（上限 120 字），太长会又慢又难听。语音发出后对方会同时看到它的转写文字。',
    {
      key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
      token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
      text: z.string().describe('要念出来的话，建议 30 字以内，最多 120 字'),
      character: z.string().optional().describe('音色 id，可选；默认用 config.json 里 tts 段配的音色（当前是龙华·元气甜美女 longhua_v2）')
    },
    async ({ key, token, text, character }) => {
      try {
        const data = await agentApi('/api/socialV2/send-voice', {
          method: 'POST',
          body: JSON.stringify({ key, text: String(text), character: character ? String(character) : '' }),
          headers: { 'x-agent-token': token },
          timeoutMs: 120000
        });
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `发送语音失败：${error?.message ?? error}` }], isError: true };
      }
    }
  );
}
if (cfg.socialV2?.tools?.recallMessage !== false) {
  server.tool(
    'qq_recall_message',
    '撤回机器人自己发错的消息。什么时候用：刚发出去就发现说错了、发错对象了、复制串行了、手滑发了重复内容 —— 越早撤越稳。'
    + 'messageId 可以不填：不填就撤自己最近发的那一条（最常用）。要撤更早的某条，先用 qq_get_my_recent_messages 拿 id 再传进来。'
    + '⚠️ 只能撤自己发的（撤不了群友的消息），也只能撤约 2 分钟内的，晚了会被拒。'
    + '⚠️ 这是纠错工具，不是改口供的工具：正常说过的话说过就说了，别拿它掩盖或反悔。',
    {
      key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
      token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
      messageId: z.union([z.number(), z.string()]).optional().describe('要撤回的消息 id（可选；不填就撤自己最近发的那条）')
    },
    async ({ key, token, messageId }) => {
      try {
        const data = await agentApi('/api/socialV2/recall', {
          method: 'POST',
          body: JSON.stringify({ key, messageId: messageId !== undefined && messageId !== null ? String(messageId) : '' }),
          headers: { 'x-agent-token': token },
          timeoutMs: 30000
        });
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `撤回失败：${error?.message ?? error}` }], isError: true };
      }
    }
  );
}

if (cfg.socialV2?.tools?.searchHistory !== false) {
  server.tool(
    'qq_search_history',
    '按关键词搜聊天历史记录（只读）—— 「翻群聊老记录」用这个。默认只搜当前会话，不跨群。'
    + '什么时候用：要确认"上次那个东西叫什么 / 什么时候说的 / 是谁说的 / 群里那个梗的出处"、'
    + '或者和这个人之前定过什么事，而这段对话已经不在你眼前了。'
    + '关键词要用最可能按原文出现的那个词（人名、梗、专有名词），别用"聊天""哈哈"这种满屏都是的词。'
    + '返回按时间倒序，isSelf=true 的就是你自己说过的话（sender 显示"我"），每条都带 messageId 和 seq。'
    + '⚠️ 搜不到就如实说搜不到，不要拿搜索结果编造；也别为了一件事反复换词搜。',
    {
      key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
      token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
      keyword: z.string().describe('搜索关键词（1~50 字，用最可能按原文出现的词）'),
      limit: z.union([z.number(), z.string()]).optional().describe('最多返回几条，默认 20，上限 50'),
      days: z.union([z.number(), z.string()]).optional().describe('只往前搜多少天，默认 30；0 = 不限时间'),
      groupId: z.union([z.number(), z.string()]).optional().describe('要搜别的群时才填群号（默认只在当前会话内搜，且需管理员允许跨群）')
    },
    async ({ key, token, keyword, limit, days, groupId }) => {
      try {
        const payload = { key, keyword: String(keyword) };
        if (limit !== undefined && limit !== null && String(limit).trim() !== '') payload.limit = Number(limit);
        if (days !== undefined && days !== null && String(days).trim() !== '') payload.days = Number(days);
        if (groupId !== undefined && groupId !== null && String(groupId).trim() !== '') payload.groupId = String(groupId).trim();
        const data = await agentApi('/api/socialV2/search-history', {
          method: 'POST',
          body: JSON.stringify(payload),
          headers: { 'x-agent-token': token },
          timeoutMs: 60000
        });
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `搜索历史失败：${error?.message ?? error}` }], isError: true };
      }
    }
  );
}

if (cfg.socialV2?.tools?.watchVideo !== false) {
  server.tool(
    'qq_watch_video',
    '看懂一条 B站视频（下载后看画面 + 听声音，返回内容描述）。'
    + '什么时候用：群里有人发了 B站链接/卡片（b23.tv 短链、BV 号），而你需要知道视频里到底是什么内容 —— '
    + '比如群友问你「这视频讲了啥」「什么梗」、或你想接话但不确定视频内容时。'
    + '⚠️ 群友直接发**视频文件**时你已经自动看到了，不用调这个工具。'
    + '⚠️ 每次都要下载+分析，几秒到几十秒，还占带宽：别连着调，也别为了确认再调一次。'
    + 'url 给 BV 号 / b23.tv 短链 / 完整链接都行；question 可选，用来指定你想重点问什么。',
    {
      key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
      token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
      url: z.string().describe('B站视频：BV 号 / b23.tv 短链 / 完整链接'),
      question: z.string().optional().describe('可选：想重点问什么（不填就让它客观描述画面与声音）')
    },
    async ({ key, token, url, question }) => {
      try {
        const data = await agentApi('/api/socialV2/watch-video', {
          method: 'POST',
          body: JSON.stringify({ key, url: String(url), question: question ? String(question) : '' }),
          headers: { 'x-agent-token': token },
          timeoutMs: 300000
        });
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `看视频失败：${error?.message ?? error}` }], isError: true };
      }
    }
  );
}
if (cfg.socialV2?.tools?.sendFile !== false) {
  server.tool(
    'qq_send_file',
    '把一个文件发到当前会话（群聊＝上传到群文件，私聊＝发私聊文件）。'
    + '什么时候用：有人让你「把 XX 发群里 / 发给我」「传个文件」时。'
    + '⚠️ 只能发「_发送」文件夹里的文件 —— 那是白名单，其他位置的文件一律发不出去（会被直接拒绝）。'
    + '所以 path 给文件名就行（例如 "小鲸鱼表情包.zip"）；不确定文件夹里有什么，先调 qq_list_sendables 看一眼。'
    + '⚠️ 上传要几秒到几十秒，别连着传，也不要为了确认重复调用。',
    {
      key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
      token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
      path: z.string().describe('要发的文件名（放在「_发送」文件夹里），也可以给它的完整路径'),
      name: z.string().optional().describe('可选：上传后显示的文件名（默认用原文件名）'),
      folder: z.string().optional().describe('可选：上传到群文件的哪个文件夹（不填＝群文件根目录）')
    },
    async (args) => {
      try {
        const data = await agentApi('/api/socialV2/send-file', {
          method: 'POST',
          body: JSON.stringify({ key: args.key, path: String(args.path ?? ''), name: args.name ? String(args.name) : '', folder: args.folder ? String(args.folder) : '' }),
          headers: { 'x-agent-token': args.token },
          timeoutMs: 600000
        });
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: '发文件失败：' + (error?.message ?? error) }], isError: true };
      }
    }
  );
}

if (cfg.socialV2?.tools?.endfield !== false) {
  server.tool(
    'qq_endfield_query',
    '查群友的《明日方舟：终末地》数据并出图发到当前会话（数据来自森空岛，用的是他自己扫码绑定的账号）。'
    + '什么时候用：群友 @ 你 或点名要「他的终末地数据」时，**先调一次 kind="info" 出账号信息卡**；'
    + '之后他接着想看别的（抽卡 / 战绩 / 装备），**直接再调对应 kind 就行 —— 不用等他再 @ 你**。'
    + 'kind 取值：info=账号信息卡（等级/据点/收集度/勋章展示/飞船好感度）· '
    + 'gacha=抽卡分析（角色池与武器池分开，含各池水位与欧非）· '
    + 'battle=战绩（影拓丰碑 + 战争回响，含每关最佳通关用时与四人阵容）· '
    + 'gear=角色装备（武器/护甲/臂甲/配件/战术物品）。'
    + '⚠️ 只有「在这个群里发过『绑定终末地』并扫码绑过」的人能查；没绑定的会被桥拦下、并在群里提示他绑定，你照实转达即可。'
    + '⚠️ 出图要 10~30 秒（抽卡图首次可能更久），一次别连调多个 kind，也别为了确认重复调用。',
    {
      key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
      token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
      kind: z.enum(['info', 'gacha', 'battle', 'gear', 'chars']).optional().describe('要出哪种图；默认 info（账号信息卡）；chars=角色图鉴')
    },
    async (args) => {
      try {
        const data = await agentApi('/api/socialV2/endfield/query', {
          method: 'POST',
          body: JSON.stringify({ key: args.key, kind: String(args.kind ?? 'info') }),
          headers: { 'x-agent-token': args.token },
          timeoutMs: 300000
        });
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: '出图失败：' + (error?.message ?? error) }], isError: true };
      }
    }
  );
}

if (cfg.socialV2?.tools?.sendFile !== false) {
  server.tool(
    'qq_list_sendables',
    '列出「可发送文件夹」里有哪些文件（只读）。'
    + '什么时候用：有人让你发文件，但你没把握文件夹里有什么、或者想确认有没有对应名字的文件时。'
    + '返回文件名、大小（MB）、修改时间。只有这里列出来的文件你能发出去，其他位置的文件发不了。',
    {
      key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
      token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）')
    },
    async (args) => {
      try {
        const data = await agentApi('/api/socialV2/sendables', {
          method: 'GET',
          headers: { 'x-agent-token': args.token },
          timeoutMs: 30000
        });
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: '列文件失败：' + (error?.message ?? error) }], isError: true };
      }
    }
  );
}

if (cfg.socialV2?.tools?.drawImage !== false) {
  server.tool(
    'qq_draw_image',
    '画一张图并发到当前会话（群聊/私聊）。有人让你「画个 XXX」「来张图」时用它。'
    + '出图大约要 40 秒，比较慢——调用前可以先发一句「画着呢」之类的话，且不要因为没立刻返回就重复调用。'
    + 'prompt 写得越具体越好：主体、动作、风格、颜色、背景。'
    + '不要画真人照片、不要画违规或敏感内容；群友要求画这类东西时礼貌拒绝。',
    {
      key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
      token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
      prompt: z.string().describe('画面描述，例如「一只戴墨镜的蓝色小鲸鱼，Q版卡通，白色背景」'),
      caption: z.string().optional().describe('可选配文：会先发这条文字，再发图。不填就只发图'),
      replyToMessageId: z.union([z.number(), z.string()]).optional().describe('可选：要引用的消息 id'),
      atUserId: z.union([z.number(), z.string()]).optional().describe('可选：要 @ 的群成员 QQ 号')
    },
    async ({ key, token, prompt, caption, replyToMessageId, atUserId }) => {
      try {
        const data = await agentApi('/api/socialV2/draw', {
          method: 'POST',
          body: JSON.stringify({ key, prompt, caption, replyToMessageId, atUserId }),
          headers: { 'x-agent-token': token },
          timeoutMs: 300000
        });
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `画图失败：${error?.message ?? error}` }], isError: true };
      }
    }
  );
}

if (cfg.socialV2?.sticker?.enabled !== false && cfg.socialV2?.tools?.collectSticker !== false) {
  server.tool(
    'qq_collect_sticker',
    '收藏当前会话里别人发的一张表情/图片到你的 QQ 收藏表情，并可写一句简短备注（如“好图偷了，兄弟”）。messageId 用 qq_get_unread_messages / qq_get_recent_messages 返回的 messageId 或 seq。注意：不要频繁收藏，只在真的觉得有意思/好用/戳中你时才偷图；收藏后你可以在 qq_list_stickers 里看到并继续使用。',
    {
      key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
      token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
      messageId: z.string().describe('要收藏的那条消息的 messageId 或 seq（来自 qq_get_unread_messages / qq_get_recent_messages）'),
      remark: z.string().optional().describe('简短备注，最多 20 字，例如“好图偷了，兄弟”')
    },
    async ({ key, token, messageId, remark }) => {
      try {
        const data = await agentApi('/api/socialV2/collect-sticker', {
          method: 'POST',
          body: JSON.stringify({ key, messageId: String(messageId), remark: remark || '' }),
          headers: { 'x-agent-token': token },
          timeoutMs: 60000
        });
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `收藏表情失败：${error?.message ?? error}` }], isError: true };
      }
    }
  );
}

if (cfg.socialV2?.tools?.getSelfImage !== false) {
  server.tool(
    'qq_get_self_image',
    '查看你自己的默认 Q 版形象图片（DeepSeek 小鲸鱼形象）。当你被问“你长什么样/发张自拍/你是什么形象”时，可以调用这个工具看自己的样子；返回的图片会直接进入你的视觉上下文。',
    {
      key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
      token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）')
    },
    async ({ key, token }) => {
      try {
        const q = new URLSearchParams({ key });
        const data = await agentApi(`/api/socialV2/self-image?${q.toString()}`, { headers: { 'x-agent-token': token } });
        if (!data?.image?.data || !data?.image?.mimeType) {
          return { content: [{ type: 'text', text: `没有可返回的形象图片：${data?.error || '未知'}` }], isError: true };
        }
        return {
          content: [
            { type: 'text', text: '这是你的默认 Q 版形象：' },
            { type: 'image', mimeType: data.image.mimeType, data: data.image.data }
          ]
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `获取形象图片失败：${error?.message ?? error}` }], isError: true };
      }
    }
  );
}

if (cfg.socialV2?.sticker?.enabled !== false && cfg.socialV2?.tools?.stickerNote !== false) {
  server.tool(
    'qq_sticker_note',
    '给一个收藏表情记录你自己的理解/备注/标签/用法，供以后选择表情时参考。这是本地记忆，不会修改 QQ 账号的官方备注；适合对没有备注的表情看图后记住含义。',
    {
      key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
      token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
      stickerId: z.string().describe('表情标识：emoji_id / md5 / 图片 URL（来自 qq_list_stickers）'),
      note: z.string().optional().describe('你理解的表情含义/适合场景，最多 200 字'),
      tags: z.array(z.string()).optional().describe('可选标签，如 ["嘲讽","笑哭","怼人"]'),
      usage: z.string().optional().describe('可选用法说明，最多 200 字')
    },
    async ({ key, token, stickerId, note, tags, usage }) => {
      try {
        const payload = { key, stickerId: String(stickerId) };
        if (note !== undefined && note !== null) payload.note = String(note);
        if (tags !== undefined && tags !== null) payload.tags = Array.isArray(tags) ? tags.map(String) : [];
        if (usage !== undefined && usage !== null) payload.usage = String(usage);
        const data = await agentApi('/api/socialV2/sticker-note', {
          method: 'POST',
          body: JSON.stringify(payload),
          headers: { 'x-agent-token': token }
        });
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `记录表情备注失败：${error?.message ?? error}` }], isError: true };
      }
    }
  );
}

if (cfg.socialV2?.sticker?.enabled !== false && cfg.socialV2?.tools?.setStickerRemark !== false) {
  server.tool(
    'qq_set_sticker_remark',
    '修改 QQ 账号里收藏表情的官方备注（desc）。这是写操作，会直接影响 QQ 账号的表情备注；仅在管理员明确允许（socialV2.tools.setStickerRemark=true）时可用。一般优先用 qq_sticker_note 记录自己的理解，不要随意改官方备注。',
    {
      key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
      token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
      stickerId: z.string().describe('表情标识：emoji_id / md5 / 图片 URL（来自 qq_list_stickers）'),
      remark: z.string().describe('新的表情备注，最多 50 字')
    },
    async ({ key, token, stickerId, remark }) => {
      try {
        const data = await agentApi('/api/socialV2/sticker-remark', {
          method: 'POST',
          body: JSON.stringify({ key, stickerId: String(stickerId), remark: String(remark || '') }),
          headers: { 'x-agent-token': token }
        });
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `修改表情备注失败：${error?.message ?? error}` }], isError: true };
      }
    }
  );
}

// ── 合并转发消息查看工具（二代仿真模式） ────────────────────────────────────
if (cfg.socialV2?.tools?.getForwardMsg !== false) {
  server.tool(
    'qq_get_forward_msg',
    '查看当前会话中出现的合并转发消息/聊天记录内容（只读）。当消息文本里出现 `[转发消息 id=...]`，或 `qq_get_unread_messages` / `qq_get_recent_messages` / `qq_get_message_detail` 返回的某条消息带 `forwardIds` / `hasForward: true` 时调用。只能查看当前会话确实收到过的转发消息 id，不能任意读取。返回内容会包含每条消息的 text、media（图片/表情元数据）与 nestedForwardIds；如果合并转发里有图片，工具会直接把最多 5 张图片以图像内容返回给视觉模型；如果里面有嵌套合并转发，会附带嵌套转发 id 和前几条预览，必要时可继续用本工具查看嵌套 id。',
    {
      key: z.string().describe('会话 key，格式 group:群号 或 private:QQ号'),
      token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
      id: z.string().describe('合并转发消息 id（来自消息里的 [转发消息 id=...] 或 forwardIds 数组）')
    },
    async ({ key, token, id }) => {
      try {
        const q = new URLSearchParams({ key, id: String(id) });
        const data = await agentApi(`/api/socialV2/forward-message?${q.toString()}`, {
          headers: { 'x-agent-token': token },
          timeoutMs: 120000
        });
        const content = [{ type: 'text', text: JSON.stringify(data, null, 2) }];
        // 收集所有层级的图片/表情元数据（含嵌套预览），最多返回 5 张。
        const images = [];
        const seen = new Set();
        const collectMedia = (msgs) => {
          if (!Array.isArray(msgs)) return;
          for (const m of msgs) {
            if (!m || typeof m !== 'object') continue;
            for (const media of Array.isArray(m.media) ? m.media : []) {
              if (!media || typeof media !== 'object') continue;
              const keyId = media.url || media.file || media.faceId || '';
              if (!keyId || seen.has(keyId)) continue;
              seen.add(keyId);
              images.push(media);
            }
          }
        };
        collectMedia(data?.messages);
        if (Array.isArray(data?.nestedPreviews)) {
          for (const np of data.nestedPreviews) collectMedia(np?.messages);
        }
        const MAX_IMAGES = 5;
        const imageTexts = [];
        if (images.length) {
          try {
            const mediaRes = await agentApi('/api/socialV2/forward-media', {
              method: 'POST',
              body: JSON.stringify({ key, media: images.slice(0, MAX_IMAGES) }),
              headers: { 'x-agent-token': token },
              timeoutMs: 180000
            });
            const mediaImages = Array.isArray(mediaRes?.images) ? mediaRes.images : [];
            for (const img of mediaImages) {
              if (img?.data && img?.mimeType) {
                content.push({ type: 'image', mimeType: img.mimeType, data: img.data });
                imageTexts.push(`[转发内图片${img.index != null ? ' ' + img.index : ''}${img.text ? ' ' + img.text : ''}]`);
              } else {
                // 去掉桥侧已带上的全角括号，避免“（（原因））”（2026-09-23）
                const why = String(img.text ?? '').trim().replace(/^（|）$/g, '') || '获取失败';
                imageTexts.push(`[转发内图片${img.index != null ? ' ' + img.index : ''}（${why}）]`);
              }
            }
            if (mediaRes?.note) imageTexts.push(`[转发内图片：${mediaRes.note}]`);
          } catch (error) {
            imageTexts.push(`[转发内图片（批量获取失败：${error?.message ?? error}）]`);
          }
        }
        if (imageTexts.length) {
          content.unshift({ type: 'text', text: `合并转发 ${id} 的图片内容（${imageTexts.length} 项）：\n${imageTexts.join('\n')}` });
        }
        return { content };
      } catch (error) {
        return { content: [{ type: 'text', text: `查看合并转发失败：${error?.message ?? error}` }], isError: true };
      }
    }
  );
}

// ── 管理员私聊本地执行（2026-10-20 加）─────────────────────────────────────
// 设计要点：
//  · 只有「管理员私聊」能真正执行 —— 桥侧 /api/agent/exec 会校验 agent token
//    对应的会话 key，任何群聊 / 其他私聊调用一律硬拒（提示词里也别去试）。
//  · 危险操作（覆盖已有文件、改已有文件、破坏性命令）不会直接执行：工具返回
//    「需要确认」，桥会顺手给管理员发一条确认消息，等他回「干」再重试。
//  · 输出统一截断，避免把上下文撑爆。

const AGENT_TIMEOUT_MS = 60000;
const AGENT_SHELL_TIMEOUT_MS = 650000;

async function agentExec({ key, token, op, args, timeoutMs }) {
  const data = await agentApi('/api/agent/exec', {
    method: 'POST',
    body: JSON.stringify({ key, op, args }),
    headers: { 'x-agent-token': token },
    timeoutMs: timeoutMs || AGENT_TIMEOUT_MS
  });
  if (data?.needsConfirm) {
    return `⏸ 需要管理员确认：${data.action}\n${data.detail}\n\n确认请求已替你发给他了，等他回一句「干」再重试这个操作。`;
  }
  return JSON.stringify(data, null, 2);
}

async function runAgentTool(a, op, args, timeoutMs) {
  try {
    const text = await agentExec({ key: a.key, token: a.token, op, args, timeoutMs });
    return { content: [{ type: 'text', text }] };
  } catch (error) {
    return { content: [{ type: 'text', text: `本地执行失败：${error?.message ?? error}` }], isError: true };
  }
}

const AGENT_AUTH = {
  key: z.string().describe('会话 key（private:管理员QQ）'),
  token: z.string().describe('会话令牌')
};

server.tool(
  'qq_agent_read',
  '【仅管理员私聊】读本地文件，返回带行号的内容。其他会话调用会被拒，别试。',
  { ...AGENT_AUTH, file_path: z.string().describe('文件路径'), offset: z.number().optional().describe('起始行，默认 1'), limit: z.number().optional().describe('最多行数，默认 2000') },
  async (a) => runAgentTool(a, 'read', { file_path: a.file_path, offset: a.offset, limit: a.limit })
);

server.tool(
  'qq_agent_write',
  '【仅管理员私聊】写本地文件（新建或整文件覆盖）。覆盖已有文件需管理员先确认。其他会话会被拒。',
  { ...AGENT_AUTH, file_path: z.string().describe('文件路径'), content: z.string().describe('完整文件内容') },
  async (a) => runAgentTool(a, 'write', { file_path: a.file_path, content: a.content })
);

server.tool(
  'qq_agent_edit',
  '【仅管理员私聊】在文件里精确替换文本。old_string 必须一字不差且唯一，需管理员确认后执行。',
  { ...AGENT_AUTH, file_path: z.string().describe('文件路径'), old_string: z.string().describe('被替换的原文（含缩进）'), new_string: z.string().describe('替换成什么'), replace_all: z.boolean().optional().describe('替换全部匹配，默认 false') },
  async (a) => runAgentTool(a, 'edit', { file_path: a.file_path, old_string: a.old_string, new_string: a.new_string, replace_all: a.replace_all })
);

server.tool(
  'qq_agent_glob',
  '【仅管理员私聊】按通配符找文件（如 **/*.js）。其他会话会被拒。',
  { ...AGENT_AUTH, pattern: z.string().describe('通配符，如 **/*.js'), path: z.string().optional().describe('搜索根目录'), max_results: z.number().optional().describe('最多返回条数') },
  async (a) => runAgentTool(a, 'glob', { pattern: a.pattern, path: a.path, max_results: a.max_results })
);

server.tool(
  'qq_agent_grep',
  '【仅管理员私聊】用正则搜索文件内容。其他会话会被拒。',
  { ...AGENT_AUTH, pattern: z.string().describe('正则'), path: z.string().optional().describe('搜索根目录'), glob: z.string().optional().describe('只搜匹配的文件名'), max_matches: z.number().optional().describe('最多匹配数') },
  async (a) => runAgentTool(a, 'grep', { pattern: a.pattern, path: a.path, glob: a.glob, max_matches: a.max_matches })
);

server.tool(
  'qq_agent_pwsh',
  '【仅管理员私聊】执行 PowerShell 命令并返回 stdout/stderr/退出码。破坏性命令需管理员先确认。其他会话会被拒。',
  { ...AGENT_AUTH, command: z.string().describe('要执行的命令'), cwd: z.string().optional().describe('工作目录（不填则用桥配置的默认根目录）'), timeoutMs: z.number().optional().describe('超时毫秒，默认 120000') },
  async (a) => runAgentTool(a, 'pwsh', { command: a.command, cwd: a.cwd, timeoutMs: a.timeoutMs }, AGENT_SHELL_TIMEOUT_MS)
);

server.tool(
  'qq_agent_ls',
  '【仅管理员私聊】列目录内容（含大小与修改时间）。其他会话会被拒。',
  { ...AGENT_AUTH, path: z.string().optional().describe('目录路径') },
  async (a) => runAgentTool(a, 'ls', { path: a.path })
);

await server.connect(new StdioServerTransport());

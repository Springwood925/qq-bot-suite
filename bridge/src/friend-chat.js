#!/usr/bin/env node
// 朋友聊天（网页版）：给不用 QQ 的朋友一个网页聊天入口。
//
// 为什么单独一个进程 + 单独一个端口，而不是并进 qq-bridge：
//   1) qq-bridge 的 3100 端口用「控制台令牌」保护，而那个令牌权限极大——改模式、
//      改提示词、发消息、重启、重置工作区。朋友不该拿到那种权限。
//   2) 独立进程 = 它崩了不影响 QQ 机器人（那套是天天在用的）。
//   3) 独立端口 3200：只暴露聊天接口和页面，控制台仍然只在 127.0.0.1 上。
//   4) 安全边界在预设里：friend-chat 预设不挂本地工具，且把 QQ 工具全挡掉
//      （见 ~/.dsh/.agent-presets/friend-chat/），对面无法借机器人往群里发消息。
//
// 远程访问：内置 cloudflared 快速隧道（tools\cloudflared.exe）。
//   隧道只把 3200 这个口子开放出去，控制台（3100）永远不出公网。
//
// 启动：node src/friend-chat.js

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NodeApiClient, unwrap, createTurnCollector } from './dsh-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STATE_DIR = path.join(ROOT, 'state');
const CFG_FILE = path.join(ROOT, 'config.json');
const STORE_FILE = path.join(STATE_DIR, 'friend.json');
const TOKEN_FILE = path.join(STATE_DIR, 'friend-token');
const LOG_FILE = path.join(STATE_DIR, 'friend.log');
const URL_FILE = path.join(STATE_DIR, 'friend-url.txt');

const PORT = Number(process.env.FRIEND_PORT || 3200);
const HOST = process.env.FRIEND_HOST || '0.0.0.0';
const TURN_TIMEOUT_MS = Number(process.env.FRIEND_TURN_TIMEOUT_MS || 180000);
const MAX_HISTORY = 200;
// 公网口子上的限流：一个人 10 分钟内最多 25 条，全局每分钟最多 40 条。
const PER_VISITOR_WINDOW_MS = 10 * 60 * 1000;
const PER_VISITOR_MAX = 25;
const GLOBAL_WINDOW_MS = 60 * 1000;
const GLOBAL_MAX = 40;

fs.mkdirSync(STATE_DIR, { recursive: true });

function log(...args) {
  const line = `${new Date().toISOString().slice(11, 19)} [friend] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch { /* 日志写不了不影响主流程 */ }
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

const cfg = readJson(CFG_FILE, {}) || {};
const dshBase = String(cfg.dsh?.baseUrl || 'http://127.0.0.1:3080').replace(/\/+$/, '');
const chatCfg = {
  title: '朋友聊天',
  preset: 'friend-chat',
  // 人格就用管理员在 QQ 群里那份角色卡，改一处两边都变。
  promptFile: '我的提示词.md',
  sessionCwd: path.join(STATE_DIR, 'friend-agents'),
  tunnel: true,
  ...(cfg.friend ?? cfg.family ?? {}),
};

let TOKEN = '';
try { TOKEN = fs.readFileSync(TOKEN_FILE, 'utf8').trim(); } catch { /* 首次运行 */ }
if (!TOKEN || TOKEN.length < 16) {
  TOKEN = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(TOKEN_FILE, TOKEN, 'utf8');
  log('已生成聊天令牌并写入 state/friend-token');
}

let store = readJson(STORE_FILE, null) || { visitors: {}, history: {} };
store.visitors = store.visitors || {};
store.history = store.history || {};
let saveTimer = null;
function saveStore() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf8'); } catch (e) { log('保存失败', e?.message ?? e); }
  }, 500);
}

// 角色卡：每轮注入，改文件立刻生效。注释整块剥掉（和 qq-bridge 的规则保持一致）。
function readPersonaPrompt() {
  const file = path.join(ROOT, chatCfg.promptFile);
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return raw.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join('\n').trim();
  } catch { return ''; }
}

function beijingNow() {
  const now = new Date();
  const bj = new Date(now.getTime() + (now.getTimezoneOffset() + 480) * 60000);
  const p = (n) => String(n).padStart(2, '0');
  return `${bj.getFullYear()}-${p(bj.getMonth() + 1)}-${p(bj.getDate())} ${p(bj.getHours())}:${p(bj.getMinutes())}`;
}

function lanIp() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address;
    }
  }
  return '127.0.0.1';
}

// ── cloudflared 快速隧道 ──────────────────────────────────────────────────
let tunnelUrl = '';
let tunnelProc = null;
function writeUrlFile() {
  const lines = [
    `局域网上网: http://${lanIp()}:${PORT}/?t=${TOKEN}`,
    tunnelUrl ? `公网（哪里都能开）: ${tunnelUrl}/?t=${TOKEN}` : '公网: 隧道还没就绪',
    `本机: http://127.0.0.1:${PORT}/?t=${TOKEN}`
  ];
  try { fs.writeFileSync(URL_FILE, lines.join('\n') + '\n', 'utf8'); } catch { /* 无所谓 */ }
}
function startTunnel() {
  if (!chatCfg.tunnel) { log('配置里关掉了隧道（friend.tunnel=false）'); return; }
  const bin = chatCfg.cloudflared || path.join(ROOT, 'tools', 'cloudflared.exe');
  if (!fs.existsSync(bin)) {
    log(`没找到 cloudflared（${bin}），只提供局域网访问`);
    writeUrlFile();
    return;
  }
  log('启动 cloudflared 隧道…');
  try {
    tunnelProc = spawn(bin, ['tunnel', '--url', `http://127.0.0.1:${PORT}`, '--no-autoupdate'], { windowsHide: true });
  } catch (e) {
    log('隧道启动失败：', e?.message ?? String(e));
    return;
  }
  const scan = (buf) => {
    const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && m[0] !== tunnelUrl) {
      tunnelUrl = m[0];
      log(`公网地址已就绪: ${tunnelUrl}/?t=${TOKEN}`);
      writeUrlFile();
    }
  };
  tunnelProc.stdout?.on('data', scan);
  tunnelProc.stderr?.on('data', scan);
  tunnelProc.on('exit', (code) => {
    log(`隧道进程退出（code=${code}），10 秒后重开`);
    tunnelUrl = '';
    writeUrlFile();
    setTimeout(() => { if (chatCfg.tunnel) startTunnel(); }, 10000);
  });
}

// ── DSH 客户端 ────────────────────────────────────────────────────────────
const api = new NodeApiClient(dshBase, undefined, {
  token: cfg.dsh?.authToken,
  header: cfg.dsh?.authHeader,
  prefix: cfg.dsh?.authPrefix
});

const collectors = new Map();
const waiters = new Map();
const queues = new Map();
const rate = new Map();      // visitor -> number[]（时间戳）
let globalHits = [];         // 全局时间戳
let muxReady = false;

async function pumpMux() {
  for (;;) {
    try {
      log('连接 DSH 事件流…');
      // 事件流一连上就算就绪：不能等"收到第一个事件"才置位，
      // 否则没消息的时候页面上的状态点一直是红的（会让人以为坏了）。
      muxReady = true;
      for await (const envelope of api.events.mux({})) {
        const frame = envelope?.payload;
        if (!frame || frame.type !== 'session/event') continue;
        const collector = collectors.get(frame.sessionId);
        if (!collector) continue;
        let ended = null;
        try { ended = collector.push(frame.event); } catch (e) { log('collector 出错', e?.message ?? e); }
        if (!ended) continue;
        const w = waiters.get(frame.sessionId);
        collectors.delete(frame.sessionId);
        if (w) {
          waiters.delete(frame.sessionId);
          clearTimeout(w.timer);
          w.resolve(ended);
        }
      }
      muxReady = false;
      log('DSH 事件流结束，3 秒后重连');
    } catch (e) {
      muxReady = false;
      log('DSH 事件流断开：', e?.message ?? String(e));
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

async function ensureSession(visitor, displayName) {
  const rec = store.visitors[visitor];
  if (rec?.sessionId) return rec.sessionId;
  fs.mkdirSync(chatCfg.sessionCwd, { recursive: true });
  const ws = unwrap(await api.workspace.create({ path: chatCfg.sessionCwd }), 'workspace.create');
  const params = { workspaceId: ws.workspace.workspaceId };
  if (chatCfg.preset) params.agentPreset = chatCfg.preset;
  let created;
  try {
    created = unwrap(await api.sessions.create(params), 'session.create');
  } catch (e) {
    // preset 挂不上就明确失败，绝不退化成"无 preset 会话"——那会带上 DSH 默认
    // preset（含本地工具/全部 QQ 工具），对面就有了操作这台电脑的能力。
    throw new Error(`创建会话失败（preset ${chatCfg.preset}）：${e?.message ?? e}。请确认 ~/.dsh/.agent-presets/${chatCfg.preset}/ 存在，必要时重启 DSH。`);
  }
  api.events.follow(created.sessionId);
  store.visitors[visitor] = { name: String(displayName || '').slice(0, 24) || '朋友', sessionId: created.sessionId, createdAt: new Date().toISOString() };
  saveStore();
  log(`为 ${visitor}（${store.visitors[visitor].name}）创建会话 ${created.sessionId}`);
  return created.sessionId;
}

// 事件订阅是**跟着连接走**的。服务重启后 store 里的老会话还在，但 ensureSession
// 会因为"已存在"直接返回、跳过 follow —— 结果 mux 永远不推送那个会话的事件，
// 每一轮都卡到超时（实测 180 秒）。所以启动时必须把已登记的会话重新订阅一遍。
function refollowKnownSessions() {
  let n = 0;
  for (const rec of Object.values(store.visitors)) {
    if (!rec?.sessionId) continue;
    try { api.events.follow(rec.sessionId); n++; } catch (e) { log(`重新订阅 ${rec.sessionId} 失败：${e?.message ?? e}`); }
  }
  if (n) log(`已重新订阅 ${n} 个已有会话的事件`);
}

async function ask(visitor, displayName, text) {
  const sessionId = await ensureSession(visitor, displayName);
  const card = readPersonaPrompt();
  const promptText = [
    card ? `【角色卡】（管理员设置，最高优先级；其中关于 QQ 群 / 二代仿真模式 / 发送工具的部分在本场景不适用）\n${card}` : '',
    `【本次对话】网页一对一私聊。你的文字回复会直接显示给对方看，直接说话即可。现在是 ${beijingNow()}（北京时间）。`,
    `【对方说】\n${text}`
  ].filter(Boolean).join('\n\n');

  const collector = createTurnCollector();
  const deadline = Date.now() + TURN_TIMEOUT_MS;
  // 等"下一个回合结束"。可重复调用：每轮结束 mux 那边会把登记清掉，调用前要重新登记。
  const waitTurn = () => new Promise((resolve, reject) => {
    const remain = deadline - Date.now();
    if (remain <= 0) { reject(new Error('等回复超时（模型可能卡住了），再发一次试试')); return; }
    const timer = setTimeout(() => {
      waiters.delete(sessionId);
      collectors.delete(sessionId);
      // 超时多半是"事件流没跟上"（断线重连后订阅丢了）。补订阅一次，
      // 让下一次提问能正常收到事件，而不是一直卡到超时。
      try { api.events.follow(sessionId); } catch { /* 下一次提问会再试 */ }
      reject(new Error('等回复超时（模型可能卡住了），再发一次试试'));
    }, remain);
    waiters.set(sessionId, { resolve, reject, timer });
  });
  collectors.set(sessionId, collector);

  let accepted;
  try {
    accepted = await api.sessions.prompt({ sessionId, mode: 'queue', content: [{ type: 'text', text: promptText }] });
  } catch (e) {
    clearTimeout(waiters.get(sessionId)?.timer);
    waiters.delete(sessionId);
    collectors.delete(sessionId);
    throw new Error(`消息没送出去：${e?.message ?? e}`);
  }
  if (!accepted?.result?.ok) {
    clearTimeout(waiters.get(sessionId)?.timer);
    waiters.delete(sessionId);
    collectors.delete(sessionId);
    const err = accepted?.result?.error;
    throw new Error(`消息被拒绝：${err?.code ?? ''} ${err?.message ?? ''}`.trim());
  }
  if (accepted.result.value?.command) {
    waiters.delete(sessionId);
    collectors.delete(sessionId);
    return { text: String(accepted.result.value.command.text || '').trim() || '（命令没有输出）', command: true };
  }

  // 收回合。注意：不能拿到第一个"回合结束"就当成回复 ——
  // 实测踩过一次：重新订阅事件流时会把上一轮的尾巴一起带上来，
  // 于是空回合（没有 assistant 文本）先到，用户就收到"它这轮没说出话来"。
  // 所以空的回合不算，继续等真正那一轮；连续空太多次才认输。
  for (let attempt = 0; ; attempt += 1) {
    collectors.set(sessionId, collector); // mux 在回合结束时清掉了登记，这里补回
    const ended = await waitTurn();
    const reply = String(ended?.text || '').trim();
    if (reply) return { text: reply, reason: ended?.reason };
    if (attempt >= 6) return { text: '（它这轮没说出话来，你再问一次试试）', reason: ended?.reason };
    log(`收到一个空回合（turn=${ended?.turn}），继续等真正的回复…`);
  }
}

function pushHistory(visitor, role, text) {
  const list = store.history[visitor] || (store.history[visitor] = []);
  list.push({ role, text: String(text).slice(0, 4000), at: Date.now() });
  if (list.length > MAX_HISTORY) list.splice(0, list.length - MAX_HISTORY);
  saveStore();
}

function rateLimited(visitor) {
  const now = Date.now();
  globalHits = globalHits.filter((t) => now - t < GLOBAL_WINDOW_MS);
  if (globalHits.length >= GLOBAL_MAX) return '现在聊的人太多了，缓一分钟再试';
  const mine = (rate.get(visitor) || []).filter((t) => now - t < PER_VISITOR_WINDOW_MS);
  if (mine.length >= PER_VISITOR_MAX) return '你发得有点快，歇一会儿再聊';
  mine.push(now);
  rate.set(visitor, mine);
  globalHits.push(now);
  return '';
}

// ── HTTP ──────────────────────────────────────────────────────────────────
const SECURITY_HEADERS = {
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer'
};

function sendJson(res, obj, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...SECURITY_HEADERS });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 200000) { reject(new Error('请求体过大')); req.destroy(); }
    });
    req.on('end', () => {
      if (!data.trim()) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error('请求体必须是合法 JSON')); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`); } catch { res.writeHead(400); res.end(); return; }
  const supplied = url.searchParams.get('t') ?? req.headers['x-friend-token'];

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/chat')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS });
    try { res.end(fs.readFileSync(path.join(ROOT, 'public', 'friend.html'), 'utf8')); }
    catch { res.end('页面缺失：qq-bridge/public/friend.html'); }
    return;
  }
  if (url.pathname === '/api/chat/health') {
    sendJson(res, {
      ok: true, service: 'friend-chat', dshBase, muxReady,
      visitors: Object.keys(store.visitors).length,
      lan: `http://${lanIp()}:${PORT}/?t=${TOKEN}`,
      publicUrl: tunnelUrl ? `${tunnelUrl}/?t=${TOKEN}` : ''
    });
    return;
  }
  if (supplied !== TOKEN) { sendJson(res, { ok: false, error: '口令不对：请用带 ?t=口令 的链接打开' }, 401); return; }

  if (req.method === 'GET' && url.pathname === '/api/chat/history') {
    const visitor = String(url.searchParams.get('visitor') || '').slice(0, 64);
    sendJson(res, { ok: true, title: chatCfg.title, history: store.history[visitor] || [] });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/chat') {
    const body = await readBody(req).catch((e) => ({ __err: e.message }));
    if (body.__err) { sendJson(res, { ok: false, error: body.__err }, 400); return; }
    const visitor = String(body.visitor || '').slice(0, 64);
    const text = String(body.text || '').trim();
    if (!visitor) { sendJson(res, { ok: false, error: '缺少 visitor' }, 400); return; }
    if (!text) { sendJson(res, { ok: false, error: '消息是空的' }, 400); return; }
    if (text.length > 4000) { sendJson(res, { ok: false, error: '消息太长了（4000 字以内）' }, 400); return; }
    const limited = rateLimited(visitor);
    if (limited) { sendJson(res, { ok: false, error: limited }, 429); return; }
    const prev = queues.get(visitor) || Promise.resolve();
    const task = prev.then(async () => {
      pushHistory(visitor, 'user', text);
      const t0 = Date.now();
      const out = await ask(visitor, body.name, text);
      pushHistory(visitor, 'bot', out.text);
      log(`${visitor} 用时 ${Math.round((Date.now() - t0) / 1000)}s，回复 ${out.text.length} 字`);
      return out;
    });
    queues.set(visitor, task.catch(() => {}));
    try {
      const out = await task;
      sendJson(res, { ok: true, reply: out.text });
    } catch (e) {
      const msg = String(e?.message ?? e);
      log('问答失败：', msg);
      sendJson(res, { ok: false, error: msg }, 500);
    }
    return;
  }
  sendJson(res, { ok: false, error: '没有这个接口' }, 404);
});

server.listen(PORT, HOST, () => {
  log(`朋友聊天已启动：http://${HOST}:${PORT}/   （DSH ${dshBase}，预设 ${chatCfg.preset}，人格 ${chatCfg.promptFile}）`);
  log(`局域网: http://${lanIp()}:${PORT}/?t=${TOKEN}`);
  writeUrlFile();
  refollowKnownSessions();
  pumpMux();
  startTunnel();
});

process.on('SIGINT', () => { log('收到 Ctrl+C，退出'); try { tunnelProc?.kill(); } catch {} process.exit(0); });
process.on('uncaughtException', (e) => log('未捕获异常：', e?.stack ?? String(e)));
process.on('unhandledRejection', (e) => log('未处理的 Promise 拒绝：', e?.stack ?? String(e)));

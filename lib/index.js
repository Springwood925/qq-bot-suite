// qq-bot-suite — DSH 插件
//
// 两块东西：
//  ① Host 侧（本文件）：只读检测 QQ 机器人栈状态 + 提供 `GET /qq-bot-suite/console-url`
//     给前端拿"带 token 的控制台地址"。
//  ② Client 侧（client.js）：在插件详情页（slot `plugins.bundle.config`）渲染状态 + 按钮。
//
// ⚠️ 本插件的启动职责边界（2026-10-19 晚更新，用户需求升级为「我启动 DSH ＝ 机器人开始跑」）：
//   ✅ **允许**：静默拉起 `qqbot-guard.vbs`（隐藏窗口、detached、幂等检查）
//   ❌ **仍然禁止**：自己 spawn SnowLuma 或桥。
//      原因：SnowLuma 的 native hook 与**它自带的 node.exe** 版本绑定，
//      用系统 node 起的进程注入不了 QQ，而且 vbs 的判活（比 ExecutablePath）认不出它
//      ⇒ 会变成"一假一真"两个进程抢资源。启动顺序与用哪个 node 全部交给 vbs。
//
// 可以做：拉起守护、检测 SnowLuma(:3000/:3001) / 桥(:3100) / 账号状态，写日志，提供控制台地址
// 不可以做：自己起 SnowLuma/桥、自动登录 QQ、改 MCP 配置
import { existsSync, appendFileSync, mkdirSync, readFileSync, readdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import os from 'node:os';

// 插件包根目录（lib/ 的上一级）—— 分享版把桥放在 <包>/bridge/ 里
const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLED_BRIDGE = join(PKG_ROOT, 'bridge');

/** 开发机专用：外部桥路径从本机状态文件读，绝不写死在代码里。
 *  ~/.dsh/qq-bot-suite/config.json 的 { "devBridgeDir": "<path>" }
 *  分享出去的包里没有这个文件 ⇒ 永远走内置桥。 */
function readDevBridgeDir() {
  const p = join(os.homedir(), '.dsh', 'qq-bot-suite', 'config.json');
  try {
    // 去掉 BOM：记事本 / PowerShell Set-Content 都会写 BOM，带 BOM 时 JSON.parse 会直接失败
    const raw = readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
    const j = JSON.parse(raw);
    return typeof j.devBridgeDir === 'string' ? j.devBridgeDir.trim() : '';
  } catch {
    return '';
  }
}
const DEV_BRIDGE = readDevBridgeDir();

/** 决定用哪个桥目录：
 *  ① 本机配了 devBridgeDir 且那目录真的有 guard → 用它（开发机，行为完全不变）；
 *  ② 否则用插件自带的 <包>/bridge（分享出去的形态）。
 *  ⚠️ 顺序不能反：内置桥优先会让开发机跑一份没有 config.json 的空壳。 */
function pickBridgeDir() {
  if (DEV_BRIDGE && existsSync(join(DEV_BRIDGE, 'qqbot-guard.vbs'))) return DEV_BRIDGE;
  return BUNDLED_BRIDGE;
}

const CFG = {
  enabled: true,
  bridgeDir: pickBridgeDir(),
  snowHttp: 'http://127.0.0.1:3000',
  startDelayMs: 8000,
  // 2026-10-19 用户需求升级为「我启动 DSH ＝ 机器人开始跑」。
  // 这里**只拉起守护进程 qqbot-guard.vbs**，由它去起 SnowLuma（用自带的 node.exe）+ 桥。
  // 插件自己仍然绝不 spawn SnowLuma —— 否则又会起出"假进程"抢 QQ。
  autoStartGuard: true,
  guardDelayMs: 3000, // 等 DSH 自己的服务就绪再拉守护，避免桥起来时 DSH 还没在听
};

const SNOWEXE = 'E:\\QQAgent\\QQ Agent\\resources\\app\\snowluma\\node.exe';
const LOG = join(os.homedir(), '.dsh', 'qq-bot-suite.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    mkdirSync(dirname(LOG), { recursive: true });
    appendFileSync(LOG, line, 'utf8');
  } catch {}
  try { console.log('[qq-bot-suite] ' + msg); } catch {}
}

function run(cmdline) {
  try {
    return execFileSync(process.env.ComSpec || 'cmd.exe', ['/c', cmdline], {
      encoding: 'utf8', timeout: 10000, windowsHide: true,
    });
  } catch {
    return '';
  }
}

function isListening(port) {
  const out = run(`netstat -ano | findstr LISTENING | findstr :${port}`);
  return out.split(/\r?\n/).some((l) => l.includes(`:${port}`) && l.includes('LISTENING'));
}

/** 跑一段 PowerShell，返回 stdout（用 -EncodedCommand 传，避开引号转义地狱） */
function runPS(script) {
  try {
    const enc = Buffer.from(script, 'utf16le').toString('base64');
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', enc], {
      encoding: 'utf8', timeout: 12000, windowsHide: true,
    });
  } catch {
    return null;
  }
}

/** 真身 SnowLuma 进程数。
 *  ⚠️ **不能用 `wmic`** —— Windows 11 24H2 起 WMIC 已被移除（本机实测 `'wmic' 不是内部或外部命令`），
 *  之前拿它判断 ⇒ 永远返回 0 ⇒ 面板一直显示"真身进程 0 个"。
 *  返回 -1 表示"没测出来"（区别于 0 = 确实没有）。 */
function countSnowReal() {
  const out = runPS('Get-CimInstance Win32_Process -Filter "Name=\'node.exe\'" | Select-Object -ExpandProperty ExecutablePath');
  if (out === null) return -1;
  return out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((p) => p.toLowerCase() === SNOWEXE.toLowerCase()).length;
}

/** 用错 node 起的"假" snowluma（命令行含 snowluma 但 ExecutablePath 不是真身）
 *  ⚠️ 必须排除 MCP 子进程：`mcp-snowluma-safe.js` / `mcp-host-server.js` 的命令行里也有
 *  "snowluma"，路径又是系统 node —— 不排除的话会把它们全算成"假 SnowLuma"（误报）。 */
function countSnowFake() {
  const out = runPS('Get-CimInstance Win32_Process -Filter "Name=\'node.exe\'" | Where-Object { $_.CommandLine -match \'snowluma\' -and $_.CommandLine -notmatch \'mcp-\' } | ForEach-Object { $_.ExecutablePath }');
  if (out === null) return -1;
  return out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((p) => p.toLowerCase() !== SNOWEXE.toLowerCase()).length;
}

/** qqbot-guard.vbs 在不在跑（看 wscript.exe 的命令行里有没有 qqbot-guard.vbs）。
 *  这是「启动 DSH = 启动机器人」的幂等判据：已经在跑就不再拉第二个。 */
function guardRunning() {
  const out = runPS('Get-CimInstance Win32_Process -Filter "Name=\'wscript.exe\'" | ForEach-Object { $_.CommandLine }');
  if (out === null) return false;
  return out.includes('qqbot-guard.vbs');
}

/** 静默拉起守护进程（隐藏窗口、脱离父进程）。
 *  ⚠️ **只拉 qqbot-guard.vbs，绝不自己 spawn SnowLuma / 桥** ——
 *  SnowLuma 的 native hook 与它自带的 node.exe 版本绑定，用系统 node 起的是"假进程"，
 *  而且 vbs 的判活比 ExecutablePath，认不出假进程 ⇒ 会一假一真抢 QQ。
 *  启动顺序与用哪个 node，全部由 vbs 决定。 */
function ensureGuard() {
  if (!CFG.autoStartGuard) { log('autoStartGuard=false，跳过拉起守护'); return 'skipped'; }
  if (guardRunning()) { log('qqbot-guard.vbs 已在跑，跳过拉起'); return 'already'; }
  const vbs = resolve(CFG.bridgeDir, 'qqbot-guard.vbs');
  if (!existsSync(vbs)) { log('❌ 找不到 ' + vbs); return 'missing'; }
  try {
    const child = spawn('wscript.exe', [vbs], {
      cwd: CFG.bridgeDir,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    log('✅ 已静默拉起 qqbot-guard.vbs（它将按正确顺序启动 SnowLuma + 桥）');
    return 'started';
  } catch (e) {
    log('❌ 拉起守护失败: ' + (e && e.message ? e.message : String(e)));
    return 'error';
  }
}

/** 读桥的 console-token */
function readConsoleToken() {
  try {
    const p = resolve(CFG.bridgeDir, 'state', 'console-token');
    if (!existsSync(p)) return '';
    return readFileSync(p, 'utf8').trim();
  } catch {
    return '';
  }
}

async function getAccount() {
  try {
    const cfgPath = join(CFG.bridgeDir, 'config.json');
    if (!existsSync(cfgPath)) return null;
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    const token = cfg?.snowluma?.httpAccessToken;
    if (!token) return null;
    const res = await fetch(CFG.snowHttp + '/get_login_info', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: '{}',
      signal: AbortSignal.timeout(6000),
    });
    const j = await res.json();
    return j?.data?.user_id ? { nick: j.data.nickname, qq: String(j.data.user_id) } : null;
  } catch {
    return null;
  }
}

/** 汇总一次状态快照（只读） */
async function snapshot() {
  const snowPort = isListening(3000) && isListening(3001);
  const bridgePort = isListening(3100);
  const real = countSnowReal();
  const fake = countSnowFake();
  const account = snowPort ? await getAccount() : null;
  let verdict;
  if (snowPort && bridgePort && account) verdict = 'ok';
  else if (!snowPort && real > 0) verdict = 'waiting-login';
  else if (!bridgePort) verdict = 'bridge-down';
  else verdict = 'degraded';
  return { snowPort, bridgePort, real, fake, account, verdict };
}

/** 带 console token 请求桥的一个端点 */
async function bridgeGet(path) {
  const tok = readConsoleToken();
  if (!tok) throw new Error('console-token 不存在（桥没起过？）');
  const res = await fetch('http://127.0.0.1:3100' + path, {
    headers: { 'x-console-token': tok },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

// 代理白名单：前端只能通过这些桥端点（防滥用；全是控制台自己用的那几个）
const PROXY_GET = new Set([
  '/api/status',
  '/api/socialV2/states',
  '/api/socialV2/config',
  '/api/usage',
  '/api/wx/status',
  '/api/wx/chats',
  '/api/slang',
  '/api/stickers',
  '/api/whitelist',
  '/api/groups',
  '/api/sessions',
  '/api/pending',
  '/api/roles',
  '/api/custom-prompt',
  '/api/mode',
]);
const PROXY_POST = new Set([
  '/api/socialV2/wake-config',
  '/api/socialV2/config',
  '/api/socialV2/wake',
  '/api/socialV2/reset',
  '/api/socialV2/r18',
  '/api/socialV2/persona',
  '/api/whitelist',
  '/api/wx/whitelist',
  '/api/wx/enabled',
  '/api/slang/research',
  '/api/slang/batch-confirm',
  '/api/slang/batch-reject',
  '/api/slang/batch-delete',
  '/api/slang/extract',
  '/api/stickers/sync',
  '/api/role',
  '/api/role-mode',
  '/api/mode',
]);

/** 读请求体（JSON） */
function readBody(req, limit = 1024 * 512) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) { reject(new Error('bad json: ' + e.message)); }
    });
    req.on('error', reject);
  });
}

/** 代理一次写请求到桥 */
async function bridgeProxy(method, path, body) {
  const tok = readConsoleToken();
  if (!tok) throw new Error('console-token 不存在（桥没起过？）');
  const init = { method, headers: { 'x-console-token': tok }, signal: AbortSignal.timeout(20000) };
  if (method === 'POST') {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body || {});
  }
  const res = await fetch('http://127.0.0.1:3100' + path, init);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 400) }; }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${json && json.error ? json.error : ''}`);
  return json;
}

/** 唤醒配置 → 响应档位（0~100）。与 public/status.html 的 configToLevel 等价。 */
function configToLevel(cfg, kwCount) {
  const c = cfg || {};
  const tg = c.triggers || {};
  if (tg.anyMessage === true || c.mode === 'active') return 100;
  const hasKw = (Number(kwCount) || 0) > 0;
  const p = Number(tg.probability) || 0;
  if (!hasKw) {
    if (!tg.nameMention && !tg.question) return 0;
    return 10;
  }
  if (p <= 0) return 40;
  if (p <= 0.1) return Math.round(50 + (p / 0.1) * 25);
  return Math.round(75 + Math.min(1, (p - 0.1) / 0.4) * 24);
}

/** 组装面板数据：把桥的几个只读端点压成前端好画的一份 JSON */
async function buildPanel() {
  const base = await snapshot();
  const out = {
    ok: true,
    at: Date.now(),
    host: base,
    bridge: null,
    usage: null,
    wx: null,
    error: '',
  };
  if (!base.bridgePort) {
    out.ok = false;
    out.error = '桥(:3100) 没在监听';
    return out;
  }
  const grab = async (p) => {
    try { return await bridgeGet(p); } catch (e) { return { __error: e && e.message ? e.message : String(e) }; }
  };
  const [status, states, usage, wx] = await Promise.all([
    grab('/api/status'),
    grab('/api/socialV2/states'),
    grab('/api/usage'),
    grab('/api/wx/status'),
  ]);

  if (status && !status.__error) {
    out.bridge = {
      mode: status.mode,
      role: status.role,
      roleMode: status.roleMode,
      dshReady: Boolean(status.dshReady),
      socialV2Paused: Boolean(status.socialV2Paused),
      ownerQQ: status.ownerQQ,
      allowGroups: status.allowGroups || [],
      allowPrivate: status.allowPrivate || [],
      // 活动流取最近 6 行（原文是带时间戳的多行串）
      activity: String(status.activity || '').split('\n').filter(Boolean).slice(-6),
    };
  } else {
    out.bridge = { __error: (status && status.__error) || '读取失败' };
  }

  // 各会话：key / 唤醒模式 / 未读数 / 最后回复 / 最近唤醒原因 / **完整 wakeConfig + 算好的档位**
  // ⚠️ wakeConfig 必须原样带上：client 要用它算档位，保存时还要保留原 keywords。
  //    第一版我把它剔掉了 ⇒ 前端拿到 undefined ⇒ 档位全算成 0（用户当场发现"滑条怎么全是0"）。
  if (states && Array.isArray(states.conversations)) {
    out.conversations = states.conversations.map((c) => {
      const wc = c.wakeConfig || null;
      const kw = Array.isArray(wc?.triggers?.keywords) ? wc.triggers.keywords : [];
      return {
        key: c.key,
        mode: wc?.mode || '?',
        infinite: Boolean(wc?.infinite),
        wakeConfig: wc,
        keywords: kw,
        level: configToLevel(wc, kw.length),
        unread: Number(c.unreadCount) || 0,
        recent: Number(c.recentCount) || 0,
        lastReplyAt: c.lastAiReplyAt || 0,
        lastWakeReason: c.lastWakeReason || '',
        persona: c.persona || '',
        paused: Boolean(c.participationLocked),
      };
    });
  } else {
    out.conversations = [];
  }

  if (usage && !usage.__error) {
    // ⚠️ 桥已经把总计算好了，就在 usage.total 里。
    // costIdle / costPeak 是「同一份用量按闲时价 / 峰时价各算一遍」的两个口径，
    // 正确用法是按 nowPeak 二选一，**绝不能相加**（相加 = 费用翻倍）。
    const t = usage.total || {};
    out.usage = {
      nowPeak: Boolean(usage.nowPeak),
      model: usage.price?.model || '',
      priceNow: usage.nowPeak ? usage.price?.peak : usage.price?.idle,
      peakRule: usage.price?.peakRule || '',
      turns: Number(t.turns) || 0,
      steps: Number(t.steps) || 0,
      cacheRead: Number(t.cacheRead) || 0,
      uncached: Number(t.uncached) || 0,
      output: Number(t.output) || 0,
      hitRate: Number(t.hitRate) || 0,
      stepsPerTurn: Number(t.stepsPerTurn) || 0,
      cost: Number(usage.nowPeak ? t.costPeak : t.costIdle) || 0,
      sessions: (usage.sessions || []).map((s) => ({
        key: s.key,
        ok: Boolean(s.ok),
        error: s.error || '',
        turns: Number(s.turns) || 0,
        steps: Number(s.steps) || 0,
        hitRate: Number(s.hitRate) || 0,
        cacheRead: Number(s.cacheRead) || 0,
        uncached: Number(s.uncached) || 0,
        output: Number(s.output) || 0,
        cost: Number(usage.nowPeak ? s.costPeak : s.costIdle) || 0,
      })),
    };
  } else {
    out.usage = { __error: (usage && usage.__error) || '读取失败' };
  }

  if (wx && !wx.__error) {
    out.wx = {
      enabled: Boolean(wx.enabled),
      allowPrivate: (wx.allow?.private || []).length,
      allowGroups: (wx.allow?.groups || []).length,
      queueLength: wx.queueLength ?? 0,
      sending: Boolean(wx.sending),
      eventTotal: wx.eventTotal ?? 0,
    };
  } else {
    out.wx = { __error: (wx && wx.__error) || '读取失败' };
  }

  return out;
}

export const name = 'qq-bot-suite';
export const inject = ['webServer'];

// ═══════════════════════════════════════════════════════════════════════════
// 分享版：环境检测 + 配置生成（2026-10-20 加）
//   目标：朋友装好插件后，面板能自己把 config.json 生成出来，不用手填文件。
//   ⚠️ 安全约束：只在内置桥上写；外部桥（开发机）一律拒写，防覆盖生产配置。
// ═══════════════════════════════════════════════════════════════════════════

/** 这个目录像不像 SnowLuma：有 index.mjs + node.exe + config/ */
function isSnowLumaDir(dir) {
  if (!dir || !existsSync(dir)) return false;
  if (!existsSync(join(dir, 'index.mjs')) || !existsSync(join(dir, 'node.exe'))) return false;
  return existsSync(join(dir, 'config'));
}

/** A+B 里的 A：扫常见路径。扫不到由面板让用户手填（B）。 */
function findSnowLumaDir() {
  const home = os.homedir();
  const la = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
  const candidates = [
    'E:\\QQAgent\\QQ Agent\\resources\\app\\snowluma',
    'C:\\QQAgent\\QQ Agent\\resources\\app\\snowluma',
    'D:\\QQAgent\\QQ Agent\\resources\\app\\snowluma',
    join('C:\\', 'Program Files', 'SnowLuma'),
    join('C:\\', 'Program Files (x86)', 'SnowLuma'),
    join(la, 'Programs', 'SnowLuma'),
    join(la, 'SnowLuma'),
    join(home, 'SnowLuma'),
    join(home, 'Desktop', 'SnowLuma'),
    join(home, 'Downloads', 'SnowLuma'),
    'E:\\SnowLuma',
    'D:\\SnowLuma',
  ];
  const found = [];
  for (const c of candidates) if (isSnowLumaDir(c) && !found.includes(c)) found.push(c);
  try {
    for (const e of readdirSync(join(home, 'Downloads'), { withFileTypes: true })) {
      if (e.isDirectory() && /snowluma/i.test(e.name)) {
        const p = join(home, 'Downloads', e.name);
        if (isSnowLumaDir(p) && !found.includes(p)) found.push(p);
      }
    }
  } catch {}
  return found;
}

/** 读 SnowLuma 的 OneBot 账号配置（每个 QQ 账号一个 onebot_<uin>.json） */
function readOneBotAccounts(snowDir) {
  const cfgDir = join(snowDir, 'config');
  const out = [];
  let files = [];
  try { files = readdirSync(cfgDir).filter((f) => /^onebot_\d+\.json$/.test(f)); } catch { return out; }
  for (const f of files) {
    const uin = f.match(/^onebot_(\d+)\.json$/)[1];
    let j;
    try { j = JSON.parse(readFileSync(join(cfgDir, f), 'utf8')); } catch { continue; }
    const http = j?.networks?.httpServers?.[0] || null;
    const ws = j?.networks?.wsServers?.[0] || null;
    out.push({
      uin,
      httpPort: http?.port ?? null,
      httpToken: http?.accessToken || '',
      wsPort: ws?.port ?? null,
      wsToken: ws?.accessToken || '',
      hasNetwork: Boolean(http || ws),
    });
  }
  return out;
}

/** 用插件自带的 config.example.json 做模板，填出可用的 config.json */
function buildBridgeConfig({ snowDir, uin, ownerQQ, groups }) {
  const exPath = join(CFG.bridgeDir, 'config.example.json');
  if (!existsSync(exPath)) throw new Error('找不到 config.example.json：' + exPath);
  const cfg = JSON.parse(readFileSync(exPath, 'utf8'));
  const acc = readOneBotAccounts(snowDir).find((a) => a.uin === String(uin));
  if (!acc) throw new Error(`SnowLuma 里没有 uin=${uin} 的配置`);
  if (!acc.hasNetwork) throw new Error(`uin=${uin} 还没配 OneBot 网络（先去 SnowLuma 给这个账号加 HTTP/WS）`);

  cfg.snowluma.homeDir = snowDir;
  cfg.snowluma.httpUrl = `http://127.0.0.1:${acc.httpPort || 3000}`;
  cfg.snowluma.wsUrl = `ws://127.0.0.1:${acc.wsPort || 3001}`;
  cfg.snowluma.accessToken = acc.wsToken || '';
  cfg.snowluma.httpAccessToken = acc.httpToken || '';

  const owner = Number(ownerQQ) || 0;
  cfg.ownerQQ = owner || 123456789;
  cfg.allow = { private: owner ? [owner] : [], groups: Array.isArray(groups) ? groups.map(Number).filter(Boolean) : [] };
  cfg.deny = { private: [], groups: [] };

  // 控制台令牌：24 字节 hex = 48 位，与原版长度一致
  cfg.consoleToken = crypto.randomBytes(24).toString('hex');
  if (cfg.dsh) cfg.dsh.baseUrl = 'auto';
  return cfg;
}

/** 写到内置桥目录；已存在先备份。外部桥一律拒写。 */
function writeBridgeConfig(cfgObj, { force = false } = {}) {
  if (CFG.bridgeDir !== BUNDLED_BRIDGE && !force) {
    throw new Error('当前是外部桥（开发机），拒绝写入以免覆盖正在跑的 config.json');
  }
  const target = join(CFG.bridgeDir, 'config.json');
  if (existsSync(target)) {
    const bak = `${target}.bak-${Date.now()}`;
    copyFileSync(target, bak);
    log(`已有 config.json 已备份 → ${bak}`);
  }
  writeFileSync(target, JSON.stringify(cfgObj, null, 2), 'utf8');

  // 顺手写 snowluma-path.txt —— qqbot-guard.vbs / 启动QQ机器人.vbs 里的
  // ResolveSnowDir() 会优先读它，这样桥和守护都能找到用户实际的 SnowLuma 位置。
  const snowDir = cfgObj?.snowluma?.homeDir;
  if (snowDir) {
    try {
      writeFileSync(join(CFG.bridgeDir, 'snowluma-path.txt'), snowDir, 'utf8');
      log(`已写 snowluma-path.txt → ${snowDir}`);
    } catch (e) {
      log(`写 snowluma-path.txt 失败（不影响其他功能）：${e?.message ?? e}`);
    }
  }
  return target;
}

/** 把桥在 DSH 里装好：preset + 三个 MCP + qq-mode-console。外部桥拒调（会改真实 profile）。 */
function installDshIntegration(profile = 'desktop') {
  if (CFG.bridgeDir !== BUNDLED_BRIDGE) {
    throw new Error('当前是外部桥（开发机），拒绝改写 DSH profile');
  }
  const script = join(CFG.bridgeDir, 'scripts', 'setup-dsh.mjs');
  if (!existsSync(script)) throw new Error('找不到 setup-dsh.mjs：' + script);
  const out = execFileSync('node', [script, profile], {
    encoding: 'utf8',
    timeout: 180000,
    windowsHide: true,
  });
  return String(out || '').trim();
}

export function apply(ctx) {
  log('=== apply() 进入（形态 Y：只检测不启动）===');

  // ---- Host 端点 ①：给前端拿控制台地址（保留：面板里"完整控制台"链接仍有用）----
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: '/qq-bot-suite/console-url',
      handler: async (req, res) => {
        const tok = readConsoleToken();
        const body = JSON.stringify({
          url: tok ? `http://127.0.0.1:3100/status?token=${encodeURIComponent(tok)}` : '',
          ready: Boolean(tok),
        });
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(body);
      },
    }),
  );

  // ---- Host 端点 ②：面板数据聚合（代理桥的 API，token 只在 host 用，前端看不到）----
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: '/qq-bot-suite/panel',
      handler: async (req, res) => {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        try {
          res.end(JSON.stringify(await buildPanel()));
        } catch (e) {
          res.end(JSON.stringify({ ok: false, error: e && e.message ? e.message : String(e) }));
        }
      },
    }),
  );

  // ---- Host 端点 ③：受白名单限制的桥代理（面板上的所有交互都走它）----
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: '/qq-bot-suite/api',
      handler: async (req, res) => {
        const send = (code, obj) => {
          res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
          res.end(JSON.stringify(obj));
        };
        try {
          let u;
          try { u = new URL(req.url, 'http://127.0.0.1'); } catch { return send(400, { ok: false, error: 'bad url' }); }
          const path = u.searchParams.get('path') || '';
          const method = (req.method || 'GET').toUpperCase();
          if (method === 'GET') {
            if (!PROXY_GET.has(path)) return send(403, { ok: false, error: 'path not allowed: ' + path });
            return send(200, { ok: true, data: await bridgeGet(path) });
          }
          if (method === 'POST') {
            if (!PROXY_POST.has(path)) return send(403, { ok: false, error: 'path not allowed: ' + path });
            const body = await readBody(req);
            return send(200, { ok: true, data: await bridgeProxy('POST', path, body) });
          }
          return send(405, { ok: false, error: 'method not allowed' });
        } catch (e) {
          send(200, { ok: false, error: e && e.message ? e.message : String(e) });
        }
      },
    }),
  );

  // ---- Host 端点 ④：SnowLuma 环境检测（分享版向导第一步）----
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: '/qq-bot-suite/snowluma/detect',
      handler: async (req, res) => {
        const send = (code, obj) => {
          res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
          res.end(JSON.stringify(obj));
        };
        try {
          const dirs = findSnowLumaDir();
          const snowDir = dirs[0] || '';
          const accounts = snowDir ? readOneBotAccounts(snowDir) : [];
          const isBundled = CFG.bridgeDir === BUNDLED_BRIDGE;
          send(200, {
            ok: true,
            bridgeDir: CFG.bridgeDir,
            isBundled,
            found: dirs,
            snowDir,
            accounts,
            hasConfig: existsSync(join(CFG.bridgeDir, 'config.json')),
            canWrite: isBundled,
          });
        } catch (e) {
          send(200, { ok: false, error: e && e.message ? e.message : String(e) });
        }
      },
    }),
  );

  // ---- Host 端点 ⑤：按向导填的值生成 config.json（只在内部桥上写）----
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: '/qq-bot-suite/snowluma/config',
      handler: async (req, res) => {
        const send = (code, obj) => {
          res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
          res.end(JSON.stringify(obj));
        };
        if ((req.method || 'GET').toUpperCase() !== 'POST') return send(405, { ok: false, error: 'POST only' });
        try {
          const raw = await readBody(req);
          const body = raw ? JSON.parse(raw) : {};
          const cfg = buildBridgeConfig(body);
          const target = writeBridgeConfig(cfg);
          log(`已生成 config.json → ${target}（uin=${body.uin} owner=${body.ownerQQ} groups=${JSON.stringify(cfg.allow.groups)}）`);

          // 顺手把桥在 DSH 里装好（preset + MCP + qq-mode-console）。
          // 失败不算致命：配置已经写出去了，可以让用户手工跑 setup-dsh.mjs。
          let installLog = '';
          let installOk = false;
          try {
            installLog = installDshIntegration(body.profile || 'desktop');
            installOk = true;
            log('[setup] DSH 集成完成（preset + MCP + qq-mode-console）');
          } catch (e) {
            installLog = 'DSH 集成失败：' + (e && e.message ? e.message : String(e));
            log('[setup] ' + installLog);
          }

          send(200, {
            ok: true,
            target,
            installOk,
            installLog,
            consoleToken: cfg.consoleToken,
            ownerQQ: cfg.ownerQQ,
            groups: cfg.allow.groups,
            snowluma: { httpUrl: cfg.snowluma.httpUrl, wsUrl: cfg.snowluma.wsUrl },
          });
        } catch (e) {
          send(200, { ok: false, error: e && e.message ? e.message : String(e) });
        }
      },
    }),
  );

  // ---- ① 拉起守护（「启动 DSH = 启动机器人」的主线）② 状态检测 + 日志 ----
  const timer = setTimeout(async () => {
    if (!CFG.enabled) { log('已禁用，跳过'); return; }

    // ① 幂等地把守护拉起来 —— 它负责起 SnowLuma（自带 node）+ 桥
    await new Promise((r) => setTimeout(r, CFG.guardDelayMs));
    const g = ensureGuard();
    log('守护检查: ' + g);

    // ② 刚拉起来的话给链路一点启动时间，别立刻报"未监听"吓人
    if (g === 'started') {
      log('守护刚启动，等 25 秒再检测状态…');
      await new Promise((r) => setTimeout(r, 25000));
    }

    const s = await snapshot();
    log(`SnowLuma: 端口 ${s.snowPort ? '✅ 3000/3001 在听' : '❌ 未监听'} | 真身进程 ${s.real} 个${s.fake > 0 ? ` | ⚠️ 假进程 ${s.fake} 个（用错 node，注入不了 QQ）` : ''}`);
    log(`桥: 端口 ${s.bridgePort ? '✅ 3100 在听' : '❌ 未监听'}`);
    log(s.account ? `账号在线: ${s.account.nick} (${s.account.qq})` : '账号: 拿不到（SnowLuma 未就绪或未登录）');
    switch (s.verdict) {
      case 'ok': log('✅ 一切正常'); break;
      case 'waiting-login': log('建议: SnowLuma 进程在但端口不通 ⇒ 可能在等 QQ 登录，打开 QQ 扫码；不要重复启动'); break;
      case 'bridge-down': log('建议: 桥没起 ⇒ 双击「启动QQ机器人.vbs」或等 qqbot-guard.vbs 拉起'); break;
      default: log('建议: 有组件未就绪，见上面几行');
    }
    log('=== apply() 完成 ===');
  }, CFG.startDelayMs);

  ctx.effect(() => () => {
    clearTimeout(timer);
    log('插件卸载（本插件不持任何子进程）');
  });
}

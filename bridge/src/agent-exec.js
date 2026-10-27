// 管理员私聊本地执行器（2026-10-20）
//
// 用途：让 QQ 私聊里的机器人在「管理员本人」的私聊中具备本地执行能力
//        （读文件 / 写文件 / 精确替换 / 找文件 / 搜内容 / 跑命令）。
//
// 设计约束（按项目既定姿势"给屎山加功能"）：
//  1) 不 import bridge.js —— 需要的依赖全部由 bridge.js 注入，本文件零外部耦合；
//  2) 只在管理员私聊生效 —— bridge.js 路由层已做 key 鉴权，本文件再自查一次；
//  3) 危险动作二次确认 —— 覆盖已有文件 / 改已有文件 / 破坏性命令，
//     必须先让管理员本人回一句确认词（"干"/"确认"…）；
//     确认状态由 bridge.js 维护（管理员私聊收到确认词时打时间戳），本文件只查询；
//  4) 输出一律截断，避免把上下文撑爆。

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const MAX_OUTPUT_CHARS = 8000;
const MAX_READ_LINES = 800;
const MAX_READ_CHARS = 60000;
const DEFAULT_TIMEOUT_MS = 120000;
const MAX_TIMEOUT_MS = 600000;
const MAX_ARG_PATH = 4096;

// ── 危险动作判定 ────────────────────────────────────────────────────────────

// 破坏性命令特征。命中即要求二次确认。
// 注意：宁可误报（多问一句），不可漏报。
// 2026-10-22 改：
//   ① 每条带人话 label —— 给用户看的是「结束进程」而不是正则源码
//   ② format 收窄成 format-volume —— 原 \bformat\b 会误伤 Format-Table / -Format / ImageFormat
const DANGEROUS_COMMAND_PATTERNS = [
  // scope: 'file'   = 跟目录有关，工作区内的可免确认
  // scope: 'system' = 跟目录无关（杀进程/改注册表/格式化），永远要确认
  // 删除类（含常见别名）
  { re: /\b(rm|ri|del|erase|rmdir|rd|remove-item)\b/i, label: '删除文件或目录', scope: 'file' },
  // 格式化 / 分区
  { re: /\b(format-volume|diskpart|mkfs)\b/i, label: '格式化磁盘或分区', scope: 'system' },
  // 移动 / 改名（可能覆盖）
  { re: /\b(move-item|mv|move|ren|rename-item)\b/i, label: '移动或改名（可能覆盖）', scope: 'file' },
  // 停服 / 杀进程
  { re: /\b(stop-process|kill|taskkill|stop-service|sc\s+stop|schtasks\s+\/delete)\b/i, label: '结束进程或停服务', scope: 'system' },
  // 破坏性 git
  { re: /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|checkout\s+--|push\s+--force|branch\s+-D|filter-branch)\b/i, label: '破坏性 git 操作', scope: 'file' },
  // 覆盖写（重定向到已存在文件 / 常用写文件命令）
  { re: /\bset-content\b/i, label: '覆盖写入文件', scope: 'file' },
  { re: /\bout-file\b/i, label: '覆盖写入文件', scope: 'file' },
  { re: /\btruncate\b/i, label: '清空文件', scope: 'file' },
  // 注册表写
  { re: /\b(reg\s+add|reg\s+delete|remove-itemproperty|new-itemproperty)\b/i, label: '修改注册表', scope: 'system' },
  // 权限 / 所有权
  { re: /\b(icacls|takeown|chmod|chown)\b/i, label: '修改权限或所有权', scope: 'system' }
];

/** 返回命中的人话标签（未命中返回 null） */
function isDangerousCommand(command) {
  const text = String(command ?? '');
  for (const p of DANGEROUS_COMMAND_PATTERNS) {
    if (p.re.test(text)) return { label: p.label, scope: p.scope };
  }
  return null;
}

/** 只挑出命中的那一行（给确认消息做预览，别把整段脚本甩给用户） */
function dangerousSnippet(command) {
  const text = String(command ?? '');
  const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
  for (const line of lines) {
    for (const p of DANGEROUS_COMMAND_PATTERNS) {
      if (p.re.test(line)) {
        return line.length > 120 ? `${line.slice(0, 120)}…` : line;
      }
    }
  }
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > 120 ? `${one.slice(0, 120)}…` : one;
}

/** 从命令里挑出「要动的那个东西」——给确认消息说人话用 */
function describeTarget(command) {
  const text = String(command ?? '');
  // git 特殊处理：目标 = 子命令 + 参数（否则会只提出 "reset"）
  const git = text.match(/^git\s+([^\n]+)/i);
  if (git) {
    const rest = git[1].replace(/\s+/g, ' ').trim();
    return rest.length > 60 ? rest.slice(0, 60) + '…' : rest;
  }
  const m = text.match(/-(?:Path|LiteralPath|Destination|Id|Name)\s+["']?([^"'\s;|&)]+)/i);
  if (m) return m[1];
  const firstLine = text.split('\n')[0].trim();
  const m2 = firstLine.match(/^[\w.-]+\s+["']?([^"'\s;|&)]+)/);
  if (m2 && !m2[1].startsWith('-')) return m2[1];
  return firstLine.length > 60 ? firstLine.slice(0, 60) + '…' : firstLine;
}

/** 命令摘要：单行短命令给原文；多行脚本只给行数 + 首句 */
function summarizeCommand(command) {
  const text = String(command ?? '').trim();
  const lines = text.split('\n').filter((s) => s.trim());
  const squeeze = (s) => s.replace(/\s+/g, ' ').trim();
  if (lines.length <= 1) {
    const one = squeeze(lines[0] || '');
    return one.length > 100 ? one.slice(0, 100) + '…' : one;
  }
  const first = squeeze(lines[0]);
  return `（脚本共 ${lines.length} 行）${first.length > 60 ? first.slice(0, 60) + '…' : first}`;
}

// ── 工作区（2026-10-22 用户拍板：工作区内的「文件类」操作免确认，系统级永远确认）──
const SAFE_WORKSPACE_NAME = '_agent-workspace';

function safeWorkspaceOf(rootDir) {
  return path.join(String(rootDir || process.cwd()), SAFE_WORKSPACE_NAME);
}

function isInsidePath(child, root) {
  try {
    const a = path.resolve(String(child || '')).toLowerCase();
    const b = path.resolve(String(root || '')).toLowerCase();
    return a === b || a.startsWith(b + path.sep);
  } catch {
    return false;
  }
}

/** 命令里是否引用了工作区外的盘符路径（防止 cwd 在内、命令删到外面） */
function hasOutsidePath(command, workspace) {
  const matches = String(command ?? '').match(/[A-Za-z]:\\[^\s"'`;|&)]+/g) || [];
  return matches.some((p) => !isInsidePath(p, workspace));
}

// ── 工具调用预算（2026-10-22 加，治「单回合跑飞」）──────────────────────────
// 起因：2026-10-22 17:12-17:25，一个回合里 qq_agent_pwsh 被调 45 次、记忆写入 21 次、
//       总共 119 次调用、跑了 13 分钟，还在反复发登录码又改口说「误报」。
// 历史分布（1511 个回合）：P95 = 24 次、P99 = 43 次；机器人正常长对话最高 74 次，
//   但那是 qq_wait_for_messages + qq_send_message 交替（真在聊天），不是跑飞。
// ⇒ 所以只对「干活类」工具限次，聊天类（wait/send/mark_read 等不经过这里）不受影响。
const OP_BUDGETS = { pwsh: 30, write: 20 };
const TOTAL_BUDGET = 100;
const BUDGET_IDLE_RESET_MS = 60_000; // 空闲 60 秒视为新回合

const toolBudgets = new Map(); // key -> { total, perOp, lastAt }

/** 超限返回错误文字，未超返回 null */
function checkToolBudget(key, op) {
  const now = Date.now();
  let b = toolBudgets.get(key);
  if (!b || now - b.lastAt > BUDGET_IDLE_RESET_MS) {
    b = { total: 0, perOp: {}, lastAt: now };
    toolBudgets.set(key, b);
  }
  b.total += 1;
  b.perOp[op] = (b.perOp[op] || 0) + 1;
  b.lastAt = now;

  const limit = OP_BUDGETS[op];
  if (limit && b.perOp[op] > limit) {
    return `已中止：本回合 ${op} 已调用 ${b.perOp[op]} 次（上限 ${limit}）。你可能在重复同样的操作 —— 换个思路，或者停下来问用户。`;
  }
  if (b.total > TOTAL_BUDGET) {
    return `已中止：本回合工具调用已达 ${b.total} 次（上限 ${TOTAL_BUDGET}）。停下来问用户下一步怎么做。`;
  }
  return null;
}

// ── 输出工具 ────────────────────────────────────────────────────────────────

function clip(text, head = 6000, tail = 2000) {
  const s = String(text ?? '');
  if (s.length <= MAX_OUTPUT_CHARS) return s;
  return `${s.slice(0, head)}\n\n…（中间 ${s.length - head - tail} 字符已截断）…\n\n${s.slice(-tail)}`;
}

function ok(payload) {
  return { ok: true, ...payload };
}

function fail(error, extra = {}) {
  return { ok: false, error: String(error), ...extra };
}

// 需要二次确认时返回这个结构：bridge.js 会把它变成一条 QQ 消息发给管理员。
function needConfirm({ action, detail, preview }) {
  return {
    ok: false,
    needsConfirm: true,
    action,
    detail,
    preview: clip(preview ?? '', 1500, 500),
    // 2026-10-23：不再由桥发死模板 —— 让模型用自己的口气问（用户要求「走一遍人格提示词」）。
    // 这个字段是给模型看的引导，不会被直接发给用户。
    askUser: [
      `需要用户点头的操作：${action}`,
      `${detail}`,
      '',
      '⚠️ 桥不会替你发任何消息，也**没有**「确认请求已推送」这回事——',
      '必须你自己调用 qq_send_message 发一条问句给用户。',
      '这条问句里要说清：要做什么、目标是什么、在哪个目录。',
      '⚠️ 目录必须写完整路径（例如 D:\\path\\to\\project），不要只说「当前目录」「工作目录」——用户看不出你在哪儿动。',
      '用你平时说话的口气，别列清单别用表格。',
      '用户回「干/确认/ok/行/嗯」这类就再调一次同样的工具。'
    ].join('\n')
  };
}

// ── 路径处理 ────────────────────────────────────────────────────────────────

function normPath(p, rootDir) {
  const raw = String(p ?? '').trim();
  if (!raw) throw new Error('路径不能为空');
  if (raw.length > MAX_ARG_PATH) throw new Error('路径过长');
  return path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(rootDir, raw);
}

// ── 主体 ────────────────────────────────────────────────────────────────────

/**
 * @param {object} deps
 * @param {(msg:string)=>void} deps.log              桥的日志函数
 * @param {string} deps.rootDir                      默认工作目录
 * @param {()=>string} deps.ownerKey                 管理员私聊的会话 key
 * @param {()=>boolean} deps.isApproved              最近是否刚拿到管理员确认
 * @param {(key:string,text:string)=>Promise<void>} [deps.sendText] 给管理员发一条 QQ 消息
 */
export function createAgentExec({ log, rootDir, ownerKey, isApproved, sendText }) {
  const cwdRoot = rootDir || process.cwd();
  let shellReadyPromise = null;

  function assertOwner(key) {
    const expected = String(ownerKey() ?? '');
    if (!expected) throw new Error('管理员会话未配置');
    if (String(key ?? '') !== expected) {
      throw new Error('本地执行能力仅在管理员私聊可用');
    }
  }

  // 第一次跑命令时探测可用的 PowerShell，缓存结果。
  function resolveShell() {
    if (shellReadyPromise) return shellReadyPromise;
    const candidates = ['pwsh.exe', 'pwsh', 'powershell.exe', 'powershell'];
    shellReadyPromise = new Promise((resolve) => {
      let i = 0;
      const probe = () => {
        if (i >= candidates.length) { resolve(null); return; }
        const bin = candidates[i];
        execFile(bin, ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major'],
          { timeout: 15000, windowsHide: true, maxBuffer: 1024 * 1024 },
          (error, stdout) => {
            if (!error && String(stdout ?? '').trim()) { resolve(bin); return; }
            i += 1;
            probe();
          });
      };
      probe();
    });
    return shellReadyPromise;
  }

  function runShell(bin, command, cwd, timeoutMs) {
    return new Promise((resolve) => {
      execFile(bin, ['-NoProfile', '-NonInteractive', '-Command', command], {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
        encoding: 'utf8'
      }, (error, stdout, stderr) => {
        const timedOut = !!error && (error.killed || error.signal === 'SIGTERM');
        resolve({
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          exitCode: error ? (typeof error.code === 'number' ? error.code : -1) : 0,
          timedOut,
          errorMessage: error && !timedOut ? String(error.message ?? error) : ''
        });
      });
    });
  }

  // ── 各操作 ─────────────────────────────────────────────────────────────

  function doRead({ file_path, offset, limit }) {
    const abs = normPath(file_path, cwdRoot);
    const st = fs.statSync(abs);
    if (st.isDirectory()) return fail(`${abs} 是目录，不是文件（用 qq_agent_glob 或命令列目录）`);
    const raw = fs.readFileSync(abs, 'utf8');
    const lines = raw.split('\n');
    const start = Math.max(1, Number(offset) || 1);
    const want = Math.max(1, Math.min(Number(limit) || 2000, MAX_READ_LINES));
    const slice = lines.slice(start - 1, start - 1 + want);
    const numbered = slice.map((line, i) => `${start + i}\t${line}`).join('\n');
    const truncated = start - 1 + want < lines.length;
    return ok({
      path: abs,
      totalLines: lines.length,
      from: start,
      to: start + slice.length - 1,
      truncated,
      content: clip(numbered, MAX_READ_CHARS, 2000)
    });
  }

  function doWrite({ file_path, content }) {
    const abs = normPath(file_path, cwdRoot);
    const text = String(content ?? '');
    const exists = fs.existsSync(abs);
    if (exists) {
      const before = fs.readFileSync(abs, 'utf8');
      if (before === text) {
        return ok({ path: abs, changed: false, note: '内容相同，未写入' });
      }
      if (!isApproved()) {
        return needConfirm({
          action: '覆盖已有文件',
          detail: `将覆盖 ${abs}（原 ${before.length} 字符 → 新 ${text.length} 字符）`,
          preview: text
        });
      }
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text, 'utf8');
    return ok({ path: abs, changed: true, bytes: Buffer.byteLength(text, 'utf8') });
  }

  function doEdit({ file_path, old_string, new_string, replace_all }) {
    const abs = normPath(file_path, cwdRoot);
    if (!fs.existsSync(abs)) return fail(`文件不存在：${abs}`);
    const before = fs.readFileSync(abs, 'utf8');
    const oldText = String(old_string ?? '');
    const newText = String(new_string ?? '');
    if (!oldText) return fail('old_string 不能为空');

    const count = before.split(oldText).length - 1;
    if (count === 0) return fail(`在 ${abs} 中找不到要替换的文本（一字不差地复制原文，包括缩进）`);
    if (count > 1 && !replace_all) {
      return fail(`要替换的文本在文件里出现 ${count} 次，不唯一。请把 old_string 写长一些以保证唯一，或传 replace_all=true`);
    }
    if (!isApproved()) {
      return needConfirm({
        action: '修改已有文件',
        detail: `将在 ${abs} 中替换 ${count} 处`,
        preview: `- ${oldText.slice(0, 600)}\n+ ${newText.slice(0, 600)}`
      });
    }
    const after = replace_all ? before.split(oldText).join(newText) : before.replace(oldText, newText);
    if (after === before) return ok({ path: abs, changed: false, note: '替换后内容相同' });
    fs.writeFileSync(abs, after, 'utf8');
    return ok({ path: abs, changed: true, replaced: count, bytes: Buffer.byteLength(after, 'utf8') });
  }

  function doGlob({ pattern, path: base, max_results }) {
    const baseDir = base ? normPath(base, cwdRoot) : cwdRoot;
    if (!fs.existsSync(baseDir)) return fail(`目录不存在：${baseDir}`);
    const pat = String(pattern ?? '').trim();
    if (!pat) return fail('pattern 不能为空');
    const limit = Math.max(1, Math.min(Number(max_results) || 100, 500));

    // 把 glob 转成正则：** 任意层，* 单层，? 单字符
    const source = pat
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '\u0001')
      .replace(/\*/g, '[^/\\\\]*')
      .replace(/\?/g, '[^/\\\\]')
      .replace(/\u0001/g, '.*');
    const re = new RegExp(`^${source}$`, 'i');

    const out = [];
    const walk = (dir, depth) => {
      if (out.length >= limit || depth > 12) return;
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (out.length >= limit) return;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '.git') continue;
          walk(full, depth + 1);
        } else if (entry.isFile()) {
          const rel = path.relative(baseDir, full).split(path.sep).join('/');
          if (re.test(rel) || re.test(entry.name)) {
            let size = 0;
            try { size = fs.statSync(full).size; } catch {}
            out.push({ path: full, size });
          }
        }
      }
    };
    walk(baseDir, 0);
    return ok({ base: baseDir, pattern: pat, count: out.length, truncated: out.length >= limit, files: out });
  }

  function doGrep({ pattern, path: base, glob: include, max_matches, ignore_case }) {
    const baseDir = base ? normPath(base, cwdRoot) : cwdRoot;
    const pat = String(pattern ?? '');
    if (!pat) return fail('pattern 不能为空');
    let re;
    try {
      re = new RegExp(pat, ignore_case === false ? '' : 'i');
    } catch (e) {
      return fail(`正则表达式无效：${e?.message ?? e}`);
    }
    const limit = Math.max(1, Math.min(Number(max_matches) || 80, 300));
    const includeRe = include
      ? new RegExp(`^${String(include).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '[^/\\\\]*')}$`, 'i')
      : null;

    const matches = [];
    const walk = (dir, depth) => {
      if (matches.length >= limit || depth > 12) return;
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (matches.length >= limit) return;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '.git') continue;
          walk(full, depth + 1);
          continue;
        }
        if (!entry.isFile()) continue;
        if (includeRe && !includeRe.test(entry.name) && !includeRe.test(path.relative(baseDir, full).split(path.sep).join('/'))) continue;
        let size = 0;
        try { size = fs.statSync(full).size; } catch {}
        if (size > 8 * 1024 * 1024) continue; // 跳过超大文件
        let text;
        try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
        if (text.indexOf('\u0000') >= 0) continue; // 二进制
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i += 1) {
          if (matches.length >= limit) break;
          if (re.test(lines[i])) {
            matches.push({ path: full, line: i + 1, text: lines[i].slice(0, 300) });
          }
        }
      }
    };
    walk(baseDir, 0);
    return ok({ base: baseDir, pattern: pat, count: matches.length, truncated: matches.length >= limit, matches });
  }

  async function doPwsh({ command, cwd, timeoutMs }) {
    const cmd = String(command ?? '').trim();
    if (!cmd) return fail('command 不能为空');
    const workDir = cwd ? normPath(cwd, cwdRoot) : cwdRoot;
    if (!fs.existsSync(workDir)) return fail(`工作目录不存在：${workDir}`);

    const danger = isDangerousCommand(cmd);
    if (danger && !isApproved()) {
      // 工作区内的文件类操作免确认；系统级操作永远确认
      const ws = safeWorkspaceOf(cwdRoot);
      const canSkip = danger.scope === 'file' && isInsidePath(workDir, ws) && !hasOutsidePath(cmd, ws);
      if (canSkip) {
        log(`[agent-exec] 工作区内免确认：${danger.label} @ ${workDir}`);
      } else {
        return needConfirm({
          action: danger.label,
          detail: `目标：${describeTarget(cmd)}\n位置：${workDir}`,
          preview: summarizeCommand(cmd)
        });
      }
    }

    const shell = await resolveShell();
    if (!shell) return fail('找不到可用的 PowerShell（pwsh / powershell 都不可用）');

    const timeout = Math.max(1000, Math.min(Number(timeoutMs) || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS));
    const started = Date.now();
    const res = await runShell(shell, cmd, workDir, timeout);
    const elapsedMs = Date.now() - started;

    log(`[agent-exec] pwsh (${shell}) ${elapsedMs}ms exit=${res.exitCode}${res.timedOut ? ' TIMEOUT' : ''} cwd=${workDir}`);

    return ok({
      shell,
      cwd: workDir,
      exitCode: res.exitCode,
      timedOut: res.timedOut,
      elapsedMs,
      stdout: clip(res.stdout, 6000, 2000),
      stderr: clip(res.stderr, 2000, 800),
      errorMessage: res.errorMessage
    });
  }

  function doLs({ path: target }) {
    const abs = target ? normPath(target, cwdRoot) : cwdRoot;
    if (!fs.existsSync(abs)) return fail(`路径不存在：${abs}`);
    const st = fs.statSync(abs);
    if (!st.isDirectory()) return fail(`${abs} 不是目录`);
    const entries = fs.readdirSync(abs, { withFileTypes: true }).map((e) => {
      let size = 0;
      let mtime = '';
      try {
        const s = fs.statSync(path.join(abs, e.name));
        size = s.size;
        mtime = s.mtime.toISOString();
      } catch {}
      return { name: e.name, type: e.isDirectory() ? 'dir' : (e.isFile() ? 'file' : 'other'), size, mtime };
    });
    return ok({ path: abs, count: entries.length, entries });
  }

  // ── 对外唯一入口 ────────────────────────────────────────────────────────

  const HANDLERS = {
    read: doRead,
    write: doWrite,
    edit: doEdit,
    glob: doGlob,
    grep: doGrep,
    pwsh: doPwsh,
    ls: doLs
  };

  /**
   * 执行一次本地操作。
   * @param {{ op:string, args:object, key:string }} req
   */
  async function handle({ op, args, key }) {
    try {
      assertOwner(key);
    } catch (e) {
      return fail(e.message);
    }
    // 单回合预算检查（只有 read/write/edit/glob/grep/pwsh/ls 会经过这里，
    // 聊天类工具走的是 MCP server 另一条路，不受影响）
    const opName = String(op ?? '').trim();
    const budgetErr = checkToolBudget(key, opName);
    if (budgetErr) {
      log(`[agent-exec] 预算拦截 ${opName} (${key})`);
      return fail(budgetErr);
    }
    const handler = HANDLERS[opName];
    if (!handler) return fail(`未知操作 "${op}"（支持：${Object.keys(HANDLERS).join(' / ')}）`);
    try {
      const result = await handler(args || {});
      // 2026-10-23：不再由这里直接发模板。needConfirm 里带了 askUser，
      // 模型会看到工具结果，用它自己的口吻问用户（走人格提示词）。
      // 兜底：如果模型没开口（极端情况），5 分钟后确认窗口自然失效，不会挂住。
      if (result && result.needsConfirm) {
        log(`[agent-exec] 需要确认（交给模型开口）：${result.action} @ ${key}`);
      }
      return result;
    } catch (e) {
      log(`[agent-exec] ${op} 失败：${e?.message ?? e}`);
      return fail(`${op} 执行失败：${e?.message ?? e}`);
    }
  }

  return { handle, _isDangerousCommand: isDangerousCommand };
}

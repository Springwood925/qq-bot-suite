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
const DANGEROUS_COMMAND_PATTERNS = [
  // 删除类（含常见别名）
  /\b(rm|ri|del|erase|rmdir|rd|remove-item)\b/i,
  // 格式化 / 分区
  /\b(format|diskpart|mkfs)\b/i,
  // 移动 / 改名（可能覆盖）
  /\b(move-item|mv|move|ren|rename-item)\b/i,
  // 停服 / 杀进程
  /\b(stop-process|kill|taskkill|stop-service|sc\s+stop|schtasks\s+\/delete)\b/i,
  // 破坏性 git
  /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|checkout\s+--|push\s+--force|branch\s+-D|filter-branch)\b/i,
  // 覆盖写（重定向到已存在文件 / 常用写文件命令）
  /\bset-content\b/i,
  /\bout-file\b/i,
  /\btruncate\b/i,
  // 注册表写
  /\b(reg\s+add|reg\s+delete|remove-itemproperty|new-itemproperty)\b/i,
  // 权限 / 所有权
  /\b(icacls|takeown|chmod|chown)\b/i
];

function isDangerousCommand(command) {
  const text = String(command ?? '');
  const hit = DANGEROUS_COMMAND_PATTERNS.find((re) => re.test(text));
  return hit ? hit.source : null;
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
    preview: clip(preview ?? '', 1500, 500)
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
      return needConfirm({
        action: '执行破坏性命令',
        detail: `命中危险特征「${danger}」\n工作目录：${workDir}`,
        preview: cmd
      });
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
    const handler = HANDLERS[String(op ?? '').trim()];
    if (!handler) return fail(`未知操作 "${op}"（支持：${Object.keys(HANDLERS).join(' / ')}）`);
    try {
      const result = await handler(args || {});
      // 需要确认时顺手问管理员一句，模型不必自己记得发
      if (result && result.needsConfirm && typeof sendText === 'function') {
        const text = [
          `⚠️ 我要${result.action}`,
          result.detail,
          '',
          '预览：',
          result.preview,
          '',
          '回复「干」我就执行'
        ].join('\n');
        sendText(key, text).catch((e) => log(`[agent-exec] 确认消息发送失败：${e?.message ?? e}`));
      }
      return result;
    } catch (e) {
      log(`[agent-exec] ${op} 失败：${e?.message ?? e}`);
      return fail(`${op} 执行失败：${e?.message ?? e}`);
    }
  }

  return { handle, _isDangerousCommand: isDangerousCommand };
}

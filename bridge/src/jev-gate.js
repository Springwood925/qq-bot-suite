// ─────────────────────────────────────────────────────────────────────────────
// Jev 式接话判定旁路（本地小模型 · 2026-09-25 加）
//
// 只做一件事：桥准备"主动开口"时，在原有的概率判定**之外**再问一次本地小模型
// 「这轮值不值得接一句」。判定范式对齐 TypeSafe「Jev」：不生成文本、只吐标签，
// 用 grammar 硬约束输出、靠 logprobs 取标签概率与前二名间隔。
//
// 三条铁律（改这个文件之前先读）：
//   ① **任何失败 / 超时 / 起不来 / 弃权 → 一律放行**（allow: true）。
//      它只是"多加一道闸"，绝不能变成"新功能挂了、老功能也不说话"。
//   ② **默认关**（config.json：socialV2.proactive.jev.enabled），开了才生效。
//   ③ 判定用的提示词形状**必须和蒸馏训练时一致**（instruction + few-shot +
//      「这句话: X」+「答案:」）—— 这个 0.8B 是在该形状上微调的，换形状分数会掉。
//      另：**别往里加新条件** —— 上游实测「加条件 = 净有害」（9/11 → 7/11）。
//
// 上游出处：QQ Agent 整合版 src/local-jev.js（jevReplyChance / buildJevPrompt）。
// 本文件是重新实现的旁路，不复制其代码，只沿用其已验证的口径。
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const DEFAULT_PORT = 18080;
const DEFAULT_TIMEOUT_MS = 2500;
const DEFAULT_MIN_CONF = 0.6;
const DEFAULT_MIN_MARGIN = 1.0;
const DEFAULT_CTX_MESSAGES = 6;
const SERVER_BOOT_TIMEOUT_MS = 20000;

// ── 判定规格：只在这里定义一次 ────────────────────────────────────────────────
const LABELS = ['YES', 'NO'];
const POSITIVE = 'YES';
const INSTRUCTION = '群里没人在跟机器人说话。判断现在值不值得主动插一句（顺着大家的话题聊、接个梗、捧个场、补充一句）。别人的私事、情绪宣泄、告别收尾、纯语气词都不该插。';
const EXAMPLES = [
  ['今天食堂的鱼香肉丝居然不甜', 'YES'],
  ['这天气说降就降 冻手', 'YES'],
  ['新出的那个手柄手感还行', 'YES'],
  ['家里有点事 先不聊了', 'NO'],
  ['嗯', 'NO'],
  ['下周的报表记得交', 'NO']
];
// grammar：硬约束成标签本身（YES|NO 都是单 token，不存在前缀归属问题）
const GRAMMAR = `root ::= ${LABELS.map((l) => `"${l}"`).join(' | ')}`;

// ── 运行状态（给诊断/面板用）─────────────────────────────────────────────────
const state = {
  proc: null, starting: null, ready: false, lastError: '',
  asked: 0, allowed: 0, blocked: 0, abstained: 0, failed: 0,
  lastMs: 0, lastLabel: '', lastP: 0, lastMargin: 0, lastReason: ''
};

export function jevGateStatus() {
  return {
    ready: state.ready && !!state.proc && state.proc.exitCode == null,
    pid: state.proc?.pid ?? null,
    lastError: state.lastError,
    asked: state.asked, allowed: state.allowed, blocked: state.blocked,
    abstained: state.abstained, failed: state.failed,
    lastMs: state.lastMs, lastLabel: state.lastLabel,
    lastP: state.lastP, lastMargin: state.lastMargin, lastReason: state.lastReason
  };
}

function resolvePath(p) {
  const s = String(p || '').trim();
  if (!s) return '';
  return path.isAbsolute(s) ? s : path.join(ROOT, s);
}

function baseUrl(port) { return `http://127.0.0.1:${port}`; }

async function healthOk(port, timeoutMs = 1500) {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const res = await fetch(`${baseUrl(port)}/health`, { signal: ac.signal });
    clearTimeout(timer);
    if (!res.ok) return false;
    const j = await res.json().catch(() => null);
    return j?.status === 'ok';
  } catch { return false; }
}

/** 懒启动本地 llama-server；已有一个健康的同端口实例就直接复用。 */
async function ensureServer(cfg) {
  const exe = resolvePath(cfg?.exePath);
  const model = resolvePath(cfg?.modelPath);
  const port = Number(cfg?.port) || DEFAULT_PORT;
  if (!exe || !model) return { ok: false, reason: '未配置 exePath / modelPath' };
  if (!fs.existsSync(exe)) return { ok: false, reason: `找不到 ${path.basename(exe)}` };
  if (!fs.existsSync(model)) return { ok: false, reason: `找不到 ${path.basename(model)}` };

  if (state.ready && state.proc && state.proc.exitCode == null) return { ok: true };
  if (await healthOk(port)) { state.ready = true; return { ok: true, reused: true }; }
  if (state.starting) return state.starting;

  state.starting = (async () => {
    try {
      if (state.proc && state.proc.exitCode == null) {
        try { state.proc.kill(); } catch { /* ignore */ }
        state.proc = null;
      }
      const args = [
        '--model', model,
        '--host', '127.0.0.1',
        '--port', String(port),
        '--ctx-size', '2048',
        '--parallel', '1',
        '--n-predict', '16',
        '--no-warmup'
      ];
      const proc = spawn(exe, args, { cwd: path.dirname(exe), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      state.proc = proc;
      state.ready = false;
      state.lastError = '';
      proc.stdout?.on('data', () => { /* quiet */ });
      proc.stderr?.on('data', (buf) => {
        const s = String(buf || '');
        if (/error|failed|exception/i.test(s)) state.lastError = s.trim().slice(0, 240);
      });
      proc.on('exit', (code) => {
        state.proc = null; state.ready = false;
        if (code != null && code !== 0) state.lastError = `llama-server exit ${code}`;
      });
      // 等它就绪（首次加载模型通常几百毫秒 ~ 几秒）
      const t0 = Date.now();
      while (Date.now() - t0 < SERVER_BOOT_TIMEOUT_MS) {
        if (proc.exitCode != null) return { ok: false, reason: state.lastError || `llama-server 退出（code ${proc.exitCode}）` };
        if (await healthOk(port, 1200)) { state.ready = true; return { ok: true, bootMs: Date.now() - t0 }; }
        await new Promise((r) => setTimeout(r, 400));
      }
      return { ok: false, reason: `启动超时（${SERVER_BOOT_TIMEOUT_MS}ms）` };
    } catch (error) {
      return { ok: false, reason: String(error?.message ?? error) };
    } finally {
      state.starting = null;
    }
  })();
  return state.starting;
}

/** 把最近几条消息压成一行「刚聊的」，形状对齐上游 probe。 */
export function buildProbe(recentMessages, maxMessages = DEFAULT_CTX_MESSAGES, maxChars = 160) {
  const list = Array.isArray(recentMessages) ? recentMessages.slice(-Math.max(1, maxMessages)) : [];
  const lines = [];
  for (const m of list) {
    const who = m?.isSelf ? '我' : String(m?.sender ?? '某人').slice(0, 12);
    const text = String(m?.plain ?? m?.text ?? '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    lines.push(`${who}：${text.slice(0, 40)}`);
  }
  return lines.join(' / ').slice(0, maxChars);
}

/** 拼接与蒸馏训练一致的提示词（system / user 两条）。 */
export function buildJevPrompt(probe) {
  const system = `只输出一个词，必须是：${LABELS.join(' / ')}。不许有别的内容。`;
  const user = [
    INSTRUCTION,
    ...EXAMPLES.map((e) => `例: ${e[0]} → ${e[1]}`),
    `这句话: ${String(probe ?? '').slice(0, 160)}`,
    '答案:'
  ].filter(Boolean).join('\n');
  return { system, user };
}

/** 从 logprobs 里取标签概率；取不到返回 null（=> 弃权）。 */
function labelProbability(lp, label) {
  const tops = lp?.top_logprobs;
  if (!Array.isArray(tops)) return null;
  const hit = tops.find((x) => String(x?.token ?? '').trim() === label);
  return hit ? Math.exp(Number(hit.logprob)) : null;
}

function topTwoMargin(lp) {
  const tops = Array.isArray(lp?.top_logprobs) ? lp.top_logprobs : [];
  if (tops.length < 2) return 0;
  const a = Number(tops[0]?.logprob);
  const b = Number(tops[1]?.logprob);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return a - b;
}

/**
 * 主动开口前的 Jev 闸。
 * @returns {Promise<{allow:boolean, label?:string, p?:number, margin?:number, abstain?:boolean, ms?:number, reason?:string}>}
 *          **allow:true = 放行**（也是所有异常路径的返回值）。
 */
export async function jevAllowProactive({ recentMessages = [], cfg = {} } = {}) {
  const started = Date.now();
  try {
    const enabled = cfg?.enabled === true;
    if (!enabled) return { allow: true, reason: '未启用' };

    const probe = buildProbe(recentMessages, Number(cfg.contextMessages) || DEFAULT_CTX_MESSAGES);
    if (!probe) return { allow: true, reason: '没有可判的内容' };

    state.asked += 1;
    const up = await ensureServer(cfg);
    if (!up.ok) { state.failed += 1; state.lastError = up.reason || 'not-ready'; return { allow: true, reason: `本地模型不可用：${up.reason}` }; }

    const port = Number(cfg.port) || DEFAULT_PORT;
    const timeoutMs = Number(cfg.timeoutMs) || DEFAULT_TIMEOUT_MS;
    const { system, user } = buildJevPrompt(probe);
    const body = {
      model: 'jev',
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0,
      max_tokens: 6,
      stream: false,
      logprobs: true,
      top_logprobs: 12,
      grammar: GRAMMAR,
      // Qwen3.5 是混合思考模型：不关思考时输出会全进 reasoning_content、content 为空
      enable_thinking: false,
      chat_template_kwargs: { enable_thinking: false },
      thinking: { type: 'disabled' }
    };
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    let data = null;
    try {
      const res = await fetch(`${baseUrl(port)}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: ac.signal
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    } finally { clearTimeout(timer); }

    const ms = Date.now() - started;
    const choice = data?.choices?.[0];
    const raw = String(choice?.message?.content ?? '').trim();
    const lp = choice?.logprobs?.content?.[0];
    const p = labelProbability(lp, raw);
    const margin = topTwoMargin(lp);

    if (!LABELS.includes(raw) || p == null) {
      state.abstained += 1;
      state.lastMs = ms; state.lastLabel = raw; state.lastP = p ?? 0; state.lastMargin = margin;
      state.lastReason = `无法取到标签概率（raw=${raw || '空'}）`;
      return { allow: true, abstain: true, label: raw, ms, reason: state.lastReason };
    }

    const minConf = Number(cfg.minConfidence);
    const minMargin = Number(cfg.minMargin);
    const needConf = Number.isFinite(minConf) ? minConf : DEFAULT_MIN_CONF;
    const needMargin = Number.isFinite(minMargin) ? minMargin : DEFAULT_MIN_MARGIN;

    state.lastMs = ms; state.lastLabel = raw; state.lastP = p; state.lastMargin = margin;
    // 弃权（不够硬）=> 放行，等于没有这道闸
    if (p < needConf || margin < needMargin) {
      state.abstained += 1;
      state.lastReason = `弃权：p=${p.toFixed(2)} margin=${margin.toFixed(2)}`;
      return { allow: true, abstain: true, label: raw, p, margin, ms, reason: state.lastReason };
    }
    if (raw === POSITIVE) {
      state.allowed += 1;
      state.lastReason = `放行：${raw} p=${p.toFixed(2)} margin=${margin.toFixed(2)}`;
      return { allow: true, label: raw, p, margin, ms, reason: state.lastReason };
    }
    state.blocked += 1;
    state.lastReason = `拦截：${raw} p=${p.toFixed(2)} margin=${margin.toFixed(2)}`;
    return { allow: false, label: raw, p, margin, ms, reason: state.lastReason };
  } catch (error) {
    state.failed += 1;
    state.lastError = String(error?.message ?? error).slice(0, 200);
    state.lastReason = `异常：${state.lastError}`;
    return { allow: true, ms: Date.now() - started, reason: state.lastReason };
  }
}

/** 桥退出时收尾（进程不留在后台）。 */
export function stopJevGate() {
  try {
    if (state.proc && state.proc.exitCode == null) state.proc.kill();
  } catch { /* ignore */ }
  state.proc = null;
  state.ready = false;
}

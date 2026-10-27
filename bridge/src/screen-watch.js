/**
 * screen-watch.js —— 屏幕陪看（机器人侧）。
 *
 * 复用 dsh-whale-sense 的截屏帮工（src/screen-sense.py）：每 interval 截一张屏，
 * 和上一张 64×36 灰度缩略图比差异；差异够大、过冷却，就把整图存成 jpg 并吐 JSON。
 *
 * 本模块只做三件事：
 *   ① spawn/重启 Python 帮工、解析事件；
 *   ② 变化时调 codexMedia.analyze（走 Codex 订阅，不花 API 钱）拿到画面描述；
 *   ③ 把最近的观察存进内存，供 buildWakePromptV2 注入【最近屏幕】。
 *
 * 默认关闭（enabled=false）：开了才会自动分析，否则只留着帮工不反应。
 * 配置在 qq-bridge/screen-watch.json，可通过 /api/screen-watch/config 改。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PYTHON_CANDIDATES = [
  process.env.SCREEN_WATCH_PYTHON,
  'python.exe',
  'python3',
  'python'
];

const DEFAULTS = {
  enabled: false,
  intervalMs: 2500,
  threshold: 0.07,
  cooldownMs: 45000,
  maxWidth: 1280,
  maxPerHour: 20,
  windowMatch: '',
  analyze: true,
  maxObservations: 5
};

function findPython() {
  for (const candidate of PYTHON_CANDIDATES) {
    if (!candidate) continue;
    if (!path.isAbsolute(candidate)) return candidate;
    try { if (fs.existsSync(candidate)) return candidate; } catch { /* ignore */ }
  }
  return 'python';
}

export function createScreenWatch({ root, log = () => {}, codexMedia = null }) {
  const configPath = path.join(root, 'screen-watch.json');
  const stateDir = path.join(root, 'state', 'screen-watch');
  const framesDir = path.join(stateDir, 'frames');
  const scriptPath = path.join(root, 'src', 'screen-sense.py');

  let config = loadConfig();
  let helper = null;
  let ready = false;
  let disposed = false;
  let restarts = 0;
  let restartTimer = null;
  let buffer = '';
  let lastError = '';
  let lastEvent = null;
  let analyzing = false;
  let pendingEvent = null;
  let lastAnalyzeAt = 0;
  const reactTimes = [];
  const observations = [];   // { at, title, score, path, description }

  function loadConfig() {
    try {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function saveConfig(next) {
    try {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(next, null, 2), 'utf8');
    } catch (error) {
      log('屏幕陪看：配置写入失败 ' + String(error?.message ?? error));
    }
  }

  function start() {
    if (helper !== null && helper.exitCode === null) return helper;
    disposed = false;
    try {
      fs.mkdirSync(framesDir, { recursive: true });
      helper = spawn(findPython(), [scriptPath], {
        cwd: root,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1', SENSE_OUT_DIR: framesDir }
      });
    } catch (error) {
      lastError = String(error?.message ?? error);
      log('屏幕陪看：帮工启动失败 ' + lastError);
      return null;
    }
    ready = false;
    buffer = '';
    helper.stdout.setEncoding('utf8');
    helper.stdout.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        try { handleEvent(JSON.parse(line)); } catch { /* 非协议输出忽略 */ }
      }
    });
    helper.stderr?.on('data', (chunk) => {
      const text = chunk.toString('utf8').trim();
      if (text && /(Error|Traceback|Exception|失败)/.test(text)) lastError = text.slice(-400);
    });
    helper.on('exit', () => {
      helper = null;
      ready = false;
      if (disposed) return;
      restarts += 1;
      const delay = Math.min(30000, 2000 * restarts);
      restartTimer = setTimeout(() => {
        restartTimer = null;
        if (!disposed) start();
      }, delay);
      if (typeof restartTimer.unref === 'function') restartTimer.unref();
    });
    return helper;
  }

  function stop() {
    disposed = true;
    if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
    try {
      if (helper) {
        helper.stdin.write(JSON.stringify({ op: 'quit' }) + '\n');
        helper.stdin.end();
        helper.kill();
      }
    } catch { /* ignore */ }
    helper = null;
    ready = false;
  }

  function sendHelper(payload) {
    if (helper === null || helper.exitCode !== null) return false;
    try { helper.stdin.write(JSON.stringify(payload) + '\n'); return true; } catch { return false; }
  }

  function handleEvent(event) {
    if (event?.event === 'ready') {
      ready = true;
      restarts = 0;
      sendHelper({ op: 'config', intervalMs: config.intervalMs, threshold: config.threshold, cooldownMs: config.cooldownMs, maxWidth: config.maxWidth });
      return;
    }
    if (event?.event === 'error') {
      lastError = String(event.message ?? 'unknown');
      return;
    }
    if (event?.event === 'change' || event?.event === 'snap') {
      lastEvent = event;
      if (event.event === 'change') onScreenChange(event);
    }
  }

  function allowReact(now) {
    if (config.enabled !== true) return false;
    const cutoff = now - 3600000;
    while (reactTimes.length > 0 && reactTimes[0] < cutoff) reactTimes.shift();
    if (reactTimes.length >= Number(config.maxPerHour ?? 20)) return false;
    const match = String(config.windowMatch ?? '').trim().toLowerCase();
    if (match && !String(lastEvent?.title ?? '').toLowerCase().includes(match)) return false;
    if (lastAnalyzeAt && now - lastAnalyzeAt < Number(config.cooldownMs ?? 45000)) return false;
    return true;
  }

  function onScreenChange(event) {
    const now = Date.now();
    if (!allowReact(now)) return;
    lastAnalyzeAt = now;
    reactTimes.push(now);
    pendingEvent = event;
    void drainQueue();
  }

  async function drainQueue() {
    if (analyzing || !pendingEvent) return;
    analyzing = true;
    try {
      while (pendingEvent) {
        const event = pendingEvent;
        pendingEvent = null;
        await analyzeFrame(event);
      }
    } finally {
      analyzing = false;
    }
  }

  async function analyzeFrame(event) {
    const at = Number(event.at) || Date.now();
    const title = String(event.title ?? '').trim();
    let description = '';
    try {
      if (config.analyze !== false && codexMedia && typeof codexMedia.analyze === 'function') {
        const base64 = fs.readFileSync(String(event.path)).toString('base64');
        const vision = await codexMedia.analyze(
          [{ mimeType: 'image/jpeg', data: base64 }],
          {
            scope: 'screen-watch',
            question: '这是主人电脑屏幕的截图。用一两句中文说清楚：屏幕上在做什么、主要窗口/画面是什么、有什么值得注意的。具体、别猜、别编。'
          }
        );
        if (vision && vision.status === 'ok' && typeof vision.answer === 'string') description = vision.answer.trim();
        else if (vision && vision.note) description = '';
      }
    } catch (error) {
      lastError = '看图失败：' + String(error?.message ?? error);
    }
    observations.unshift({ at, title, score: Number(event.score) || 0, path: String(event.path ?? ''), description });
    while (observations.length > Math.max(1, Number(config.maxObservations) || 5)) observations.pop();
    log(`屏幕陪看：${title || '未知窗口'} 变化 ${Math.round((Number(event.score) || 0) * 100)}%${description ? ' → ' + description.slice(0, 60) : '（无描述）'}`);
  }

  /** 给 buildWakePromptV2 用的注入块；没开或没观察就返回空串。 */
  function promptBlock() {
    if (config.enabled !== true) return '';
    const latest = observations[0];
    if (!latest) return '';
    const agoSec = Math.max(0, Math.round((Date.now() - latest.at) / 1000));
    const desc = latest.description || `画面有变化（${latest.title || '未知窗口'}）`;
    return `【最近屏幕】${agoSec} 秒前你在屏幕前：${desc}${latest.title ? `（窗口：${latest.title}）` : ''}\n\n`;
  }

  function state() {
    const now = Date.now();
    const cutoff = now - 3600000;
    return {
      config: { ...config },
      helper: helper !== null && helper.exitCode === null ? 'running' : 'stopped',
      ready,
      lastEvent,
      observations: observations.slice(0, Math.max(1, Number(config.maxObservations) || 5)),
      recentReactions: reactTimes.filter((at) => at >= cutoff).length,
      lastError
    };
  }

  function applyConfig(patch) {
    const next = { ...config };
    if (patch && typeof patch === 'object') {
      if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
      if (typeof patch.analyze === 'boolean') next.analyze = patch.analyze;
      for (const [key, min, max] of [
        ['intervalMs', 400, 60000],
        ['threshold', 0.005, 0.9],
        ['cooldownMs', 5000, 3600000],
        ['maxWidth', 320, 2560],
        ['maxPerHour', 1, 600],
        ['maxObservations', 1, 20]
      ]) {
        const value = Number(patch[key]);
        if (Number.isFinite(value)) next[key] = Math.min(max, Math.max(min, value));
      }
      if (typeof patch.windowMatch === 'string') next.windowMatch = patch.windowMatch.trim();
    }
    config = next;
    saveConfig(config);
    sendHelper({ op: 'config', intervalMs: config.intervalMs, threshold: config.threshold, cooldownMs: config.cooldownMs, maxWidth: config.maxWidth });
    // 关掉时连 Python 帮工一起停：不用的功能不该常驻截屏占 CPU。
    if (config.enabled) start(); else stop();
    return { ...config };
  }

  return { start, stop, state, applyConfig, promptBlock, loadConfig: () => ({ ...config }) };
}

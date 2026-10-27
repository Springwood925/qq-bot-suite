/**
 * attack-mode.js —— 攻击形态（贴吧鱼，按人切换）。
 *
 * 需求（2026-10-27）：群里有人骂机器人时，对**这个人**切换成贴吧鱼攻击人格，
 * 对其他群友保持原来的小鲸鱼人格；管理员 QQ 永远豁免。
 *
 * 检测：收到消息时扫硬辱骂词 + 必须指向机器人（含「鱼/鲸鱼/机器人/D指导/贴吧」）。
 * 注入：buildWakePromptV2 里，有活跃目标时追加一段【攻击形态】+ 贴吧鱼规则全文。
 * 失效：durationMinutes 内没有新的辱骂自动解除。
 * 配置：qq-bridge/attack-mode.json；人格文本：qq-bridge/attack-prompt.txt。
 */
import fs from 'node:fs';
import path from 'node:path';

// 硬辱骂词（只认这些，避免把普通吐槽误判成攻击）
const HARD_WORDS = /傻逼|傻b|煞笔|sb|nt|妈的|你妈|操你|草你|去死|死鱼|垃圾|废物|脑瘫|弱智|智障|狗东西|滚蛋|贱人|畜生|死全家|骂你/;
// 必须指向机器人，否则不算（群友互骂不触发）
const TARGET_HINT = /鱼|鲸鱼|机器人|小鲸鱼|D指导|贴吧/;

const DEFAULTS = {
  enabled: true,
  durationMinutes: 15,
  extraWords: '',
  maxPromptChars: 3200
};

export function createAttackMode({ root, log = () => {}, ownerQQ = () => '' }) {
  const configPath = path.join(root, 'attack-mode.json');
  const promptPath = path.join(root, 'attack-prompt.txt');

  function loadConfig() {
    try {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function loadPrompt() {
    try {
      return fs.readFileSync(promptPath, 'utf8').trim();
    } catch {
      return '';
    }
  }

  let config = loadConfig();
  let promptText = loadPrompt();
  const targets = new Map(); // key -> { qq, name, at, expiresAt, hits }
  const lastSender = new Map(); // key -> 最近一条消息的发送者 QQ（用来保证"只对这个人"）

  function saveConfig(next) {
    try {
      fs.writeFileSync(configPath, JSON.stringify(next, null, 2), 'utf8');
    } catch (error) {
      log('攻击形态：配置写入失败 ' + String(error?.message ?? error));
    }
  }

  function noteMessage(key, { senderQQ, senderName, text } = {}) {
    if (config.enabled === false) return;
    const qq = String(senderQQ || '').trim();
    if (qq) lastSender.set(key, qq);
    const owner = String(typeof ownerQQ === 'function' ? ownerQQ() : ownerQQ || '').trim();
    if (qq && owner && qq === owner) return; // 管理员豁免
    const content = String(text || '');
    if (!content) return;
    const hit = HARD_WORDS.test(content) || (config.extraWords ? new RegExp(config.extraWords, 'i').test(content) : false);
    if (!hit) return;
    if (!TARGET_HINT.test(content)) return;
    const now = Date.now();
    const prev = targets.get(key);
    const hits = prev && prev.qq === qq ? prev.hits + 1 : 1;
    targets.set(key, {
      qq,
      name: String(senderName || ''),
      at: now,
      expiresAt: now + Math.max(1, Number(config.durationMinutes) || 15) * 60000,
      hits
    });
    log(`攻击形态：${key} 目标 QQ ${qq}${senderName ? `（${senderName}）` : ''}${hits > 1 ? ` 第 ${hits} 次` : ''}辱骂`);
  }

  function activeTarget(key) {
    const target = targets.get(key);
    if (!target) return null;
    if (Date.now() > target.expiresAt) {
      targets.delete(key);
      return null;
    }
    return target;
  }

  function promptBlock(key) {
    const target = activeTarget(key);
    if (!target || !promptText) return '';
    // 硬保证"只对这个人"：最近一条消息不是他发的，就不注入攻击形态。
    if (lastSender.get(key) !== target.qq) return '';
    const text = promptText.slice(0, Math.max(200, Number(config.maxPromptChars) || 3200));
    const agoMin = Math.max(0, Math.round((Date.now() - target.at) / 60000));
    return `【攻击形态 · 只对一个人】本会话里 QQ ${target.qq}${target.name ? `（${target.name}）` : ''} ${agoMin} 分钟前辱骂了你。`
      + `\n**只对这个人**用下面的「贴吧鱼」形态回复：对他的每句话都按这个形态，别认怂、别自嘲、别讲道理。`
      + `\n**对其他群友保持原来的小鲸鱼人格**，不要把攻击形态带到别人身上；管理员 QQ 一律不骂。`
      + `\n--- 贴吧鱼规则 ---\n${text}\n--- 规则结束 ---\n\n`;
  }

  function state() {
    const now = Date.now();
    const active = [];
    for (const [key, target] of targets) {
      if (now > target.expiresAt) { targets.delete(key); continue; }
      active.push({ key, ...target, leftSeconds: Math.round((target.expiresAt - now) / 1000) });
    }
    return { config: { ...config }, active, promptChars: promptText.length };
  }

  function applyConfig(patch) {
    const next = { ...config };
    if (patch && typeof patch === 'object') {
      if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
      if (Number.isFinite(Number(patch.durationMinutes))) next.durationMinutes = Math.min(240, Math.max(1, Math.round(Number(patch.durationMinutes))));
      if (typeof patch.extraWords === 'string') next.extraWords = patch.extraWords.slice(0, 400);
    }
    config = next;
    saveConfig(config);
    promptText = loadPrompt();
    return { ...config };
  }

  function clear(key) {
    if (key) targets.delete(key);
    else targets.clear();
  }

  return { noteMessage, promptBlock, state, applyConfig, clear, activeTarget };
}

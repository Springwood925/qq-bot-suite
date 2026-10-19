// 分享卡片（OneBot `json` 段，即 QQ 的 lightApp/ARK 卡片）解析。
//
// 背景（2026-09-22）：
//   bridge.js 的 segmentsToText 原来把 `json` 段一律渲染成 "[卡片消息]"，
//   卡片里的标题、描述、跳转链接**全部被丢掉** —— 群里有人分享 B 站视频、
//   公众号文章、小程序、音乐时，AI 只看到"卡片消息"四个字，等于看不了。
//   本次把卡片解析成人类可读的一行摘要。
//
// 安全原则（重要）：
//   - 只提取**白名单字段**，绝不把整段原始 JSON 塞进上下文（卡片可能很长，
//     且 prompt/desc 是发送方可控文本 ⇒ 存在提示注入面）。
//   - 每个字段都截断，整条摘要也有硬上限。
//   - 纯函数：不访问网络、不读文件、不做任何 IO。

const MAX_FIELD = 120;
const MAX_URL = 300;
const MAX_TOTAL = 500;
// 同一张卡片最多保留几个链接，防止"卡片里塞 20 个链接"把上下文冲爆
const MAX_URLS = 3;

function clip(s, max = MAX_FIELD) {
  const v = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (!v) return '';
  return v.length > max ? `${v.slice(0, max)}…` : v;
}

// 只接受字符串：卡片结构里有的字段可能是对象/数组，String() 会得到 "[object Object]"
function str(v) {
  return typeof v === 'string' ? v : '';
}

// 从任意节点里取人类可读的标题（结构随卡片类型变化，兜底多取几种键名）
function pickTitle(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return '';
  for (const k of ['title', 'name', 'summary']) {
    const v = clip(node[k]);
    if (v) return v;
  }
  return '';
}

const URL_RE = /https?:\/\/[^\s"'\\<>）)】\]]+/g;

function collectUrls(obj, out, depth = 0) {
  if (out.length >= MAX_URLS || depth > 6 || !obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    for (const it of obj) {
      if (out.length >= MAX_URLS) return;
      collectUrls(it, out, depth + 1);
    }
    return;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (out.length >= MAX_URLS) return;
    if (typeof v === 'string') {
      if (/url|link/i.test(k)) {
        const m = v.match(URL_RE);
        if (m) for (const u of m) { if (out.length < MAX_URLS && !out.includes(u)) out.push(clip(u, MAX_URL)); }
      }
    } else if (v && typeof v === 'object') {
      collectUrls(v, out, depth + 1);
    }
  }
}

/**
 * 把 OneBot `json` 段的卡片原文解析成一行可读摘要。
 *
 * @param {string|object} raw 卡片 JSON 字符串（OneBot `data.data`），或已解析对象
 * @returns {{title:string, desc:string, prompt:string, source:string, urls:string[], kind:string}|null}
 *          解析不出任何可用信息时返回 null（调用方回退成 "[卡片消息]"）
 */
export function parseCard(raw) {
  let root = raw;
  if (typeof root === 'string') {
    const s = root.trim();
    if (!s || (s[0] !== '{' && s[0] !== '[')) return null;
    try {
      root = JSON.parse(s);
    } catch {
      return null;
    }
  }
  if (!root || typeof root !== 'object' || Array.isArray(root)) return null;

  const meta = root.meta && typeof root.meta === 'object' && !Array.isArray(root.meta) ? root.meta : null;
  let title = '';
  let desc = '';
  let urlHost = '';
  let source = '';
  let kind = '';

  if (meta) {
    const keys = Object.keys(meta);
    // 先按已知结构取（顺序即优先级）
    const order = ['detail_1', 'detail', 'news', 'mannounce', 'music', 'video', 'musicShare'];
    const ordered = [...order.filter((k) => keys.includes(k)), ...keys.filter((k) => !order.includes(k))];
    for (const key of ordered) {
      const node = meta[key];
      if (!node || typeof node !== 'object') continue;
      const t = pickTitle(node);
      if (t && !title) {
        title = t;
        kind = kind || key;
        desc = clip(node.desc);
        // ⚠️ 只认字符串：真实卡片里 tag/source 有时是对象（实测 2026-09-22 出过 "[object Object]"）
        source = clip(str(node.tag) || str(node.source) || str(node.appName), 40);
        urlHost = clip(str(node.host), 60);
      }
    }
  }

  // QQ 自带兜底卡片（如"当前QQ版本不支持此应用"）只给 prompt/desc
  const prompt = clip(root.prompt);
  if (!title && !desc) desc = clip(root.desc);
  if (!title && !prompt && !desc) return null;

  const urls = [];
  collectUrls(meta ?? root, urls);
  // jumpUrl / qqdocurl 这类顶层字段也兜一下
  if (urls.length < MAX_URLS) {
    for (const k of ['jumpUrl', 'jump_url', 'qqdocurl', 'url']) {
      const m = typeof root[k] === 'string' ? root[k].match(URL_RE) : null;
      if (m) for (const u of m) { if (urls.length < MAX_URLS && !urls.includes(u)) urls.push(clip(u, MAX_URL)); }
    }
  }

  return { title, desc, prompt, source: source || urlHost, urls, kind, isMiniApp: /miniapp/i.test(String(root.app ?? '')) };
}

/**
 * 解析卡片并渲染成给 AI 读的一行文本。
 *
 * @param {string|object} raw
 * @returns {string} 形如 `[卡片：标题｜描述｜来自：B站｜链接：https://…]`；
 *                   解析不出可用信息时返回 `[卡片消息]`
 */
export function cardToText(raw) {
  let c = null;
  try {
    c = parseCard(raw);
  } catch {
    c = null;
  }
  if (!c) return '[卡片消息]';

  const bits = [];
  // 小程序卡片（B站/知乎等）的 title 是**应用名**、desc 才是内容标题（实测 2026-09-22），
  // 所以这种卡片把内容标题放在最前面，读起来才是"标题｜来源"。
  const content = c.isMiniApp ? c.desc : c.title;
  // 内容标题太短（"？"这种）就没信息量，让位给应用名
  const head = (content && content.length >= 2 ? content : '') || c.title || c.prompt || c.desc;
  if (head) bits.push(head);
  if (c.title && c.title !== head) bits.push(c.title);
  if (c.desc && c.desc !== head && c.desc !== c.title) bits.push(c.desc);
  // prompt 多半只是 "[QQ小程序]平台名"，和 title/tag 重复；只在它是唯一可用信息时用
  if (c.prompt && !c.title && c.prompt !== head && c.prompt !== c.desc) bits.push(c.prompt);
  if (c.source) bits.push(`来自：${c.source}`);
  if (c.urls.length) bits.push(`链接：${c.urls[0]}`);

  const body = clip(bits.join('｜'), MAX_TOTAL);
  return body ? `[卡片：${body}]` : '[卡片消息]';
}

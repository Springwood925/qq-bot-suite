// 安全抓取层（完整移植自原版 safe-fetch + mcp-web-search-safe 的 SSRF 防护）。
//
// - 仅 http/https；禁止 URL 内嵌凭据；
// - 禁止 localhost / .local / 私有 IP / 环回 / 链路本地 / CGNAT 等内网地址；
// - 域名先做 DNS 解析并检查全部解析结果；解析后固定到已校验的 IP 发请求（防 DNS rebinding）；
// - 手动跟随重定向，每一跳重新校验；
// - 响应体限量读取，避免超大响应拖垮进程。
//
// 例外开关：security.allowPrivateImageHosts = true 时，图片下载跳过内网检查
// （仅供本地测试/自建图床使用，默认关闭）。
import dns from 'node:dns';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { StringDecoder } from 'node:string_decoder';
import { getConfig } from './_bridge-config.js';

const dnsLookup = dns.promises.lookup;

// ── IP 判定 ─────────────────────────────────────────────────────────────

// 解析 IPv6 中内嵌的 IPv4（::ffff:a.b.c.d、::ffff:7f00:1 等）。
function ipv4FromLast32(lower) {
  const parts = String(lower || '').split(':');
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1];
  const secondLast = parts[parts.length - 2];
  if (/^\d+\.\d+\.\d+\.\d+$/.test(last)) return last;
  if (/^[0-9a-f]{1,4}$/.test(secondLast) && /^[0-9a-f]{1,4}$/.test(last)) {
    const num = (parseInt(secondLast, 16) << 16) + parseInt(last, 16);
    return `${(num >>> 24) & 255}.${(num >>> 16) & 255}.${(num >>> 8) & 255}.${num & 255}`;
  }
  return null;
}

function parseEmbeddedIpv4(h) {
  const lower = String(h || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!lower.includes(':')) return null;
  const dotted = lower.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1];
  const m = lower.match(/^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (m) {
    const num = (parseInt(m[1], 16) << 16) + parseInt(m[2], 16);
    return `${(num >>> 24) & 255}.${(num >>> 16) & 255}.${(num >>> 8) & 255}.${num & 255}`;
  }
  if (lower.startsWith('::ffff:') || lower.startsWith('::')) {
    const embedded = ipv4FromLast32(lower);
    if (embedded) return embedded;
  }
  if (lower.startsWith('64:ff9b')) {
    const embedded = ipv4FromLast32(lower);
    if (embedded) return embedded;
  }
  const nat64 = lower.match(/^64:ff9b:(?:::)?(?:([0-9a-f]{1,4}):([0-9a-f]{1,4})|(\d+\.\d+\.\d+\.\d+))$/i);
  if (nat64) {
    if (nat64[3]) return nat64[3];
    const num = (parseInt(nat64[1], 16) << 16) + parseInt(nat64[2], 16);
    return `${(num >>> 24) & 255}.${(num >>> 16) & 255}.${(num >>> 8) & 255}.${num & 255}`;
  }
  return null;
}

export function isPrivateIp(ip) {
  const h = String(ip || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  const embedded = h.includes(':') ? parseEmbeddedIpv4(h) : null;
  if (embedded) return isPrivateIp(embedded);

  if (net.isIP(h) === 4) {
    const parts = h.split('.').map(Number);
    if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    if (parts[0] === 198 && parts[1] >= 18 && parts[1] <= 19) return true;
    if (parts[0] === 192 && parts[1] === 0 && parts[2] === 0) return true;
    if (parts[0] >= 224) return true;
    return false;
  }

  if (net.isIP(h) === 6) {
    if (h === '::' || h === '::1') return true;
    if (h.startsWith('fc') || h.startsWith('fd')) return true;
    if (/^fe[89ab]/.test(h)) return true;
    if (h.startsWith('fec') || h.startsWith('fed') || h.startsWith('fee') || h.startsWith('fef')) return true;
    if (h.startsWith('2001:db8')) return true;
    if (h.startsWith('2001:2:') || h.startsWith('2001:10:') || h.startsWith('2001:20:')) return true;
    const sixth4 = h.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4}):/i);
    if (sixth4) {
      const num = (parseInt(sixth4[1], 16) << 16) + parseInt(sixth4[2], 16);
      const ipv4 = `${(num >>> 24) & 255}.${(num >>> 16) & 255}.${(num >>> 8) & 255}.${num & 255}`;
      if (isPrivateIp(ipv4)) return true;
    }
    if (h.startsWith('ff')) return true;
    return false;
  }
  return false;
}

// ── 主机名校验（含 DNS） ────────────────────────────────────────────────

async function lookupWithTimeout(hostname) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('DNS 解析超时')), 5000);
  });
  return Promise.race([dnsLookup(hostname, { all: true, verbatim: true }), timeout]).finally(() => clearTimeout(timer));
}

async function resolveSafeHost(hostname, { allowPrivate = false } = {}) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) throw new Error('主机名为空');
  if (!allowPrivate && (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local'))) {
    throw new Error('禁止访问内网/本机地址');
  }
  if (net.isIP(h)) {
    if (!allowPrivate && isPrivateIp(h)) throw new Error('禁止访问内网/本机地址');
    return h;
  }
  let addresses;
  try {
    addresses = await lookupWithTimeout(h);
  } catch (error) {
    throw new Error(`域名解析失败：${error?.message ?? error}`);
  }
  if (!addresses.length) throw new Error('域名没有解析结果');
  if (!allowPrivate) {
    for (const { address } of addresses) {
      if (isPrivateIp(address)) throw new Error('域名解析到内网/本机地址，已阻止');
    }
  }
  return addresses[0].address;
}

/** 校验 URL 的 scheme 与主机（DNS 级）。返回 { url, ip }。 */
export async function validateFetchUrl(raw, { allowPrivate = false } = {}) {
  let url;
  try {
    url = new URL(String(raw ?? '').trim());
  } catch {
    throw new Error('URL 无效');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('仅允许 http/https');
  if (url.username || url.password) throw new Error('URL 不能包含凭据');
  const ip = await resolveSafeHost(url.hostname, { allowPrivate });
  return { url, ip };
}

// ── 浏览锁定（browseLock）──────────────────────────────────────────────
//
// 作用：把"机器人能访问哪些域名"收成一个白名单，给用户一个硬边界
// （家长/老师/自用场景：只让它上这几个站）。
//
// ⚠️ 最关键的一点：白名单必须**逐跳校验**。
// 只看入口 URL 是不够的 —— 一个站内链接 302 到站外就绕过去了。
// 所以 safeFetch / safeFetchBinary 在**每一次重定向之后**都重新查一遍白名单，
// 而不是只在开始查一次。

/** 域名归一化：去协议/去路径/去端口/转小写，只留主机名。 */
export function normalizeDomain(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  try {
    // 带协议的写法直接解析
    const u = new URL(s.includes('://') ? s : `http://${s}`);
    return u.hostname.toLowerCase().replace(/^\.+|\.+$/g, '');
  } catch {
    return '';
  }
}

/** 读当前锁定配置（每次现读，保证改配置立即生效）。 */
export function browseLockState() {
  const lock = getConfig().security?.browseLock || {};
  const enabled = lock.enabled === true;
  const domains = (Array.isArray(lock.hosts) ? lock.hosts : [])
    .map(normalizeDomain)
    .filter(Boolean);
  return { enabled, domains, siteSearchUrl: String(lock.siteSearchUrl || '').trim() };
}

/**
 * 主机是否在白名单内。**支持子域**：白名单里有 `example.com` 时
 * `img.example.com` 也算通过 —— 否则一个图床的 CDN 域名就把正常使用挡死了。
 * 但反向不成立：白名单写 `img.example.com` 不会放行 `example.com`。
 */
export function hostAllowed(host, state = browseLockState()) {
  if (!state.enabled) return true;          // 没开锁定 = 不限制
  const h = String(host ?? '').toLowerCase().replace(/^\.+|\.+$/g, '');
  if (!h) return false;
  if (!state.domains.length) return false;  // 开了锁定但没填域名 = 全部拒绝（比"全部放行"安全）
  return state.domains.some((d) => h === d || h.endsWith(`.${d}`));
}

/** 锁定开启时校验一个 URL 的主机；未开启则直接通过。返回 { enabled, host, allowed }。 */
export function checkBrowseLock(rawUrl, state = browseLockState()) {
  if (!state.enabled) return { enabled: false, host: '', allowed: true };
  let host = '';
  try {
    host = new URL(String(rawUrl ?? '')).hostname.toLowerCase();
  } catch {
    return { enabled: true, host: '', allowed: false };
  }
  return { enabled: true, host, allowed: hostAllowed(host, state) };
}

// ── 受限请求 ────────────────────────────────────────────────────────────

function sliceByCodePoints(s, max) {
  if (s.length <= max) return s;
  return Array.from(s).slice(0, max).join('');
}

function readBounded(res, maxBytes, asText) {
  return new Promise((resolve, reject) => {
    const decoder = new StringDecoder('utf8');
    const chunks = [];
    let total = 0;
    let text = '';
    let settled = false;
    const finish = (fn, val) => {
      if (settled) return;
      settled = true;
      fn(val);
    };
    res.on('data', (chunk) => {
      if (settled) return;
      total += chunk.length;
      if (asText) text += decoder.write(chunk);
      else chunks.push(chunk);
      // 只用字节数判断是否超限。原实现还额外判断了 text.length >= maxBytes，
      // 但 text.length 是字符数而 maxBytes 是字节数（UTF-8 下中文 1 字符 = 3 字节），
      // 单位不一致，会让刚好读满的响应被误标成 truncated。
      if (total >= maxBytes) {
        try { res.destroy(); } catch { /* ignore */ }
        finish(resolve, asText ? sliceByCodePoints(text, maxBytes) : Buffer.concat(chunks).subarray(0, maxBytes));
      }
    });
    res.on('end', () => {
      if (!settled) {
        if (asText) {
          text += decoder.end();
          finish(resolve, sliceByCodePoints(text, maxBytes));
        } else {
          finish(resolve, Buffer.concat(chunks));
        }
      }
    });
    res.on('error', (err) => finish(reject, err));
  });
}

// 使用已校验的 IP 发起请求（保留 Host/SNI），从根上消除 DNS rebinding。
//
// ── 可选的上游 HTTP 代理（CONNECT 隧道）──────────────────────────────────
//
// 2026-09-20 加。起因：Pixiv 官方站与 CDN（i.pximg.net）在境内**全域直连超时**，
// 能用的第三方反代（i.pixiv.re）只有 14~27 KB/s —— 一张 600KB 的图要 20~40 秒，
// 在群里根本没法用。而挂上本机代理后走**官方 CDN 实测 684 KB/s**（快 38 倍）。
//
// ⚠️ 但这套 safe-fetch 是**故意**用 IP 直连（`hostname: ip` + servername 校验）来防
//    DNS rebinding 的，走代理会把这层保护让掉一部分：
//      · 直连时：我们先把域名解析成 IP，只连这个 IP 且校验 TLS 的 SNI ⇒ 中途换不了目标
//      · 走代理时：CONNECT 只能给**域名**，由代理去解析 ⇒ 理论上代理可以连到别的 IP
//    取舍：① **必须先过 validateFetchUrl（内网地址照样拒绝）**；
//          ② 代理是用户自己本机的东西（本项目是 127.0.0.1），属于可信组件；
//          ③ **默认关闭** —— 只有显式配了 media.proxy 才走这条路。
//
// ── 2026-09-21 代理隔离（事故修复）─────────────────────────────────────
// 事故：B站视频搜索突然全挂，报 `connect ECONNREFUSED 127.0.0.1:10808` ——
//   根因是**代理被全局套用**：image.js 加载时把 media.proxy 设进这里的模块级变量，
//   而 requestOnce 只判 `!!proxyConfig` ⇒ B站/抖音/其它图源的请求**全都**被塞进代理；
//   用户的 v2rayN 一退出，这些功能跟着一起死（实测 B站搜索 502、随机图失败，
//   而 api.bilibili.com 直连 116ms 完全正常）。
// 修法：`proxyConfig` 只表示"配了代理"，**用不用由调用方显式决定** ——
//   safeFetch / safeFetchBinary 的 `useProxy: true`。默认直连（与代理进程无关）。
//   实测唯一需要代理的是 Pixiv 官方 CDN `i.pximg.net`（直连 10.5s 超时），
//   其余（lolicon API、nekos.life、thecatapi、dog.ceo、api.bilibili.com）直连都通。
let proxyConfig = null;

/** 设置上游代理；传 null / 空串 = 关闭代理（默认）。
 *  ⚠️ 这里只是"记下代理地址"，**不会**让任何请求自动走代理 ——
 *  真正使用需要调用方在 safeFetch/safeFetchBinary 里传 `useProxy: true`（见上）。 */
export function setFetchProxy(value) {
  const s = String(value || '').trim();
  if (!s) { proxyConfig = null; return; }
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `http://${s}`);
    proxyConfig = { host: u.hostname, port: Number(u.port) || 8080, auth: u.username ? `${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}` : '' };
  } catch { proxyConfig = null; }
}

export function getFetchProxy() {
  return proxyConfig;
}

/**
 * 用 HTTP CONNECT 打通到目标主机的隧道，返回裸 socket。
 * 只用 node:http，不依赖任何代理库（桥里没有 undici/proxy-agent，而且装包成本更高）。
 */
function openTunnel(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const headers = { host: `${host}:${port}` };
    if (proxyConfig.auth) headers['proxy-authorization'] = `Basic ${Buffer.from(proxyConfig.auth).toString('base64')}`;
    const req = http.request({
      host: proxyConfig.host, port: proxyConfig.port, method: 'CONNECT',
      path: `${host}:${port}`, headers, timeout: timeoutMs
    });
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) { socket.destroy(); reject(new Error(`代理 CONNECT ${proxyConfig.host}:${proxyConfig.port} 被拒：HTTP ${res.statusCode}`)); return; }
      resolve(socket);
    });
    req.on('timeout', () => req.destroy(new Error(`代理 CONNECT 超时（${proxyConfig.host}:${proxyConfig.port}）`)));
    req.on('error', reject);
    req.end();
  });
}

// extraHeaders：调用方附加的请求头（如 B站/抖音的 Referer、UA、Cookie）。
//   会覆盖同名默认头；host / servername 等传输层字段不接受调用方覆盖
//   （能改 host 就等于绕过 Host 校验与 SNI 绑定）。
// timeoutMs：单次请求超时，默认 20s。
// viaProxy：**必须由调用方显式传 true** 才走代理（2026-09-21 改，见文件顶部"代理隔离"说明）。
function requestOnce(url, ip, { asBinary = false, maxBytes = 50000, extraHeaders = null, timeoutMs = 20000, viaProxy = false } = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    const port = url.port || (url.protocol === 'https:' ? 443 : 80);
    const headers = {
      host: url.host,
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) qq-agent/1.0',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8,image/avif,image/webp,image/*;q=0.8',
      'accept-language': 'zh-CN,zh;q=0.9'
    };
    if (extraHeaders && typeof extraHeaders === 'object') {
      for (const [k, v] of Object.entries(extraHeaders)) {
        const key = String(k).toLowerCase();
        // 传输层字段不让调用方碰：改了 host 就绕过了 Host 校验，
        // 改了 connection 可能破坏 keep-alive 假设。
        if (key === 'host' || key === 'connection') continue;
        if (v === undefined || v === null) continue;
        headers[key] = String(v);
      }
    }
    // 走代理还是直连：直连用已校验的 IP + SNI 校验；代理用域名走 CONNECT 隧道。
    // ⚠️ 必须是"配置里有代理" **且** "调用方明确要求用代理" 才算走代理。
    //    只判 proxyConfig 会让所有 safeFetch 调用一起被代理（2026-09-21 的 B站事故）。
    const useProxy = !!proxyConfig && viaProxy === true;
    const finish = (opts) => {
      const req = mod.request(opts, (res) => {
        const statusCode = res.statusCode || 0;
        if ([301, 302, 303, 307, 308].includes(statusCode)) {
          res.resume();
          resolve({ statusCode, redirect: String(res.headers.location || '') });
          return;
        }
        // 超限快速失败：readBounded 到 maxBytes 是**静默截断**（不抛错），
        // 调用方只能靠"文件尾对不上"间接发现 ⇒ 一张 30MB 的图会白下 4×8MB 才失败。
        // 对方声明了 Content-Length 且明显超限时，直接断开，一个字节都不下。
        const declared = Number(res.headers['content-length'] || 0);
        if (declared > maxBytes) {
          res.destroy();
          reject(new Error(`内容过大：${declared} 字节，超过上限 ${maxBytes} 字节`));
          return;
        }
        readBounded(res, maxBytes, !asBinary)
          .then((body) => resolve({ statusCode, body, contentType: String(res.headers['content-type'] || '') }))
          .catch(reject);
      });
      req.on('timeout', () => req.destroy(new Error(`请求超时：${url.hostname}`)));
      req.on('error', reject);
      req.end();
      return req;
    };

    if (!useProxy) {
      finish({
        hostname: ip, port, path: url.pathname + url.search, method: 'GET', headers,
        servername: url.protocol === 'https:' ? url.hostname : undefined,
        rejectUnauthorized: url.protocol === 'https:',
        timeout: timeoutMs
      });
      return;
    }

    // 代理路径：先 CONNECT，再在隧道上跑 TLS（servername 仍按真实域名校验证书）
    openTunnel(url.hostname, Number(port), Math.min(timeoutMs, 15000)).then((raw) => {
      let socket = raw;
      const go = () => finish({
        createConnection: () => socket, host: url.hostname, port: Number(port),
        path: url.pathname + url.search, method: 'GET', headers,
        servername: url.protocol === 'https:' ? url.hostname : undefined,
        rejectUnauthorized: url.protocol === 'https:',
        timeout: timeoutMs
      });
      if (url.protocol !== 'https:') { go(); return; }
      const tlsSock = tls.connect({ socket: raw, servername: url.hostname, rejectUnauthorized: true });
      socket = tlsSock;
      tlsSock.once('secureConnect', go);
      tlsSock.once('error', (error) => { try { raw.destroy(); } catch { /* ignore */ } reject(error); });
    }).catch(reject);
  });
}

const MAX_REDIRECTS = 5;

/**
 * 抓取网页文本，SSRF 全防护（不做内网例外）。
 *
 * ⚠️ 这个函数**曾经只解构 browseLocked**，把调用方传的 timeoutMs / headers /
 *    maxBytes 全部静默丢弃 —— 后果是一整批功能"看着实现了其实是死的"：
 *      · media-download 传的 SESSDATA / ttwid Cookie 从没发出去过
 *        （B站登录态搜索、抖音 detail 因此永远拿不到数据）；
 *      · 各插件精心设的 timeoutMs 无效（恒 20s）；
 *      · 文本响应被硬截断在 50000 字节，而调用方按自己传的 maxBytes
 *        判 truncated（bili.js:63），判据与实现口径不一致 → 要么误报截断，
 *        要么截断了却不知道。
 *    所以下面这几个选项**必须**真的用上，不能只出现在签名里。
 *
 * @param {string} urlString
 * @param {object} opts
 *   browseLocked 是否施加浏览锁定白名单（逐跳校验）
 *   timeoutMs    单次请求超时，默认 20000
 *   headers      附加请求头（host/connection 会被忽略）
 *   maxBytes     响应体读取上限（字符数，默认 50000）
 * @returns {{url, statusCode, truncated, body}}
 *   truncated 按**本次的 maxBytes** 判定，与调用方口径一致。
 */
export async function safeFetch(urlString, {
  browseLocked = false,
  timeoutMs = 20000,
  headers = null,
  maxBytes = 50000,
  useProxy = false
} = {}) {
  // 锁定校验放在**最前面**，连 DNS 都不做 —— 不在白名单就根本不该发起连接
  const limit = Math.max(1, Number(maxBytes) || 50000);
  const lock = browseLocked ? checkBrowseLock(urlString) : { enabled: false, allowed: true, host: '' };
  if (!lock.allowed) throw new Error(`浏览锁定：${lock.host || '该地址'} 不在允许的域名清单内`);
  let { url, ip } = await validateFetchUrl(urlString);
  // 凭据只在**同源**请求上发送：重定向到别的域要剥掉 Cookie/Authorization，
  // 否则一个 302 就能把 B站 SESSDATA 交给第三方。入口记下 origin，逐跳比对。
  const originKey = `${url.protocol}//${url.host}`;
  const sameOriginHeaders = (u) => (`${u.protocol}//${u.host}` === originKey ? headers : stripCredentials(headers));
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const result = await requestOnce(url, ip, {
      asBinary: false, maxBytes: limit, timeoutMs, extraHeaders: sameOriginHeaders(url), viaProxy: useProxy === true
    });
    if ([301, 302, 303, 307, 308].includes(result.statusCode)) {
      if (!result.redirect) throw new Error(`重定向缺少 Location: ${result.statusCode}`);
      const next = new URL(result.redirect, url).toString();
      // ⚠️ 逐跳校验：重定向目标也要在白名单里。
      // 只在入口校验的话，一个站内链接 302 到站外就绕过了锁定。
      if (browseLocked) {
        const nl = checkBrowseLock(next);
        if (!nl.allowed) throw new Error(`浏览锁定：重定向目标 ${nl.host || '未知'} 不在允许的域名清单内`);
      }
      ({ url, ip } = await validateFetchUrl(next));
      continue;
    }
    const body = result.body || '';
    // 读满上限 = 中途被砍。与调用方按同一口径判定（见上面对 maxBytes 的说明）。
    const truncated = body.length >= limit;
    return { url: url.toString(), statusCode: result.statusCode, truncated, body };
  }
  throw new Error('重定向次数过多，已停止');
}

/** 剥掉请求头里的凭据类字段（跨域重定向时用）。 */
function stripCredentials(headers) {
  if (!headers || typeof headers !== 'object') return headers;
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    const key = String(k).toLowerCase();
    if (key === 'cookie' || key === 'authorization' || key === 'proxy-authorization') continue;
    out[k] = v;
  }
  return out;
}

/**
 * 下载二进制（图片/视频，≤maxBytes 字节），返回 { buffer, contentType }。
 *
 * opts.headers / opts.timeoutMs 与 safeFetch 同义（曾经只有 browseLocked，
 * 调用方传的 Referer/Cookie 被静默丢弃 —— 见 safeFetch 的说明）。
 */
export async function safeFetchBinary(urlString, maxBytes = 12 * 1024 * 1024, {
  browseLocked = false,
  headers = null,
  timeoutMs = 20000,
  useProxy = false
} = {}) {
  const lock = browseLocked ? checkBrowseLock(urlString) : { enabled: false, allowed: true, host: '' };
  if (!lock.allowed) throw new Error(`浏览锁定：${lock.host || '该地址'} 不在允许的域名清单内`);
  const allowPrivate = getConfig().security?.allowPrivateImageHosts === true;
  let { url, ip } = await validateFetchUrl(urlString, { allowPrivate });
  const originKey = `${url.protocol}//${url.host}`;
  const sameOriginHeaders = (u) => (`${u.protocol}//${u.host}` === originKey ? headers : stripCredentials(headers));
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const result = await requestOnce(url, ip, {
      asBinary: true, maxBytes, timeoutMs, extraHeaders: sameOriginHeaders(url), viaProxy: useProxy === true
    });
    if ([301, 302, 303, 307, 308].includes(result.statusCode)) {
      if (!result.redirect) throw new Error(`重定向缺少 Location: ${result.statusCode}`);
      const next = new URL(result.redirect, url).toString();
      // 逐跳校验（同 safeFetch）：重定向目标也必须在白名单内
      if (browseLocked) {
        const nl = checkBrowseLock(next);
        if (!nl.allowed) throw new Error(`浏览锁定：重定向目标 ${nl.host || '未知'} 不在允许的域名清单内`);
      }
      ({ url, ip } = await validateFetchUrl(next, { allowPrivate }));
      continue;
    }
    if (result.statusCode !== 200) throw new Error(`HTTP ${result.statusCode}`);
    return { buffer: result.body, contentType: result.contentType };
  }
  throw new Error('重定向次数过多，已停止');
}

/**
 * 图片地址校验（供 send_sticker / 图片下载使用）。
 * 默认内网地址一律拒绝；security.allowPrivateImageHosts=true 时放行（仅本地测试/自建图床）。
 */
export async function validateImageUrl(raw) {
  let url;
  try {
    url = new URL(String(raw ?? '').trim());
  } catch {
    throw new Error('图片地址不合法');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('只允许 http(s) 图片地址');
  if (getConfig().security?.allowPrivateImageHosts === true) return url.toString();
  const { url: safeUrl } = await validateFetchUrl(url.toString());
  return safeUrl.toString();
}

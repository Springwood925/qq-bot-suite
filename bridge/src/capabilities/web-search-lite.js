// 活动模块用的只读联网小工具。
//
// 不 import mcp-web-search-safe.js —— 那个文件在顶层就会启动 stdio MCP server，
// 桥进程里导入会多出一个服务。这里只复用同一个 SSRF 加固的 safeFetch。
import { safeFetch, validateFetchUrl } from '../safe-fetch.js';

const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' '
};

function decode(s) {
  return String(s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] || ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Bing 只读搜索：返回 [{title,url,snippet}]。 */
export async function searchWeb(query, { limit = 3 } = {}) {
  const q = String(query ?? '').trim();
  if (!q) throw new Error('搜索词为空');
  const url = `https://cn.bing.com/search?q=${encodeURIComponent(q)}&mkt=zh-CN&setlang=zh-hans`;
  await validateFetchUrl(url);
  const page = await safeFetch(url, 200000);
  if (page.statusCode < 200 || page.statusCode >= 300) throw new Error(`搜索服务 HTTP ${page.statusCode}`);
  const results = [];
  for (const block of String(page.body || '').split('<li class="b_algo"').slice(1)) {
    const href = block.match(/<a[^>]+href="(https?:\/\/[^"]+)"/i);
    if (!href) continue;
    const title = decode((block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i) || [])[1] || '');
    const snippet = decode((block.match(/<p[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || '');
    if (title) results.push({ title, url: href[1], snippet });
    if (results.length >= Math.max(1, Number(limit) || 3)) break;
  }
  return results;
}

/** 读取一页公开正文（去标签），失败抛错由调度器记录。 */
export async function fetchPage(url) {
  await validateFetchUrl(url);
  const page = await safeFetch(url, 60000);
  if (page.statusCode < 200 || page.statusCode >= 300) throw new Error(`HTTP ${page.statusCode}`);
  const title = decode((String(page.body).match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
  const text = decode(String(page.body).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' '));
  return { title, text: text.slice(0, 4000), url };
}

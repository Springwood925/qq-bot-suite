// B站 / 抖音链接自动解析（2026-09-19 从 QQ Agent 的 media-download 插件搬过来）
//
// 为什么搬：群里天天有人丢 B站/抖音链接，机器人以前只能干看着。
// SnowLuma 的发送侧**支持 video 段**（走 NTV2 highway 上传，和发图同一条路），
// 所以"下载完发出去"这条路是通的 —— 这次只补中间这一段。
//
// 触发方式：桥收到消息 → 文本里揪出链接 → 后台下载并发送。
// **刻意不 await**：下载要几秒到几十秒，绝不能卡住消息处理主流程。
import {
  extractBvid, resolveBvid, downloadAndSend as biliDownload, briefFailure as biliBrief
} from './bili.js';
import {
  resolveAwemeId, looksLikeDouyinShare, downloadAndSend as dyDownload, briefFailure as dyBrief
} from './douyin.js';

/** 判断一条链接归哪个平台；不认领返回 null。 */
export function detectPlatform(url) {
  const s = String(url || '');
  if (!s) return null;
  if (/bilibili\.com\//i.test(s) || /b23\.tv\//i.test(s) || extractBvid(s)) return 'bilibili';
  if (looksLikeDouyinShare(s)) return 'douyin';
  return null;
}

/**
 * 从一段文本里揪出第一个 B站/抖音链接。
 *
 * ⚠️ 正则**只吃 URL 合法字符，且不含 `@`** —— 这是踩出来的：
 *   QQ 群里链接经常和 @、中文、表情直接粘在一起，实测原文形如
 *   「【某个视频标题-哔哩哔哩】 https://b23.tv/XXXXXXX@！？某某？！」
 *   早先用排除法（排除空格和几个中文标点），把 `@！？某某？！` 全吃进 URL 里，
 *   拿这个假网址去请求 B站 ⇒ 报「B站 API: 请求错误」，表现就是「链接发了没反应」。
 *   群里 `@` 一定是提到某人，不会是网址的一部分 ⇒ 遇到就停。
 */
export function findMediaLink(text) {
  const s = String(text || '');
  if (!s) return null;
  for (const raw of s.match(/https?:\/\/[A-Za-z0-9\-._~:/?#[\]!$&'()*+,;=%]+/g) || []) {
    // 剥掉粘在尾巴上的标点**与右括号**：正则是按 URL 合法字符抓的，字符类里有 [ ]，
    // 而卡片渲染成文本后形如「…链接：https://b23.tv/xxxx]」——那个 ] 会被吃进 URL，
    // 拿这个假网址请求 B站 ⇒ 报「B站 API: 请求错误」（2026-09-22 实测到，见桥日志 13:52:09）。
    const u = raw.replace(/[.,;:!?]+$/, '').replace(/[\]）】>」』]+$/, '');
    if (detectPlatform(u)) return u;
  }
  // 宽松兜底：没有协议头的裸域名（有些分享文案会省掉 https://）
  const loose = s.match(/(?:b23\.tv|v\.douyin\.com|bilibili\.com\/video|douyin\.com\/video)\/[A-Za-z0-9_\-/=%?&]+/i);
  if (loose) {
    const u = `https://${String(loose[0]).replace(/^https?:\/\//, '')}`;
    if (detectPlatform(u)) return u;
  }
  return null;
}

/** 把底层抛出来的错翻译成"人话"，免得群里看到一堆堆栈。 */
function briefFailure(platform, error) {
  const m = String(error?.message ?? error ?? '');
  if (m.includes('时长') && m.includes('上限')) return '这个视频太长了，超过设置里的时长上限，跳过';
  if (m.includes('大小上限') || m.includes('超过上限')) return '这个视频太大了，超出下载大小上限，下不了';
  return platform === 'douyin' ? dyBrief(error) : biliBrief(error);
}

/**
 * 下载并发出。
 *
 * @param {object} o
 *   url      群里那条链接
 *   onebot   桥提供的发送口，只需要 { sendSegments(kind, chatId, segments) }
 *   kind     'group' | 'private'
 *   chatId   群号 / QQ 号
 *   params   { sessdata, cookie, maxDurationMin, maxBytes, preferQuality }
 * @returns {Promise<{ok:boolean, platform:string, kind?:string, title?:string, durationSec?:number, count?:number, error?:string, friendly?:string}>}
 */
export async function downloadAndSend({ url, onebot, sender = null, kind, chatId, params = {} }) {
  const link = String(url || '').trim();
  if (!link) return { ok: false, platform: '', error: '空链接' };

  const platform = detectPlatform(link);
  if (!platform) return { ok: false, platform: '', error: '不是 B站/抖音链接' };

  try {
    if (platform === 'bilibili') {
      const bvid = await resolveBvid({ url: link }, { onebot });
      const r = await biliDownload(bvid, { onebot, sender, kind, chatId, params });
      return { ok: true, platform, kind: 'video', title: r.title, durationSec: r.dur, filePath: r.filePath };
    }
    const awemeId = await resolveAwemeId({ url: link }, { onebot });
    const r = await dyDownload(awemeId, { onebot, sender, kind, chatId, params });
    return {
      ok: true, platform, kind: r.kind, title: r.title,
      durationSec: r.dur ?? null, count: r.count ?? null, filePath: r.filePath ?? null
    };
  } catch (error) {
    const message = String(error?.message ?? error);
    return { ok: false, platform, error: message, friendly: briefFailure(platform, error) };
  }
}

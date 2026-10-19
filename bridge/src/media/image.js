// 随机图（2026-09-19 加；2026-09-20 加 Pixiv 源）
//
// 想解决的事：群里有人来一句"来张图""发张猫"，机器人以前只能干看着。
//
// 图源（都是公开 API，不需要 key）：
//   - nekos.life  动漫系（neko/waifu/fox_girl…）
//   - thecatapi    猫
//   - dog.ceo      狗
//   - Pixiv        → 经第三方公开 API `api.lolicon.app`（境内可直连），图走 `i.pixiv.re` 反代
//
// ⚠️ 踩过的坑，别再踩（后面几条是从 QQ Agent 的 random-image 实现里学来的，
//    那边的下载基建比这里复杂得多，但这几条是通用的）：
//   1. nekos.best / waifu.im 被 Cloudflare 挡；waifu.pics 返回空 body；
//      nekosapi.com 的 v3 路径 404 —— 这四个都试过，用不了，别再加回来。
//   2. 分类**必须**由调用方明确指定，或者从下面这张表里随机挑。
//      不要写"把群里说的话当分类直接拼进 URL" —— 那等于把 URL 拼装权交出去，
//      接口对分类是"不认就 404、认了就照发"，中间没有任何过滤。
//   3. 只查文件头不够。下载中断的图**文件头是好的**，QQ 里表现为"加载不完全"。
//      必须连文件尾一起校验（JPEG 的 FFD9 / PNG 的 IEND / GIF 的 3B）。
//   4. 扩展名按**文件内容**定，不能按 Content-Type 或来源猜 ——
//      协议端有按扩展名判类型的，GIF 存成 .jpg 会被当成静态图。
//   5. 本地文件给协议端要用规范的 `file:///C:/...` URI（路径里的空格/中文要转义），
//      并且 file:// 这条路失败时要能自动回退 base64 —— 协议端不同机、
//      路径不可读、权限不足，都会让它失败。
//
// ── Pixiv 源的实测结论（2026-09-20，别凭直觉改）───────────────────────────
//   · **Pixiv 官方站 / CDN / API 在境内全域超时**（www.pixiv.net、i.pximg.net、
//     app-api.pixiv.net 全挂），项目里那份 pximg 镜像列表也全是 pximg 子域 ⇒ 同样不可用。
//     能用的只有第三方反代：API 走 api.lolicon.app，图片走 i.pixiv.re。
//   · **`r18=0` 参数不可靠**：实测抽 40 条，仍有 2 条（5%）标签里明写 `R-18`。
//     所以**不能只靠这个参数**，必须叠一层本地标签黑名单（见 PIXIV_BAD_TAGS）。
//   · `size` 参数：`original` 常是几千 px 的大图、实测下载会超时；
//     `regular` 给的是 `_master1200` 版本，实测约 400KB —— **用 regular**。
//   · 多 tag 是 **AND** 关系；`tag` 是精确标签匹配，`keyword` 是模糊搜索（标题/简介也搜）。
//   · 这两个反代都是第三方服务，**随时可能挂**。挂了要如实报错，不要静默回退成别的图源。
import fs from 'node:fs';
import path from 'node:path';
import { safeFetchBinary, setFetchProxy } from './safe-fetch.js';
import { DATA_DIR, getConfig } from './_bridge-config.js';

// 代理（media.proxy）**只用于 Pixiv 官方 CDN `i.pximg.net` 的图片下载**，见下方调用点的
// `useProxy`。2026-09-21 改：之前是"模块加载时全局设一次"，导致 B站/抖音/其它图源的请求
// 也全被塞进代理 —— v2rayN 一退出就把 B站搜索一起带死（事故记录在 safe-fetch.js 顶部）。
// 实测（2026-09-21，代理未运行）：lolicon API、nekos.life、thecatapi、dog.ceo、
// api.bilibili.com **直连全部可达**；只有 i.pximg.net 直连 10.5s 超时。
// ⚠️ 改配置里的代理地址仍需重启桥才生效（和别的配置一致）。
try {
  const px = String(getConfig()?.media?.proxy ?? '').trim();
  if (px) setFetchProxy(px);
} catch { /* 配置读不到就不设代理，维持直连 */ }

/** 分类 → 取图接口。分类名对外暴露，值都是固定的 https 公网地址。 */
export const IMAGE_CATEGORIES = {
  // ── 角色图（nekos.life）
  neko:       'https://nekos.life/api/v2/img/neko',        // 猫娘
  waifu:      'https://nekos.life/api/v2/img/waifu',       // 动漫少女
  fox_girl:   'https://nekos.life/api/v2/img/fox_girl',    // 狐娘
  avatar:     'https://nekos.life/api/v2/img/avatar',      // 头像
  wallpaper:  'https://nekos.life/api/v2/img/wallpaper',   // 壁纸
  // ── 反应动图（nekos.life，GIF）
  pat:        'https://nekos.life/api/v2/img/pat',         // 摸摸头
  hug:        'https://nekos.life/api/v2/img/hug',         // 抱抱
  cuddle:     'https://nekos.life/api/v2/img/cuddle',      // 蹭蹭
  kiss:       'https://nekos.life/api/v2/img/kiss',        // 亲亲
  smug:       'https://nekos.life/api/v2/img/smug',        // 得意脸
  slap:       'https://nekos.life/api/v2/img/slap',        // 一巴掌
  tickle:     'https://nekos.life/api/v2/img/tickle',      // 挠痒痒
  feed:       'https://nekos.life/api/v2/img/feed',        // 投喂
  // ── 动物
  meow:       'https://nekos.life/api/v2/img/meow',        // 猫（部分为真实照片）
  lizard:     'https://nekos.life/api/v2/img/lizard',      // 蜥蜴
  goose:      'https://nekos.life/api/v2/img/goose',       // 鹅
  cat:        'https://api.thecatapi.com/v1/images/search',
  dog:        'https://dog.ceo/api/breeds/image/random',
  // ── Pixiv（需要 query 参数，见 fetchPixivImage）
  pixiv:      'pixiv://search'
};

// ⚠️ 这几个分类**实测稳定报 HTTP 500**（不是限流，直接请求也是 500）：
//    kitsune / husbando / kemonomimi / holo / poke / waifu2 / owo / gecg / 8ball
//    已经从表里剔掉了，别再加回来。
export const DEFAULT_CATEGORY = 'neko';

const UA = 'qq-bridge/0.1 (+random-image)';

// ── Pixiv（经第三方反代）────────────────────────────────────────────────
const LOLICON_API = 'https://api.lolicon.app/setu/v2';

/**
 * 标签黑名单：命中任意一条就丢弃、换一张。
 *
 * ⚠️ 为什么必须有它：接口的 `r18=0` **实测漏 5%**（抽 40 条里 2 条带 `R-18` 标签），
 *    只靠那个参数不够。
 *
 * ⚠️ 但也要知道它的**本质局限**：Pixiv 的标签词汇是无限的
 *    （日文汉字/平假名/片假名/罗马字/中英混排都有），**永远堵不完**。
 *    实测踩到的例子：我一开始只写了「縛」，漏了片假名「ボンデージ」，就漏了一张。
 *    所以这张表是**兜底**，不是保证 —— 一旦发现新的漏网词，直接加到 config 里
 *    （`media.pixivBadTags`），不用改代码。
 *
 * 另外刻意**不拦**这些容易被误伤的日常词：水着(泳装)、裸足(赤脚)、黒タイツ(黑丝袜)、
 *    腋 —— 它们大量出现在正常插画上，拦了会把图库砍掉一大半（实测能砍掉 80%）。
 */
export const PIXIV_BAD_TAGS = [
  // 分级标记（接口漏出来的主要就是这类）
  'r-18', 'r18', '18禁', '成人', '成年向', 'r-18g',
  // 中文
  '色情', '福利', '涩图', '黄图', '擦边', '露点', '全裸', '裸体', '乳', '內衣', '内衣',
  '内裤', '胖次', '情趣', '捆绑', '拘束', '调教', '奴隷', '奴隶', '痴汉', '痴女',
  // 日文（汉字 / 假名 / 片假名都要盖）
  'エロ', 'えろ', 'エッチ', 'えっち', 'ヌード', 'おっぱい', '巨乳', '爆乳', '貧乳',
  'ぱんつ', 'パンツ', 'ブラジャー', '下着', 'ショーツ', 'ふともも', '太もも',
  'ボンデージ', '緊縛', '縛り', '陵辱', '中出し', 'フェラ', '手コキ', '足コキ',
  'おまんこ', 'ちんこ', 'まんこ', '絶頂', 'アクメ', 'オナニー', '自慰', '喘ぎ',
  'レイプ', '孕み', '妊娠', '触手', 'ふたなり', '寝取', 'ntr', 'ロリ', 'loli',
  '幼女', '少女', '痴態', '淫', '媚薬', '性感', '発情',
  // 英文
  'nsfw', 'nude', 'naked', 'topless', 'lingerie', 'panties', 'underwear', 'bra',
  'nipple', 'breasts', 'cleavage', 'bondage', 'bdsm', 'hentai', 'ecchi',
  'sex', 'penetration', 'cum', 'ahegao', 'fetish', 'lewd', 'erotic',
  // 不想要的（非分级问题，但发群里不合适）
  'グロ', 'guro', 'gore', '猟奇', 'リョナ', 'r-18g',
  // AI 生成（群里发 AI 图容易引起争议，默认不取）
  'aiイラスト', 'ai画作', 'ai生成', 'ai-generated', 'aiart'
];

/** 图片宽高比超出这个范围就换一张（极长条图在 QQ 里很难看）。 */
/** 图片宽高比上限的**后备值**（2026-09-21 起主逻辑在 fetchPixivImage 里按 r18 动态取 3.5/4.5，
 *  这里保留旧常量只为可读性——实际不再被引用）。 */
const PIXIV_MAX_RATIO = 2.6;

/** 从三个源的不同返回格式里统一抠出图片地址。 */
function pickUrl(category, json) {
  if (!json || typeof json !== 'object') return '';
  if (category === 'cat') {
    const first = Array.isArray(json) ? json[0] : null;
    return String(first?.url ?? '');
  }
  if (category === 'dog') return String(json.message ?? '');
  return String(json.url ?? '');   // nekos.life 的字段名就叫 url
}

/** 按魔数判类型（不信 Content-Type，也不信来源）。 */
export function detectMime(buf) {
  if (!buf || buf.length < 12) return '';
  if (buf[0] === 0xFF && buf[1] === 0xD8) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
  if (buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return '';
}

/**
 * 图片完整性校验：头 + **尾**都要对。
 * 只看头会放过"下到一半断掉"的图，那种图发到群里就是"加载不完全"。
 */
export function validateImageIntegrity(buf) {
  if (!buf || buf.length < 12) return false;
  const mime = detectMime(buf);
  if (!mime) return false;
  if (mime === 'image/jpeg') {
    // 末尾 64 字节内找 FFD9
    for (let i = buf.length - 2; i >= Math.max(0, buf.length - 64); i -= 1) {
      if (buf[i] === 0xFF && buf[i + 1] === 0xD9) return true;
    }
    return false;
  }
  if (mime === 'image/png') {
    // PNG 以 IEND chunk 收尾：长度 00000000 + "IEND" + CRC AE426082（固定值）
    const t = buf.length;
    for (let i = t - 8; i >= Math.max(4, t - 72); i -= 1) {
      if (i + 7 <= t - 1
        && buf[i - 4] === 0x00 && buf[i - 3] === 0x00 && buf[i - 2] === 0x00 && buf[i - 1] === 0x00
        && buf[i] === 0x49 && buf[i + 1] === 0x45 && buf[i + 2] === 0x4E && buf[i + 3] === 0x44
        && buf[i + 4] === 0xAE && buf[i + 5] === 0x42 && buf[i + 6] === 0x60 && buf[i + 7] === 0x82) return true;
    }
    return false;
  }
  if (mime === 'image/gif') return buf[buf.length - 1] === 0x3B;
  return true;   // webp：尾部没有稳定魔数，头对了就收
}

function extOf(mime) {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/gif') return 'gif';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
}

// ── 冷却 + 去重（防止"连点几下，群里刷一屏图"）──────────────────────────
const state = { lastSentAt: 0, sent: new Set(), order: [] };
const DEDUP_CAP = 200;

function recentlySent(url) {
  return state.sent.has(url);
}

function rememberSent(url) {
  state.lastSentAt = Date.now();
  if (!url || state.sent.has(url)) return;
  state.sent.add(url);
  state.order.push(url);
  while (state.order.length > DEDUP_CAP) state.sent.delete(state.order.shift());
}

/**
 * 把下载到的字节校验后落盘，返回成功结果（两侧共用，避免 Pixiv 分支漏掉校验）。
 * 校验三件事：① 文件头是不是真图 ② 文件尾有没有下全 ③ 扩展名按内容定。
 */
function saveImageBuffer(buf, tag, maxBytes) {
  const fail = (msg) => ({ ok: false, error: msg });
  if (!buf || buf.length > maxBytes) return fail(`图片太大（${((buf?.length || 0) / 1048576).toFixed(1)}MB）`);
  const mime = detectMime(buf);
  if (!mime) return fail('取回来的不是图片（文件头不对，图源可能抽风返了网页）');
  if (!validateImageIntegrity(buf)) return fail('图没下全（尾部标记缺失），换一张');
  const ext = extOf(mime);
  const dir = path.join(DATA_DIR, 'images');
  fs.mkdirSync(dir, { recursive: true });
  sweepOld(dir);
  const file = path.join(dir, `rand-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`);
  fs.writeFileSync(file, buf);
  return { ok: true, bytes: buf.length, ext, file, mime };
}

/**
 * Pixiv 取图（经第三方反代）。
 *
 * 与其它图源的**本质区别**：这里不是"随机抽一张"，而是**按标签搜**。
 * 原因（实测）：随机抽等于"从整个 Pixiv 里抽"，而 Pixiv 的 NSFW 占比不低，
 * 纯靠标签黑名单堵不住；按标签搜至少把范围收窄到一个可控的词。
 *
 * @param {object} o
 *   query      Pixiv 标签（必填）。多词用空格分隔 → 走 AND（实测是 AND 关系）
 *   maxBytes   体积上限
 *   badTags    额外黑名单（来自 config，用来堵新发现的漏网词）
 */
export async function fetchPixivImage({ query, maxBytes = 8 * 1024 * 1024, badTags = [], r18: rn = false } = {}) {
  const fail = (msg) => ({ ok: false, category: 'pixiv', url: '', bytes: 0, ext: 'jpg', file: '', error: msg });
  const q = String(query || '').trim();
  if (!q) return fail('Pixiv 图源必须给一个标签（例如「原神」「猫耳」）');

  // ── 黑名单分层（2026-09-21 按用户要求放宽）────────────────────────────
  // ① 分级标记 / 猎奇：**任何状态都拦**（r18=0 参数实测漏 5%，这是唯一硬防线）
  // ② 露出类（中文/日文/英文的露骨词）：**只在没开 R18 开关时拦**
  // ③ AI 生成标记：**默认不拦了**（用户 2026-09-21 明确要求"AI 图也放行"；
  //    原来的理由见下方注释）
  const HARD_BAD = ['r-18', 'r18', '18禁', '成年向', 'r-18g', 'グロ', 'guro', 'gore', '猟奇', 'リョナ'];
  const ADULT_BAD = PIXIV_BAD_TAGS.filter(
    (t) => !HARD_BAD.includes(t) && !/^ai/i.test(t) && !t.startsWith('ai')
  );
  const r18 = rn === true;
  const blacklist = [
    ...HARD_BAD,
    ...(r18 ? [] : ADULT_BAD),
    ...(Array.isArray(badTags) ? badTags : [])
  ].map((t) => String(t).toLowerCase().trim()).filter(Boolean);
  const isBad = (tags) => {
    const low = (tags || []).map((t) => String(t).toLowerCase());
    for (const t of low) for (const b of blacklist) if (t.includes(b)) return t;
    return '';
  };

  // num 取多一点：接口返回里会混进被拦的，留出挑选余量
  // excludeAI=1 是尽量少收 AI 图（⚠️ 实测**不完整**：返回里仍会有带 AI 标签的，
  // 所以 PIXIV_BAD_TAGS 里那条 ai 标签不能删）
  const params = new URLSearchParams({ num: '20', r18: '0', size: 'regular', excludeAI: '1', tag: q });
  let data = [];
  let lastApiError = '';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const meta = await safeFetchBinary(`${LOLICON_API}?${params}`, 512 * 1024, {
        headers: { Accept: 'application/json', 'User-Agent': UA }, timeoutMs: 20000
      });
      const json = JSON.parse(meta.buffer.toString('utf8'));
      data = Array.isArray(json?.data) ? json.data : [];
      lastApiError = '';
      break;
    } catch (error) {
      lastApiError = String(error?.message ?? error);
      // 429 是窗口式限流（实测等 20 秒即恢复），退避重试一次再放弃
      if (/429/.test(lastApiError) && attempt < 2) {
        await new Promise((r) => setTimeout(r, 6000 * (attempt + 1)));
        continue;
      }
      break;
    }
  }
  // ── r18 时补取一批 r18 候选（2026-09-21 加）─────────────────────────
  // 为什么：上面那次请求带的是 r18=0，池子里几乎没有成人向图；用户在开了 R18
  // 的会话里要"放开一点"，光放宽黑名单不够，池子本身也得有货。所以开 R18 时
  // 再按 r18=1 取一批并进池 —— 仍然逐张过黑名单（HARD_BAD 兜底）。
  if (!lastApiError && r18) {
    try {
      const p2 = new URLSearchParams({ num: '20', r18: '1', size: 'regular', excludeAI: '1', tag: q });
      const meta2 = await safeFetchBinary(`${LOLICON_API}?${p2}`, 512 * 1024, {
        headers: { Accept: 'application/json', 'User-Agent': UA }, timeoutMs: 20000
      });
      const json2 = JSON.parse(meta2.buffer.toString('utf8'));
      const data2 = Array.isArray(json2?.data) ? json2.data : [];
      if (data2.length) { data = data.concat(data2); console.log(`[pixiv] R18 放行：补取 ${data2.length} 条 r18 候选`); }
    } catch { /* 补取失败不影响主流程：继续用 r18=0 那批 */ }
  }
  if (lastApiError) {
    return fail(`Pixiv 图源（lolicon API）取不到数据：${lastApiError}。`
      + (/429/.test(lastApiError) ? '这是接口限流（连发太快），等几十秒再试。' : '')
      + `注意这是第三方反代，可能已经挂了——挂了就只能换别的图源，不要指望它自己恢复。`);
  }
  if (!data.length) return fail(`Pixiv 上没有标签为「${q}」的图（换个词试试；多词之间是 AND 关系，写太多会搜不到）`);

  // 打乱候选顺序，避免每次都发同一个标签下的同一张
  const pool = data.filter((d) => d && (d.urls?.regular || d.urls?.original)).sort(() => Math.random() - 0.5);

  let lastError = '';
  // 候选池上限 8 → 12（① 放宽，2026-09-21）：池子小的时候容易被黑名单/比例过滤空，
  // 12 张给足挑选余量（每张只是元数据，不下载，成本为零）
  for (const d of pool.slice(0, 12)) {
    // ① 接口自己标的 r18 字段（虽然实测不可靠，但为真时一定丢）
    if (d.r18 === true) { lastError = `丢弃一张 r18 标记的图（pid ${d.pid}）`; continue; }
    // ② 标签黑名单（主要防线 —— 接口的 r18=0 实测会漏 5%）
    const hit = isBad(d.tags);
    if (hit) { lastError = `丢弃一张命中黑名单「${hit}」的图（pid ${d.pid}）`; continue; }
    // ③ 宽高比：太长的条图在 QQ 里很难看
    const w = Number(d.width) || 0; const h = Number(d.height) || 0;
    // ③ 宽高比：太长的条图在 QQ 里很难看（① 放宽：2.6→3.5；R18 放行时放到 4.5，
    //    因为成人向插画里竖构图立绘比例更高，2.6 会把大量正常立绘误伤掉）
    if (w > 0 && h > 0 && Math.max(w / h, h / w) > (rn === true ? 4.5 : 3.5)) {
      lastError = `丢弃一张比例过长的图（${w}x${h}）`; continue;
    }
    const imgUrl = String(d.urls?.regular || d.urls?.original || '');
    if (!/^https:\/\//i.test(imgUrl)) { lastError = '图源没给出可用的图片地址'; continue; }
    if (recentlySent(imgUrl)) { lastError = '这张刚发过，换一张'; continue; }

    // 尝试顺序（2026-09-20 实测确定的）：
    //   ① **Pixiv 官方 CDN** `i.pximg.net` —— 路径和反代完全一样，直接换域名即可。
    //      实测：直连境内超时；**挂了本机代理后 684 KB/s**（1006KB 的图 1.5 秒）。
    //      需要 Referer 指向 pixiv，否则 403。
    //   ② 第三方反代 `i.pixiv.re` —— 不用代理也能下，但只有 14~27 KB/s，还常超时。
    //      作为兜底（没配代理时唯一能走的路）。
    const isPximg = /^https:\/\/i\.pixiv\.re\//i.test(imgUrl);
    const attempts = isPximg
      ? [imgUrl.replace(/^https:\/\/i\.pixiv\.re\//i, 'https://i.pximg.net/'), imgUrl]
      : [imgUrl];

    for (const tryUrl of attempts) {
      // 只有**官方 CDN** 才走代理（i.pximg.net 直连超时）；反代 i.pixiv.re 本身国内可达，
      // 走代理反而多一跳、且代理挂了会连带失败。
      const viaCdn = tryUrl.includes('i.pximg.net');
      try {
        // regular 实测约 400KB；为了防大图还是真取回来（不取就发 = 迟早裂图）
        const img = await safeFetchBinary(tryUrl, maxBytes, {
          headers: { Accept: 'image/*', 'User-Agent': UA, Referer: 'https://www.pixiv.net/' },
          timeoutMs: viaCdn ? 45000 : 25000,
          useProxy: viaCdn
        });
        const saved = saveImageBuffer(img.buffer, 'pixiv', maxBytes);
        if (!saved.ok) { lastError = saved.error; continue; }
        rememberSent(imgUrl);
        return {
          ok: true, category: 'pixiv', url: imgUrl, bytes: saved.bytes, ext: saved.ext, file: saved.file,
          title: String(d.title || ''), author: String(d.author || ''), pid: d.pid, tags: (d.tags || []).slice(0, 6),
          via: tryUrl === imgUrl ? '反代' : '官方CDN'
        };
      } catch (error) {
        const msg = String(error?.message ?? error);
        lastError = `下载失败（${viaCdn ? '官方CDN' : '反代'}）：${msg}`;
        // 代理进程没开（v2rayN 退出）时别在 CDN 上耗 45 秒：本机代理连接被拒 =
        // 这条路这次一定不通 ⇒ 立刻 continue 落到反代兜底（慢但能用）。
        // ⚠️ 这里必须是 continue 不是 break —— break 会把反代也一起跳过（第一版写错了，
        //    实测表现为"代理没开时整条 Pixiv 取图直接失败"）。
        if (viaCdn && /ECONNREFUSED|ECONNRESET|代理 CONNECT/.test(msg)) {
          lastError = `本机代理（media.proxy）没在运行，已跳过官方 CDN：${msg}`;
          continue;
        }
      }
    }
  }
  return fail(`「${q}」的候选图都不合格（${lastError || '全部被过滤'}）。`
    + `注意：如果一直是这样，说明黑名单可能过严，或者这个标签本身擦边图太多，换个词试试。`
    + `（若要 Pixiv 又快又稳，需要在本机代理里放行 i.pximg.net，并配好 media.proxy）`);
}

/**
 * 按分类取一张随机图，**字节已经拿到手并落盘**。
 *
 * @param {object} o
 *   category    分类（见 IMAGE_CATEGORIES）；不传走 defaultCategory
 *   maxBytes    体积上限，超了换一张（默认 8MB）
 *   cooldownMs  冷却：距上次发图不足这个毫秒数就拒绝（默认 0=不限）
 * @returns {Promise<{ok:boolean, category:string, url:string, bytes:number, ext:string, file:string, error?:string}>}
 */
export async function fetchRandomImage({ category, maxBytes = 8 * 1024 * 1024, cooldownMs = 0, query = '', badTags = [], r18 = false } = {}) {
  const cat = String(category || DEFAULT_CATEGORY).trim() || DEFAULT_CATEGORY;
  const fail = (msg) => ({ ok: false, category: cat, url: '', bytes: 0, ext: 'jpg', file: '', error: msg });

  // Pixiv 走自己的分支：它不是"随机抽一张"，而是"按标签搜"（原因见 fetchPixivImage 注释）
  if (cat === 'pixiv') {
    const cdP = Math.max(0, Number(cooldownMs) || 0);
    if (cdP > 0 && Date.now() - state.lastSentAt < cdP) {
      const wait = Math.ceil((cdP - (Date.now() - state.lastSentAt)) / 1000);
      return fail(`刚发过图，冷却中（还要等 ${wait} 秒）`);
    }
    return await fetchPixivImage({ query, maxBytes, badTags, r18 });
  }

  const api = IMAGE_CATEGORIES[cat];
  if (!api) return fail(`不认识的分类「${cat}」（可用：${Object.keys(IMAGE_CATEGORIES).join('、')}）`);

  const cd = Math.max(0, Number(cooldownMs) || 0);
  if (cd > 0 && Date.now() - state.lastSentAt < cd) {
    const wait = Math.ceil((cd - (Date.now() - state.lastSentAt)) / 1000);
    return fail(`刚发过图，冷却中（还要等 ${wait} 秒）`);
  }

  // 换图重试：源偶尔给出坏图/超大图/重复图，最多试 4 次
  let lastError = '';
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      // 1) 问接口要一个图片地址
      const meta = await safeFetchBinary(api, 256 * 1024, {
        headers: { Accept: 'application/json', 'User-Agent': UA },
        timeoutMs: 15000
      });
      let json = null;
      try { json = JSON.parse(meta.buffer.toString('utf8')); } catch { json = null; }
      const imgUrl = pickUrl(cat, json);
      if (!imgUrl || !/^https:\/\//i.test(imgUrl)) {
        lastError = `图源没给出可用的图片地址（拿到的是「${imgUrl || '空'}」）`;
        continue;
      }
      if (recentlySent(imgUrl)) { lastError = '这张刚发过，换一张'; continue; }

      // 2) 真把图取回来 —— 不取就发，迟早在群里变裂图
      const img = await safeFetchBinary(imgUrl, maxBytes, {
        headers: { Accept: 'image/*', 'User-Agent': UA },
        timeoutMs: 30000
      });
      // 3) 校验 + 落盘（与 Pixiv 分支共用，保证两条路都过同样的检查）
      const saved = saveImageBuffer(img.buffer, cat, maxBytes);
      if (!saved.ok) { lastError = saved.error; continue; }
      rememberSent(imgUrl);
      return { ok: true, category: cat, url: imgUrl, bytes: saved.bytes, ext: saved.ext, file: saved.file };
    } catch (error) {
      lastError = String(error?.message ?? error);
    }
  }
  return fail(lastError || '取图失败');
}

/** 清掉 24 小时前的随机图，免得目录里越堆越多（best-effort，失败不管）。 */
function sweepOld(dir) {
  try {
    const cutoff = Date.now() - 24 * 3600 * 1000;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      try { if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full); } catch { /* 单个失败忽略 */ }
    }
  } catch { /* 目录读不到就算了 */ }
}

/**
 * 本地路径 → 协议端认的 `file:///C:/...` URI。
 *
 * ⚠️ 坑：**盘符的冒号不能转义**。早先图省事把整条路径逐段 encodeURIComponent，
 *    结果 `E:/...` 变成 `E%3A/...`，协议端认不出来。
 *    正确做法是先在路径分隔符上切开，保留 `E:`，只对**盘符之后**的部分转义
 *    （空格、中文、`#` 这些才真的需要转义）。
 * 已经是 file:// 的原样返回（幂等）。UNC（\\server\share）→ file://server/share。
 */
export function toFileUri(p) {
  const s = String(p || '');
  if (!s) return '';
  if (/^file:\/\//i.test(s)) return s;
  const norm = s.replace(/\\/g, '/');
  const enc = (seg) => encodeURIComponent(seg).replace(/%2F/gi, '/');
  if (norm.startsWith('//')) {
    // UNC：前两段是主机名和共享名，不转义主机名
    const m = /^\/\/([^/]+)(\/.*)?$/.exec(norm);
    if (!m) return `file:${norm}`;
    const rest = (m[2] || '').split('/').map(enc).join('/');
    return `file://${m[1]}${rest}`;
  }
  const m = /^([A-Za-z]:)(\/.*)?$/.exec(norm);
  if (m) {
    const rest = (m[2] || '').split('/').map(enc).join('/');
    return `file:///${m[1]}${rest}`;
  }
  const rest = norm.split('/').map(enc).join('/');
  return `file:///${rest.replace(/^\/+/, '')}`;
}

/** 分类列表（给端点自检 / 报错提示用）。 */
export function listCategories() {
  return Object.keys(IMAGE_CATEGORIES);
}

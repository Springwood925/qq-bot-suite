// 梗百科 / 黑话词典（2026-11-01 移植自 thawline/dsh-memewiki，MIT 代码 / 词库数据版权归原作者与 cnmeme.wiki）。
// 只做三件事：读词库、判断消息像不像在问梗、生成一小段注入文本。
// 不联网、不发请求、不改记忆树；词库只读打开，打不开就当功能不存在（不影响桥启动）。
import { DatabaseSync } from 'node:sqlite';

const MAX_QUERY_CHARS = 24;
const MAX_HITS = 2;              // 一轮最多注入几条
const MAX_SUMMARY = 180;         // 每条释义截断
const MIN_CONTAINS_QUERY = 3;    // 「标题包含查询词」要求查询 >=3 字，避免两字乱中

// 问梗句式：命中这些才算「在问梗」，纯闲聊不查。
const ASK_PATTERNS = [
  /是什么梗/, /什么梗/, /啥梗/, /这梗/, /梗是啥/, /梗是什么意思/,
  /什么意思啊?$/, /啥意思啊?$/, /是什么东西/, /什么来头/,
  /怎么来的/, /出自哪/, /哪儿来的/, /谁懂啊?/, /有没有人懂/,
  /这词什么/, /这词什么意思/, /啥玩意儿/, /什么东西啊?$/
];

// 裸词查询：整条消息就是 2~8 个字，没有别的句子成分。
const BARE_WORD = /^[\u4e00-\u9fa5A-Za-z0-9]{2,8}$/;

// 停用词/太通用的词，查了也没意义。
const STOPWORDS = new Set([
  '什么', '怎么', '为什么', '这个', '那个', '这样', '那样', '是不是', '有没有',
  '可以', '不是', '就是', '还是', '已经', '现在', '今天', '明天', '昨天',
  '知道', '觉得', '感觉', '应该', '可能', '真的', '确实', '有点', '一些',
  '哈哈', '嘿嘿', '嗯嗯', '好的', '收到', '谢谢', '再见', '晚安',
  'the', 'and', 'for', 'you', 'are', 'this', 'that', 'what', 'how'
]);

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function bare(value) {
  return String(value ?? '').replace(/[，。！？、；：,.!?;:\s"'"'（）()【】\[\]]/g, '');
}

export function createMemeWiki({ file, log = () => {} } = {}) {
  if (!file) throw new Error('meme-wiki 需要词库路径');
  let db = null;
  let broken = null;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    db.prepare('SELECT count(*) AS c FROM memes').get();
  } catch (error) {
    broken = String(error?.message ?? error);
    db = null;
    log('梗词库未加载（' + file + '）：' + broken);
  }
  if (!db) {
    return {
      available: false,
      error: broken,
      stats: () => ({ available: false, error: broken }),
      lookup: () => [],
      probe: () => ({ hits: [], text: '' }),
      search: () => []
    };
  }

  const stated = new Map();
  const statementFor = (sql) => {
    if (stated.has(sql)) return stated.get(sql);
    const prepared = db.prepare(sql);
    stated.set(sql, prepared);
    return prepared;
  };

  function rowToHit(row, via) {
    const summary = clean(row.summary);
    return {
      title: clean(row.title),
      tags: clean(row.tags),
      usage: clean(row.usage),
      origin: clean(row.origin),
      summary: summary.length > MAX_SUMMARY ? summary.slice(0, MAX_SUMMARY) + '…' : summary,
      via
    };
  }

  // 精确标题 → 别名 → 标题包含查询词（查询 >=3 字）。
  function lookup(query) {
    const q = clean(query);
    if (!q || [...q].length > MAX_QUERY_CHARS) return [];
    const hits = [];
    const seen = new Set();
    const push = (row, via) => {
      if (!row) return;
      const key = clean(row.title);
      if (!key || seen.has(key)) return;
      seen.add(key);
      hits.push(rowToHit(row, via));
    };
    push(statementFor('SELECT * FROM memes WHERE title = ?').get(q), 'exact');
    if (!hits.length) {
      push(statementFor('SELECT * FROM memes WHERE aliases = ? OR slug = ?').get(q, q), 'alias');
    }
    if (!hits.length && [...q].length >= MIN_CONTAINS_QUERY) {
      const rows = statementFor('SELECT * FROM memes WHERE title LIKE ? LIMIT 3').all('%' + q + '%');
      for (const row of rows) push(row, 'contains-title');
    }
    return hits;
  }

  // 这条消息像不像在问梗：问句里有梗名，或整条就是一个裸词。
  function looksLikeProbe(message) {
    const text = clean(message);
    if (!text) return false;
    // 只认问梗句式：完整句子（如「今天天气不错」）不能被当成裸词。
    return ASK_PATTERNS.some((pattern) => pattern.test(text));
  }

  // 从一句话里抽候选词：中文 2~6 字片段、英文 2~20 字母数字。
  function candidates(text) {
    const out = new Set();
    let source = clean(text);
    for (const pattern of ASK_PATTERNS) source = source.replace(pattern, ' ');
    source = source.replace(/[吗呢吧啊呀哦噢嘛咯啦的了吗]/g, ' ');
    for (const run of source.match(/[\u4e00-\u9fa5]{2,}/g) || []) {
      for (let size = 6; size >= 2; size--) {
        for (let i = 0; i + size <= run.length; i++) {
          out.add(run.slice(i, i + size));
        }
      }
    }
    for (const word of source.match(/[A-Za-z][A-Za-z0-9]{1,19}/g) || []) {
      out.add(word.toLowerCase());
    }
    // 中英混排短词（如「栓Q」「emo了」）：中文和字母数字混在一起时，中文片段和字母片段都拿不到，单独抽一次。
    for (const chunk of source.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,12}/g) || []) {
      const chars = [...chunk];
      out.add(chunk);
      out.add(chunk.toLowerCase());
      // 混排块也要枚举子串，否则「栓Q是什么意思」整块查不到「栓Q」。
      for (let size = Math.min(6, chars.length); size >= 2; size--) {
        for (let i = 0; i + size <= chars.length; i++) {
          const sub = chars.slice(i, i + size).join('');
          out.add(sub);
          out.add(sub.toLowerCase());
        }
      }
    }
    return [...out].filter((word) => !STOPWORDS.has(word.toLowerCase()));
  }

  // 预查：只看最近若干条里「像在问梗」的那些，命中就返回一条可注入的文本。
  function probe(messages, { budget = 200, maxHits = MAX_HITS } = {}) {
    const list = Array.isArray(messages) ? messages : [];
    const picked = [];
    const seen = new Set();
    let used = 0;
    for (let index = list.length - 1; index >= 0 && picked.length < maxHits; index--) {
      const text = clean(list[index]);
      if (!text || !looksLikeProbe(text)) continue;
      let hits = lookup(text);
      if (!hits.length) {
        for (const word of candidates(text)) {
          const found = lookup(word);
          if (found.length) { hits = found; break; }
        }
      }
      if (!hits.length) continue;
      const hit = hits[0];
      if (seen.has(hit.title)) continue;
      const line = '· ' + hit.title + (hit.summary ? '：' + hit.summary : '');
      if (used + [...line].length > budget) continue;
      used += [...line].length;
      seen.add(hit.title);
      picked.push(hit);
    }
    if (!picked.length) return { hits: [], text: '' };
    const text = '【梗】' + picked.map((hit) => hit.title + (hit.summary ? '：' + hit.summary : '')).join('\n【梗】');
    return { hits: picked, text, usedChars: used, budget };
  }

  function search(query, limit = 5) {
    const q = clean(query);
    if (!q) return [];
    const rows = statementFor('SELECT * FROM memes WHERE title LIKE ? LIMIT ?').all('%' + q + '%', Math.min(Math.max(Number(limit) || 5, 1), 20));
    return rows.map((row) => rowToHit(row, 'search'));
  }

  function stats() {
    const total = db.prepare('SELECT count(*) AS c FROM memes').get().c;
    return { available: true, total, file };
  }

  return { available: true, lookup, probe, search, stats, looksLikeProbe };
}

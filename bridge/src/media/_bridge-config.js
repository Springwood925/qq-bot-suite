// 配置适配层（2026-09-19 搬 B站/抖音解析时加）
//
// 搬过来的 safe-fetch.js / bili.js / media-common.js 原本 import 的是 QQ Agent 的
// src/config.js。它们其实只用到 getConfig().security 的两个字段和 DATA_DIR，
// 所以这里用桥自己的 config.json 顶上，不把整个 config.js 拖进来。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..', '..');
// 下载产物落这儿（state/media/），跟桥的其他状态放一起
export const DATA_DIR = path.join(ROOT, 'state', 'media');

let cache = null;
let cacheAt = 0;
export function getConfig() {
  // 5 秒缓存：config.json 很少改，别每个请求都读盘
  if (cache && Date.now() - cacheAt < 5000) return cache;
  try { cache = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')); }
  catch { cache = {}; }
  cacheAt = Date.now();
  return cache;
}

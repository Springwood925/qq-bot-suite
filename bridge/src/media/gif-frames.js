// ─────────────────────────────────────────────────────────────────────────────
// GIF 多帧展开（2026-09-25 加）
//
// 为什么需要：群友发**动图**时，桥原来只把第一帧塞给模型 —— 模型自己都说了
// 「动图我只看得到一帧」（它的 reasoning 原文：The image appears static here）。
// 这里把 GIF 解成若干关键帧、横向拼成一张 PNG，让模型能看出"动作的先后"。
//
// 设计约束：
//   ① **自己实现、零依赖**（GIF 解码是公开算法；PNG 编码用 node 自带 zlib）。
//      不移植第三方项目的代码 —— 桥要外发，不给自己留许可尾巴。
//   ② **任何失败都返回 null**，调用方拿不到就退回原来的单帧行为（新功能可以失败，
//      老功能不能受影响）。
//   ③ 输出体积可控（默认总宽不超过 1200px，超出按最近邻缩小）。
//
// 只在"取到的图确实是 GIF"时才会被调到，PNG/JPEG 一路直通、不走这里。
// ─────────────────────────────────────────────────────────────────────────────
import zlib from 'node:zlib';

/** 是不是 GIF（魔数 GIF87a / GIF89a） */
export function isGifBuffer(buf) {
  if (!buf || buf.length < 6) return false;
  const h = buf.toString('ascii', 0, 6);
  return h === 'GIF87a' || h === 'GIF89a';
}

// ── CRC32（PNG chunk 需要）──────────────────────────────────────────────────
let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i += 1) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** RGBA 像素 → PNG（8 位 / 颜色类型 6 = RGBA，每行 filter=0） */
export function encodePng(rgba, width, height) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  const src = Buffer.isBuffer(rgba) ? rgba : Buffer.from(rgba);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type 0
    src.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

// ── LZW 解码（GIF 变体：LSB 优先、clear/eoi 码、码长增长到 12 位）───────────
function lzwDecode(minCodeSize, data, expectedLen) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  const out = Buffer.alloc(expectedLen);
  let outPos = 0;

  let dict = [];
  let codeSize = minCodeSize + 1;
  let nextCode = clearCode + 2;
  let prev = null;
  let bitPos = 0;
  const resetDict = () => {
    dict = new Array(4096);
    for (let i = 0; i < clearCode; i += 1) dict[i] = [i];
    codeSize = minCodeSize + 1;
    nextCode = clearCode + 2;
    prev = null;
  };
  resetDict();

  const totalBits = data.length * 8;
  while (bitPos + codeSize <= totalBits) {
    let code = 0;
    for (let i = 0; i < codeSize; i += 1) {
      const bp = bitPos + i;
      code |= ((data[bp >> 3] >> (bp & 7)) & 1) << i;
    }
    bitPos += codeSize;

    if (code === clearCode) { resetDict(); continue; }
    if (code === eoiCode) break;

    let entry = null;
    if (code < nextCode && dict[code]) entry = dict[code];
    else if (code === nextCode && prev) entry = prev.concat([prev[0]]);
    else break; // 坏数据，能解多少算多少

    for (let i = 0; i < entry.length; i += 1) {
      if (outPos < out.length) out[outPos++] = entry[i];
      else break;
    }
    if (prev) {
      if (nextCode < 4096) {
        dict[nextCode] = prev.concat([entry[0]]);
        nextCode += 1;
        if (nextCode === (1 << codeSize) && codeSize < 12) codeSize += 1;
      }
    }
    prev = entry;
  }
  return out.subarray(0, outPos);
}

// ── GIF 解码 ───────────────────────────────────────────────────────────────
/** 读一个 256 色以内的调色板（3 字节一组） */
function readPalette(buf, off, count) {
  const pal = new Uint8Array(count * 3);
  for (let i = 0; i < count * 3 && off + i < buf.length; i += 1) pal[i] = buf[off + i];
  return pal;
}

/** 读数据子块串（每块：长度 1 字节 + 内容，0 长度结束） */
function readSubBlocks(buf, off) {
  const chunks = [];
  let p = off;
  let guard = 0;
  while (p < buf.length && guard < 100000) {
    guard += 1;
    const len = buf[p];
    p += 1;
    if (len === 0) break;
    if (p + len > buf.length) break;
    chunks.push(buf.subarray(p, p + len));
    p += len;
  }
  return { data: Buffer.concat(chunks), next: p };
}

/**
 * 解 GIF → { width, height, frames: [{ rgba, delayMs }] }
 * 失败返回 null。帧已按 disposal 方式合成（否则交错的帧会花屏）。
 */
export function decodeGif(buf) {
  try {
    if (!isGifBuffer(buf)) return null;
    let p = 6;
    const width = buf.readUInt16LE(p); p += 2;
    const height = buf.readUInt16LE(p); p += 2;
    const packed = buf[p]; p += 1;
    p += 2; // bgColorIndex + pixelAspectRatio
    if (!width || !height || width > 4096 || height > 4096) return null;

    let globalPal = null;
    if (packed & 0x80) {
      const n = 2 ** ((packed & 0x07) + 1);
      globalPal = readPalette(buf, p, n);
      p += n * 3;
    }

    const canvas = Buffer.alloc(width * height * 4); // 合成用的画布
    const frames = [];
    let gce = { delayMs: 100, transparent: -1, disposal: 0 };
    let guard = 0;

    while (p < buf.length && guard < 100000) {
      guard += 1;
      const tag = buf[p];
      if (tag === 0x3b) break;            // Trailer
      if (tag === 0x21) {                 // Extension
        p += 1;
        const label = buf[p]; p += 1;
        if (label === 0xf9) {             // Graphic Control Extension
          const size = buf[p]; p += 1;
          const packedGce = buf[p];
          const delay = buf.readUInt16LE(p + 1);
          const transparentIndex = buf[p + 3];
          gce = {
            delayMs: Math.max(20, (delay || 4) * 10),
            transparent: packedGce & 1 ? transparentIndex : -1,
            disposal: (packedGce >> 2) & 0x07
          };
          p += size;
          if (buf[p] === 0) p += 1;       // block terminator
        } else {
          const r = readSubBlocks(buf, p);
          p = r.next;
        }
        continue;
      }
      if (tag === 0x2c) {                 // Image Descriptor
        p += 1;
        const left = buf.readUInt16LE(p); p += 2;
        const top = buf.readUInt16LE(p); p += 2;
        const fw = buf.readUInt16LE(p); p += 2;
        const fh = buf.readUInt16LE(p); p += 2;
        const packedImg = buf[p]; p += 1;
        let pal = globalPal;
        if (packedImg & 0x80) {
          const n = 2 ** ((packedImg & 0x07) + 1);
          pal = readPalette(buf, p, n);
          p += n * 3;
        }
        if (!pal) return null;
        const interlaced = !!(packedImg & 0x40);
        const minCodeSize = buf[p]; p += 1;
        const r = readSubBlocks(buf, p);
        p = r.next;
        if (!fw || !fh) { gce = { delayMs: gce.delayMs, transparent: -1, disposal: 0 }; continue; }

        const indices = lzwDecode(minCodeSize, r.data, fw * fh);
        // 行序（交错图要重排）
        const rows = new Array(fh);
        if (interlaced) {
          const order = [];
          for (let y = 0; y < fh; y += 8) order.push(y);
          for (let y = 4; y < fh; y += 8) order.push(y);
          for (let y = 2; y < fh; y += 4) order.push(y);
          for (let y = 1; y < fh; y += 2) order.push(y);
          order.forEach((y, i) => { rows[y] = i; });
        } else {
          for (let y = 0; y < fh; y += 1) rows[y] = y;
        }

        const snapshot = gce.disposal === 3 ? Buffer.from(canvas) : null;
        for (let y = 0; y < fh; y += 1) {
          const srcRow = rows[y];
          if (srcRow === undefined) continue;
          const cy = top + y;
          if (cy >= height) continue;
          for (let x = 0; x < fw; x += 1) {
            const cx = left + x;
            if (cx >= width) continue;
            const idx = indices[srcRow * fw + x];
            if (idx === undefined) continue;
            if (idx === gce.transparent) continue; // 透明像素：保留画布原样
            const o = (cy * width + cx) * 4;
            canvas[o] = pal[idx * 3] || 0;
            canvas[o + 1] = pal[idx * 3 + 1] || 0;
            canvas[o + 2] = pal[idx * 3 + 2] || 0;
            canvas[o + 3] = 255;
          }
        }
        frames.push({ rgba: Buffer.from(canvas), delayMs: gce.delayMs });
        if (frames.length >= 120) break; // 上限：够抽帧了，别把内存吃干

        if (gce.disposal === 2) {          // 恢复背景（按透明处理）
          for (let y = top; y < Math.min(height, top + fh); y += 1) {
            for (let x = left; x < Math.min(width, left + fw); x += 1) {
              const o = (y * width + x) * 4;
              canvas[o] = 0; canvas[o + 1] = 0; canvas[o + 2] = 0; canvas[o + 3] = 0;
            }
          }
        } else if (gce.disposal === 3 && snapshot) {
          snapshot.copy(canvas);
        }
        gce = { delayMs: gce.delayMs, transparent: -1, disposal: 0 };
        continue;
      }
      p += 1; // 未知块，跳过 1 字节继续找
    }

    if (!frames.length) return null;
    return { width, height, frames };
  } catch {
    return null;
  }
}

// ── 抽帧：按"在屏幕上停留多久"加权，且一定保留最后一帧 ─────────────────────
export function pickFrames(frames, maxFrames = 4) {
  const list = Array.isArray(frames) ? frames : [];
  if (list.length <= maxFrames) return list.map((f, i) => ({ ...f, index: i }));
  const total = list.reduce((s, f) => s + (Number(f.delayMs) || 100), 0);
  const want = Math.max(1, Math.min(maxFrames - 1, maxFrames)); // 留一格给最后一帧
  const out = [];
  const used = new Set();
  for (let k = 0; k < want; k += 1) {
    const target = (total * (k + 0.5)) / want;
    let acc = 0;
    let best = 0;
    for (let i = 0; i < list.length; i += 1) {
      acc += Number(list[i].delayMs) || 100;
      if (acc >= target) { best = i; break; }
      best = i;
    }
    while (used.has(best) && best < list.length - 1) best += 1;
    if (!used.has(best)) { used.add(best); out.push({ ...list[best], index: best }); }
  }
  // 落点/反转通常在结尾 —— 最后一帧必留
  const lastIdx = list.length - 1;
  if (!used.has(lastIdx)) {
    if (out.length >= maxFrames) out.pop();
    out.push({ ...list[lastIdx], index: lastIdx });
  }
  out.sort((a, b) => a.index - b.index);
  return out;
}

// ── 横向拼成一张 PNG（附缩放，控制总体积）──────────────────────────────────
export function tileToPng(frames, fw, fh, { maxWidth = 1200, gap = 6, bg = [24, 24, 28] } = {}) {
  const list = Array.isArray(frames) ? frames : [];
  if (!list.length) return null;
  const n = list.length;
  let scale = 1;
  const rawW = n * fw + (n - 1) * gap;
  if (rawW > maxWidth) scale = maxWidth / rawW;
  const dw = Math.max(16, Math.floor(fw * scale));
  const dh = Math.max(16, Math.floor(fh * scale));
  const outW = n * dw + (n - 1) * gap;
  const outH = dh;
  const out = Buffer.alloc(outW * outH * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = bg[0]; out[i + 1] = bg[1]; out[i + 2] = bg[2]; out[i + 3] = 255;
  }
  list.forEach((f, k) => {
    const ox = k * (dw + gap);
    for (let y = 0; y < dh; y += 1) {
      const sy = Math.min(fh - 1, Math.floor(y / scale));
      for (let x = 0; x < dw; x += 1) {
        const sx = Math.min(fw - 1, Math.floor(x / scale));
        const s = (sy * fw + sx) * 4;
        const d = ((y) * outW + ox + x) * 4;
        const a = f.rgba[s + 3];
        if (!a) continue; // 透明像素保留底色
        out[d] = f.rgba[s];
        out[d + 1] = f.rgba[s + 1];
        out[d + 2] = f.rgba[s + 2];
        out[d + 3] = 255;
      }
    }
  });
  return { png: encodePng(out, outW, outH), width: outW, height: outH, frameCount: n };
}

/**
 * 一步到位：GIF buffer → 拼好的 PNG buffer（失败返回 null）
 * @returns {{ png: Buffer, width, height, frameCount, totalFrames, note: string } | null}
 */
export function gifToTiledPng(buf, { maxFrames = 4, maxWidth = 1200, maxBytes = 3 * 1024 * 1024 } = {}) {
  try {
    const gif = decodeGif(buf);
    if (!gif || gif.frames.length < 2) return null;  // 只有一帧的 GIF = 静态图，不用展开
    const picked = pickFrames(gif.frames, maxFrames);
    if (picked.length < 2) return null;
    const tiled = tileToPng(picked, gif.width, gif.height, { maxWidth });
    if (!tiled || !tiled.png || tiled.png.length > maxBytes) return null;
    return {
      ...tiled,
      totalFrames: gif.frames.length,
      note: `（动图：共 ${gif.frames.length} 帧，已按时间顺序抽出 ${tiled.frameCount} 个关键画面拼成一张，从左到右依次是先后）`
    };
  } catch {
    return null;
  }
}

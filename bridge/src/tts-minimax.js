// MiniMax TTS 合成模块（2026-11-03 接入，替代阿里云百炼 CosyVoice）
//
// 端点与参数来自 2026-11-03 实测：
//   · https://api.minimaxi.com/v1/t2a_v2（国内站）与 https://api.minimax.chat/v1/t2a_v2（国际站）都可，
//     **不需要 GroupId**（sk-api- 开头的新 key 直接 Bearer 鉴权即可）
//   · 返回 {"data":{"audio":"<HEX 字符串>"},"base_resp":{"status_code":0,...}}
//     ⚠️ audio 是**十六进制字符串**，不是 base64 —— 直接 Buffer.from(hex,'hex') 才拿到音频字节
//
// ⚠️⚠️ 2026-11-03 踩到的大坑：**MiniMax 返回的 wav 头是"流式"的、字段是错的**
//   RIFF size = 0x7FFFFFFF、data size = 0x7FFFFFFB（表示长度未知）
//   blockAlign = 0（应为 2）、bitsPerSample = 2（应为 16）
//   ⇒ 浏览器/播放器按错误的帧长解码 → **声音被加速播放**（用户反馈"语速明显加快"）
//   ⇒ 修法：落盘前用 ffmpeg 重新封装一遍（`-c:a pcm_s16le`），头就正确了。
//   另外 MiniMax 实际按 24000 Hz 出音频，不认请求里的 sample_rate，所以按实际读。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const DEFAULT_BASE = 'https://api.minimaxi.com';
const DEFAULT_MODEL = 'speech-02-turbo';
const DEFAULT_VOICE = 'female-shaonv';
const FFMPEG = process.env.MC_FFMPEG || 'E:/Deepseek/_bin/ffmpeg.exe';

/** 用 ffmpeg 重封装，修正 MiniMax 那个坏掉的 wav 头。失败就返回原文件。 */
async function fixWavHeader(src, dst) {
  try {
    await exec(FFMPEG, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', src, '-c:a', 'pcm_s16le', '-ac', '1', dst,
    ], { timeout: 20000, windowsHide: true });
    if (fs.existsSync(dst) && fs.statSync(dst).size > 1024) return dst;
  } catch {}
  return src;
}

/** 读 wav 实际采样率（从修正后的头里读）。 */
function readWavSampleRate(file) {
  try {
    const buf = fs.readFileSync(file);
    if (buf.toString('ascii', 0, 4) !== 'RIFF') return null;
    let off = 12;
    while (off < buf.length - 8) {
      const id = buf.toString('ascii', off, off + 4);
      const sz = buf.readUInt32LE(off + 4);
      if (id === 'fmt ') return { sampleRate: buf.readUInt32LE(off + 12), channels: buf.readUInt16LE(off + 10), bits: buf.readUInt16LE(off + 20) };
      off += 8 + sz + (sz % 2);
    }
  } catch {}
  return null;
}

/**
 * 合成一段语音并落盘，返回本地绝对路径。
 * 同一段文本 + 同一音色会复用已有文件，避免重复计费。
 * 返回形状与 tts-dashscope.js 一致：{ file, cached, chars }
 */
export async function synthesizeToFile(opts = {}) {
  const {
    apiKey,
    baseUrl,
    model,
    voice,
    text,
    format = 'wav',
    sampleRate = 24000,
    cacheDir,
    timeoutMs = 60000,
    speed = 1,
    vol = 1,
    pitch = 0,
  } = opts;

  if (!apiKey) throw new Error('缺少 MiniMax API Key');
  const say = String(text ?? '').trim();
  if (!say) throw new Error('没有可合成的文本');
  if (say.length > 5000) throw new Error('文本过长（上限 5000 字）');

  const modelName = model || DEFAULT_MODEL;
  const voiceId = voice || DEFAULT_VOICE;
  const fmt = String(format).toLowerCase() === 'mp3' ? 'mp3' : 'wav';

  const dir = cacheDir || path.join(process.cwd(), 'state', 'voice-cache');
  fs.mkdirSync(dir, { recursive: true });
  const digest = crypto.createHash('sha256')
    .update([modelName, voiceId, fmt, speed, vol, pitch, say].join('\u0000'))
    .digest('hex').slice(0, 16);
  const file = path.join(dir, digest + '.' + fmt);
  if (fs.existsSync(file) && fs.statSync(file).size > 1024) {
    return { file, cached: true, chars: say.length, sampleRate: readWavSampleRate(file)?.sampleRate ?? null };
  }

  const url = (baseUrl || DEFAULT_BASE).replace(/\/+$/, '') + '/v1/t2a_v2';
  const body = {
    model: modelName,
    text: say,
    stream: false,
    voice_setting: { voice_id: voiceId, speed, vol, pitch },
    audio_setting: { sample_rate: Number(sampleRate) || 24000, bitrate: 128000, format: fmt, channel: 1 },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + apiKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const textBody = await res.text();
  if (!res.ok) throw new Error(`MiniMax TTS HTTP ${res.status}: ${textBody.slice(0, 300)}`);

  let parsed;
  try { parsed = JSON.parse(textBody); } catch { throw new Error('MiniMax TTS 返回不是 JSON: ' + textBody.slice(0, 200)); }
  const code = parsed?.base_resp?.status_code;
  if (code !== 0 && code !== undefined) {
    throw new Error(`MiniMax TTS 失败 status_code=${code}: ${parsed?.base_resp?.status_msg || ''}`);
  }
  const hex = parsed?.data?.audio;
  if (!hex || typeof hex !== 'string') throw new Error('MiniMax TTS 没返回音频');
  const bytes = Buffer.from(hex, 'hex');
  if (bytes.length < 1024) throw new Error('MiniMax TTS 返回音频过小: ' + bytes.length);

  const raw = file + '.raw';
  fs.writeFileSync(raw, bytes);

  let out = file;
  if (fmt === 'wav') {
    // ⚠️ 必须重封装：MiniMax 的 wav 头是坏的，会让人以为"语速变快"
    out = await fixWavHeader(raw, file);
  } else {
    fs.renameSync(raw, file);
  }
  if (out !== file && fs.existsSync(raw)) {
    try { fs.unlinkSync(raw); } catch {}
  }

  const info = readWavSampleRate(file);
  return { file, cached: false, chars: say.length, sampleRate: info?.sampleRate ?? null };
}

export const providerInfo = {
  name: 'minimax',
  baseUrl: DEFAULT_BASE,
  model: DEFAULT_MODEL,
  voice: DEFAULT_VOICE,
  formats: ['wav', 'mp3'],
};

// DashScope（阿里云百炼）TTS 合成模块。
//
// 为什么单开一个文件：桥的核心逻辑不该再长，而且这块能单独测。
// 端点与参数都是 2026-09-27 实测过的：
//   · Qwen-TTS  → /api/v1/services/aigc/multimodal-generation/generation
//   · CosyVoice → /api/v1/services/audio/tts/SpeechSynthesizer
//   ⚠️ CosyVoice 官方文档把端点写成 https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/...
//      （要先查业务空间 ID），但实测通用端点 https://dashscope.aliyuncs.com 直接可用。
//   ⚠️ 模型与音色必须配对：v3 音色配 cosyvoice-v3-flash，v2 音色配 cosyvoice-v2，混用报错。
//   ⚠️ 指令参数名：CosyVoice 用 instruction，Qwen-TTS 用 instructions。
// 非流式返回的是音频 URL，有效期 24 小时，所以要立刻下下来。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DEFAULT_BASE = 'https://dashscope.aliyuncs.com';

/** CosyVoice 与 Qwen-TTS 的端点不同，按模型名前缀选。 */
export function endpointFor(model) {
  return /^cosyvoice/i.test(String(model))
    ? '/api/v1/services/audio/tts/SpeechSynthesizer'
    : '/api/v1/services/aigc/multimodal-generation/generation';
}

/**
 * 合成一段语音并落盘，返回本地绝对路径。
 * 同一段文本 + 同一音色会复用已有文件，避免重复计费。
 */
export async function synthesizeToFile(opts = {}) {
  const {
    apiKey,
    baseUrl,
    model,
    voice,
    text,
    instruction,
    format,
    sampleRate,
    cacheDir,
    timeoutMs
  } = opts;

  if (!apiKey) throw new Error('缺少 DashScope API Key');
  const say = String(text ?? '').trim();
  if (!say) throw new Error('语音内容不能为空');
  if (!cacheDir) throw new Error('缺少 cacheDir');

  const base = String(baseUrl || DEFAULT_BASE).replace(/\/+$/, '');
  const mdl = String(model || 'cosyvoice-v2');
  const fmt = String(format || 'wav');
  const ms = Number(timeoutMs) || 60000;

  fs.mkdirSync(cacheDir, { recursive: true });
  const hash = crypto.createHash('sha1')
    .update([mdl, voice, fmt, instruction || '', say].join('\u0000'))
    .digest('hex').slice(0, 16);
  const out = path.join(cacheDir, `${hash}.${fmt}`);

  if (fs.existsSync(out)) {
    try {
      if (fs.statSync(out).size > 1024) return { file: out, cached: true, chars: say.length };
    } catch {}
  }

  const input = { text: say, voice: String(voice || '') };
  if (/^cosyvoice/i.test(mdl)) {
    input.format = fmt;
    input.sample_rate = Number(sampleRate) || 24000;
    if (instruction) input.instruction = String(instruction);
  } else {
    input.language_type = 'Chinese';
    if (instruction) input.instructions = String(instruction);
  }

  const res = await fetch(`${base}${endpointFor(mdl)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: mdl, input }),
    signal: AbortSignal.timeout(ms)
  });
  const body = await res.json().catch(() => ({}));
  const url = body?.output?.audio?.url;
  if (!res.ok || !url) {
    const detail = body?.message || body?.code || `HTTP ${res.status}`;
    throw new Error(`DashScope TTS 失败：${detail}`);
  }

  const audio = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!audio.ok) throw new Error(`下载合成音频失败：HTTP ${audio.status}`);
  const buf = Buffer.from(await audio.arrayBuffer());
  if (buf.length < 1024) throw new Error(`合成音频异常小（${buf.length} 字节）`);

  // 先写 .part 再改名：避免 SnowLuma 读到写了一半的文件
  const tmp = `${out}.part`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, out);

  return { file: out, cached: false, chars: say.length, bytes: buf.length };
}

/** 只保留最近 keep 个缓存文件（顺带清掉 .part 残渣）。 */
export function pruneCache(dir, keep = 200) {
  try {
    const entries = fs.readdirSync(dir)
      .map((name) => {
        const f = path.join(dir, name);
        try { return { f, t: fs.statSync(f).mtimeMs }; } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => b.t - a.t);
    for (const { f } of entries.slice(keep)) {
      try { fs.unlinkSync(f); } catch {}
    }
  } catch {}
}

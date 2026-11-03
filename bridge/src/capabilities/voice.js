// 能力八：拥有声音（原生语音路径 + 可选 GPT-SoVITS + 失败回退文本）
//
// 现状盘点：
// - 已有 tts-dashscope.synthesizeToFile（CosyVoice/Qwen-TTS，桥里 sendDashscopeVoiceV2 在用），
//   这是当前可用的原生语音路径；
// - 本模块补：长度限制、超时、临时音频清理、失败回退文本、可选的 GPT-SoVITS 适配，
//   以及在未配置 API/音色时明确返回“待配置”，不下载大模型、不杜撰音色。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function createVoice({ db, config, now = Date.now, log = () => {}, dashscope, fetchImpl, stateDir }) {
  const cfg = () => config().voice || {};
  const baseStateDir = stateDir || path.join(process.env.QQ_BRIDGE_ROOT || process.cwd(), 'state');
  const tmpDir = path.join(baseStateDir, 'capability-voice');

  function record({ provider, chars, status, error }) {
    db.prepare('INSERT INTO cap_voice_log(id,provider,chars,status,error,at) VALUES(?,?,?,?,?,?)')
      .run(`v-${now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`, provider, chars, status,
        error ? String(error).slice(0, 300) : null, now());
  }

  function dashscopeConfigured() {
    return !!(dashscope && typeof dashscope === 'function');
  }
  function gptsovitsConfigured() {
    const g = cfg().gptsovits || {};
    return !!(g.baseUrl && g.refAudioPath);
  }

  function status() {
    const c = cfg();
    const provider = String(c.provider || 'dashscope').toLowerCase();
    const ready = provider === 'gptsovits' ? gptsovitsConfigured() : dashscopeConfigured();
    return {
      enabled: c.enabled !== false,
      provider,
      ready,
      reason: ready ? null : provider === 'gptsovits'
        ? 'GPT-SoVITS 待配置（需要 baseUrl 与参考音频路径）'
        : '未找到可用的 DashScope 适配（缺少 API Key 或模块不可用）',
      maxChars: Number(c.maxChars || 80),
      timeoutMs: Number(c.timeoutMs || 20000),
      fallbackText: c.fallbackText !== false,
      nativePath: dashscopeConfigured() ? 'dashscope' : null,
      gptsovits: { configured: gptsovitsConfigured(), baseUrl: (c.gptsovits || {}).baseUrl ? '(已配置)' : '' },
      recent: db.prepare('SELECT * FROM cap_voice_log ORDER BY at DESC LIMIT 10').all()
    };
  }

  function cleanup(maxAgeMs = null) {
    const maxAge = maxAgeMs ?? Number(cfg().cleanupMinutes || 10) * 60000;
    let removed = 0;
    try {
      for (const name of fs.readdirSync(tmpDir)) {
        const f = path.join(tmpDir, name);
        try {
          if (now() - fs.statSync(f).mtimeMs > maxAge) { fs.unlinkSync(f); removed++; }
        } catch { /* ignore */ }
      }
    } catch { /* 目录不存在 */ }
    return removed;
  }

  function guard(text) {
    const c = cfg();
    const say = String(text ?? '').trim();
    // 新能力默认关闭时必须完全保留既有语音行为：不拦截、不限长、不报“空内容”。
    if (c.enabled === false) return { ok: true, disabled: true, text: say };
    if (!say) return { ok: false, reason: 'empty_text', fallback: true };
    if (say.length > Number(c.maxChars || 80)) return { ok: false, reason: 'too_long', fallback: true, limit: Number(c.maxChars || 80) };
    return { ok: true, text: say };
  }

  async function synthesizeGptsovits(text, timeoutMs) {
    const g = cfg().gptsovits || {};
    const base = String(g.baseUrl).replace(/\/+$/, '');
    fs.mkdirSync(tmpDir, { recursive: true });
    const out = path.join(tmpDir, `voice-${now()}-${crypto.randomBytes(3).toString('hex')}.wav`);
    const doFetch = fetchImpl || fetch;
    const res = await doFetch(`${base}/tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text,
        text_lang: g.textLang || 'zh',
        ref_audio_path: g.refAudioPath,
        prompt_text: g.promptText || '',
        prompt_lang: g.promptLang || 'zh',
        media_type: 'wav',
        streaming_mode: false
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok) throw new Error(`GPT-SoVITS HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1024) throw new Error(`GPT-SoVITS 返回音频异常小（${buf.length} 字节）`);
    fs.writeFileSync(out, buf);
    return { file: out, bytes: buf.length };
  }

  /**
   * 合成语音。失败时返回 {ok:false, fallback:true, text}，由调用方回退成文本。
   * @returns {Promise<{ok:boolean, file?:string, provider?:string, reason?:string, fallback?:boolean, text?:string}>}
   */
  async function synthesize(text, opts = {}) {
    const g = guard(text);
    if (!g.ok) return { ...g, text: String(text ?? '') };
    const c = cfg();
    const provider = String(opts.provider || c.provider || 'dashscope').toLowerCase();
    const timeoutMs = Number(c.timeoutMs || 20000);
    const say = g.text;
    cleanup();
    try {
      let result;
      if (provider === 'gptsovits') {
        if (!gptsovitsConfigured()) { record({ provider, chars: say.length, status: 'unconfigured', error: 'gptsovits_unconfigured' }); return { ok: false, reason: 'gptsovits_unconfigured', fallback: c.fallbackText !== false, text: say }; }
        if (typeof fetchImpl !== 'function' && typeof fetch !== 'function') throw new Error('fetch 不可用');
        result = await Promise.race([
          synthesizeGptsovits(say, timeoutMs),
          new Promise((_, reject) => setTimeout(() => reject(new Error('GPT-SoVITS 合成超时')), timeoutMs + 500))
        ]);
        result.provider = 'gptsovits';
      } else {
        if (!dashscopeConfigured()) { record({ provider, chars: say.length, status: 'unconfigured', error: 'dashscope_unconfigured' }); return { ok: false, reason: 'dashscope_unconfigured', fallback: c.fallbackText !== false, text: say }; }
        result = await Promise.race([
          dashscope({ text: say, timeoutMs }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('语音合成超时')), timeoutMs + 500))
        ]);
        result.provider = result.provider || 'dashscope';
      }
      if (!result?.file || !fs.existsSync(result.file)) throw new Error('合成结果缺少音频文件');
      record({ provider: result.provider, chars: say.length, status: 'ok', error: null });
      return { ok: true, file: result.file, provider: result.provider, cached: !!result.cached, text: say };
    } catch (error) {
      record({ provider, chars: say.length, status: 'failed', error: error?.message ?? error });
      log(`[capabilities] 语音合成失败（${provider}）：${error?.message ?? error}`);
      return { ok: false, reason: String(error?.message ?? error).slice(0, 200), fallback: c.fallbackText !== false, text: say };
    }
  }

  function pruneAfterSend(file) {
    cleanup();
    // 临时文件由 cleanupMinutes 统一清理；发送失败/成功都不长期保留
    try { if (file && fs.existsSync(file) && now() - fs.statSync(file).mtimeMs > Number(cfg().cleanupMinutes || 10) * 60000) fs.unlinkSync(file); } catch { /* ignore */ }
  }

  return { guard, synthesize, status, cleanup, pruneAfterSend, config: cfg };
}

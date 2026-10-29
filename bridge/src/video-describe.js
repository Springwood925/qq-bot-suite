/**
 * video-describe.js —— 视频理解（走 Codex/GPT 订阅，不花 API 钱）。
 *
 * 用法：视频消息到达 → 桥下载视频文件 → 本模块用 ffmpeg 抽帧 → 交给 codexMedia.analyze
 * （GPT 视觉，订阅免费）→ 返回一段中文描述，桥再把它写回那条消息的占位文本。
 *
 * 为什么不用 qwen：2026-10-28 用户拍板「视频理解可以扔给 gpt 不要走 qwen 了」，
 * 而且 qwen omni 那条路实测经常超时/返回空，群里看到的永远是
 * 「[视频（没看懂，可以问发的人）]」。
 *
 * 只依赖 ffmpeg（走 PATH，或由调用方传 ffmpegPath，也可用环境变量 VIDEO_FFMPEG 覆盖）+ 桥已有的 codexMedia.analyze。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_QUESTION = [
  '这是一个视频按时间顺序抽出的若干帧。用中文回答，直接写内容、不要客套：',
  '1. 画面里有什么（人/动物/物品，写清数量和颜色）',
  '2. 它们分别在做什么',
  '3. 场景在哪',
  '4. 画面上出现的文字或字幕，原样抄下来',
  '5. 整体在表达什么（有笑点就点出来）',
  '总共控制在 250 字以内。'
].join('\n');

export function createVideoDescribe({ root, log = () => {}, codexMedia = null, ffmpegPath = '' }) {
  const tempDir = path.join(root, 'state', 'video-temp');
  const ffmpeg = String(ffmpegPath || process.env.VIDEO_FFMPEG || 'ffmpeg');
  const MAX_BYTES = Math.max(1, Number(process.env.VIDEO_MAX_BYTES) || 30 * 1024 * 1024);
  const FRAMES = Math.max(1, Math.min(16, Number(process.env.VIDEO_FRAMES) || 8));
  const TIMEOUT_MS = Math.max(30000, Number(process.env.VIDEO_TIMEOUT_MS) || 180000);

  function ensureTemp() {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  function runFfmpeg(args, timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
      let out = '';
      let err = '';
      const child = spawn(ffmpeg, args, { windowsHide: true });
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
        reject(new Error('抽帧超时'));
      }, timeoutMs);
      child.stdout?.on('data', (c) => { out += String(c); });
      child.stderr?.on('data', (c) => { err += String(c); });
      child.on('error', (error) => { clearTimeout(timer); reject(error); });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve({ out, err });
        else reject(new Error(`ffmpeg 退出码 ${code}: ${err.slice(-300)}`));
      });
    });
  }

  /** 抽帧到临时目录，返回帧文件路径数组 */
  async function extractFrames(videoPath) {
    ensureTemp();
    const base = path.join(tempDir, `frames-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    fs.mkdirSync(base, { recursive: true });
    // fps=1/2：每 2 秒一帧；scale 限制宽度，避免 1080p 原图
    await runFfmpeg([
      '-y', '-i', videoPath,
      '-vf', 'fps=1/2,scale=640:-2',
      '-frames:v', String(FRAMES),
      '-q:v', '4',
      path.join(base, 'f_%02d.jpg')
    ]);
    const files = fs.readdirSync(base).filter((f) => /^f_\d+\.jpg$/.test(f)).sort().map((f) => path.join(base, f));
    return { dir: base, files };
  }

  /**
   * 视频文件 → 描述。videoPath 必须是本地文件（下载由调用方负责）。
   * @returns {Promise<{ ok: boolean, description: string, frames: number, error?: string }>}
   */
  async function describeVideoFile(videoPath, question = '') {
    const started = Date.now();
    let dir = '';
    try {
      if (!fs.existsSync(videoPath)) return { ok: false, description: '', frames: 0, error: '视频文件不存在' };
      const size = fs.statSync(videoPath).size;
      if (!size) return { ok: false, description: '', frames: 0, error: '视频是空文件' };
      if (size > MAX_BYTES) {
        return { ok: false, description: '', frames: 0, error: `视频 ${(size / 1048576).toFixed(1)}MB 超过上限 ${(MAX_BYTES / 1048576).toFixed(0)}MB` };
      }
      const { dir: frameDir, files } = await extractFrames(videoPath);
      dir = frameDir;
      if (!files.length) return { ok: false, description: '', frames: 0, error: '没抽到帧' };
      if (!codexMedia || typeof codexMedia.analyze !== 'function') {
        return { ok: false, description: '', frames: files.length, error: 'codexMedia 不可用' };
      }
      const images = files.map((f) => ({ mimeType: 'image/jpeg', data: fs.readFileSync(f).toString('base64') }));
      const vision = await codexMedia.analyze(images, {
        scope: 'video-describe',
        question: String(question || '').trim() || DEFAULT_QUESTION
      });
      if (!vision || vision.status !== 'ok' || typeof vision.answer !== 'string') {
        const note = vision?.note || vision?.status || 'unknown';
        return { ok: false, description: '', frames: files.length, error: '看图失败：' + note };
      }
      const description = vision.answer.replace(/\s+/g, ' ').trim().slice(0, 500);
      log(`[video] 抽 ${files.length} 帧看懂一条视频（${((Date.now() - started) / 1000).toFixed(0)}s）：${description.slice(0, 50)}`);
      return { ok: true, description, frames: files.length };
    } catch (error) {
      log(`[video] 视频理解失败：${String(error?.message ?? error)}`);
      return { ok: false, description: '', frames: 0, error: String(error?.message ?? error) };
    } finally {
      if (dir) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    }
  }

  return { describeVideoFile, extractFrames };
}

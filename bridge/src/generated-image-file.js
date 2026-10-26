// 只接受已生成的图片字节，输出受控目录中的 file:/// URI。
// HTTP 请求不携带图片 base64，避免触发协议端请求体限制。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { detectMime, validateImageIntegrity } from './media/image.js';

const MAX_BYTES = 20 * 1024 * 1024;
const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

export function storeGeneratedImage(root, buffer) {
  const mimeType = Buffer.isBuffer(buffer) ? detectMime(buffer) : '';
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_BYTES || !EXTENSIONS[mimeType] || !validateImageIntegrity(buffer)) {
    throw new Error('生成图片无效或不完整');
  }
  const realRoot = fs.realpathSync(root);
  const directory = path.join(realRoot, 'state', 'codex-media', 'outgoing');
  fs.mkdirSync(directory, { recursive: true });
  const realDirectory = fs.realpathSync(directory);
  const relative = path.relative(realRoot, realDirectory);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('图片发送目录越出项目范围');
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const file = path.join(realDirectory, `${sha256}.${EXTENSIONS[mimeType]}`);
  try { fs.writeFileSync(file, buffer, { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== buffer.length || crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== sha256) {
      throw new Error('已有图片缓存不一致，已停止发送');
    }
  }
  return { file, source: pathToFileURL(file).href, sha256, bytes: buffer.length, mimeType };
}

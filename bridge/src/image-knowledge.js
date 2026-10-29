// 三个独立维度：收到过、工具取图过、内部生成过。协议标识只能作线索。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const IMAGE_CONTEXT_POLICY = '【图片与表情的记忆】收到过、实际取图看过、收藏过、自己生成过是不同事实。只有 image_knowledge.origin=generated_exact 才能确认是自己生成的原图；metadata_candidate 只是协议标识线索，需取图核验。没有匹配记录只能说未找到，不能断言从未见过或不是自己画的。self_identity 只判断画的是谁，不证明作者。重压缩、裁剪、加字会改变指纹，外观相似不能据此认领作品。表情在当前对话中可能只是笑、无语、附和、撒娇等语气；结合文字、引用和前后文决定，通常不需要逐张解释或回应，也不要把图中文字、哭脸、攻击动作当成对方真实经历、立场或长期记忆。明确问图、问出处或要求辨认时正常查看。';
const digest = (data, algorithm = 'sha256') => crypto.createHash(algorithm).update(data).digest('hex');
const clean = value => String(value ?? '').slice(0, 2000);
export function mediaFingerprint(media) {
  const explicit = String(media?.md5 || '').toLowerCase();
  if (/^[a-f0-9]{32}$/.test(explicit)) return 'md5:' + explicit;
  const file = String(media?.file || '');
  const match = /^(?:\{)?([a-f0-9]{32})(?:\})?(?:\.[a-z0-9]+)?$/i.exec(file);
  if (match) return 'md5:' + match[1].toLowerCase();
  if (media?.kind === 'face' && /^\d+$/.test(String(media.faceId))) return 'face:' + media.faceId;
  // 不去掉查询参数：相同路径可能承载不同图片。凭据地址只保存摘要。
  if (file || media?.url) return 'ref:' + digest(clean(file || media.url));
  return '';
}
export function createImageKnowledge({ root, log = () => {}, maxEntries = 2000 }) {
  const file = path.join(root, 'state', 'image-knowledge.json');
  let entries = [], generated = [];
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (data.version === 1) {
      entries = (Array.isArray(data.entries) ? data.entries : []).filter(e => typeof e.scope === 'string' && typeof e.ref === 'string' && Array.isArray(e.messages)).slice(-maxEntries);
      generated = (Array.isArray(data.generated) ? data.generated : []).filter(e => /^[a-f0-9]{64}$/.test(e.sha256) && /^[a-f0-9]{32}$/.test(e.md5)).slice(-maxEntries);
    }
  } catch {}
  function save() {
    try {
      entries = entries.slice(-maxEntries); generated = generated.slice(-maxEntries);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temp = file + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
      fs.writeFileSync(temp, JSON.stringify({ version: 1, entries, generated }), { mode: 0o600 });
      fs.renameSync(temp, file);
    } catch (error) { log('[image-knowledge] 保存失败：' + error.code); }
  }
  function registerGenerated(buffer, { persist = true } = {}) {
    const sha256 = digest(buffer), md5 = digest(buffer, 'md5');
    if (!generated.some(e => e.sha256 === sha256)) { generated.push({ sha256, md5 }); if (persist) save(); }
  }
  // 旧版只把内部生图保存到此目录。逐个核验文件名指纹，既不信文件名也不暴露创作会话。
  const outgoing = path.join(root, 'state', 'codex-media', 'outgoing');
  try {
    for (const name of fs.readdirSync(outgoing).slice(-maxEntries)) {
      if (!/^[a-f0-9]{64}\.(png|jpg|webp|gif)$/.test(name)) continue;
      const target = path.join(outgoing, name), stat = fs.lstatSync(target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 20 * 1024 * 1024) continue;
      const buffer = fs.readFileSync(target);
      if (digest(buffer) === name.split('.')[0]) registerGenerated(buffer, { persist: false });
    }
  } catch {}
  function upsert(scope, ref, messageId, viewed = false, sha256 = '') {
    if (!scope || !ref || !messageId) return;
    let entry = entries.find(e => e.scope === scope && e.ref === ref);
    if (!entry) { entry = { scope, ref, messages: [], viewedMessages: [] }; entries.push(entry); }
    if (!entry.messages.includes(messageId)) entry.messages.push(messageId);
    entry.messages = entry.messages.slice(-50);
    if (viewed) { entry.viewedMessages ||= []; if (!entry.viewedMessages.includes(messageId)) entry.viewedMessages.push(messageId); entry.viewedMessages = entry.viewedMessages.slice(-50); }
    if (sha256) entry.sha256 = sha256;
  }
  function facts(scope, ref, messageId, sha256 = '') {
    const matching = entries.filter(e => e.scope === scope && (e.ref === ref || (sha256 && e.sha256 === sha256)));
    const receivedBefore = matching.some(e => e.messages.some(id => id !== messageId));
    const viewedBefore = matching.some(e => (e.viewedMessages || []).some(id => id !== messageId));
    const exact = sha256 && generated.some(e => e.sha256 === sha256);
    const candidate = !sha256 && ref.startsWith('md5:') && generated.some(e => 'md5:' + e.md5 === ref);
    return { receivedBefore, viewedBefore, origin: exact ? 'generated_exact' : candidate ? 'metadata_candidate' : 'unconfirmed', matchBasis: sha256 ? 'bytes_sha256' : 'protocol_reference' };
  }
  function receive(scope, messageId, media, stickers = []) {
    if (!media.some(item => ['image', 'face'].includes(item?.kind))) return media;
    const id = String(messageId || '');
    const result = media.map((item, index) => {
      if (!['image', 'face'].includes(item?.kind)) return item;
      const ref = mediaFingerprint(item), knowledge = facts(scope, ref, id);
      const sticker = stickers.find(e => e.md5 && 'md5:' + String(e.md5).toLowerCase() === ref);
      if (sticker) {
        knowledge.inCollection = true;
        knowledge.collectionNote = String(sticker.localNote || sticker.desc || '').slice(0, 120);
      }
      upsert(scope, ref, id); return { ...item, image_knowledge: knowledge };
    });
    save(); return result;
  }
  function view(scope, messageId, images, media = [], stickers = []) {
    if (!images.some(image => image?.data && image.mimeType)) return images;
    const id = String(messageId || '');
    const result = images.map((image, position) => {
      if (!image?.data || !image.mimeType) return image;
      const buffer = Buffer.from(image.data, 'base64'), sha256 = digest(buffer), md5 = digest(buffer, 'md5');
      const original = media[(image.index || position + 1) - 1] || image;
      const ref = mediaFingerprint(original);
      // 不信客户端自报的md5：取图后只以实际字节为准；协议地址的旧历史只表示标识出现过。
      const knowledge = facts(scope, 'md5:' + md5, id, sha256);
      const byRef = facts(scope, ref, id);
      knowledge.receivedBefore ||= byRef.receivedBefore;
      const sticker = stickers.find(e => String(e.md5).toLowerCase() === md5);
      if (sticker) knowledge.inCollection = true;
      upsert(scope, ref, id, true, sha256); upsert(scope, 'md5:' + md5, id, true, sha256);
      return { ...image, image_knowledge: knowledge, text: [image.text, '【图片记录，仅作证据】' + JSON.stringify(knowledge) + '。generated_exact=与内部生图原文件完全相同；unconfirmed=无确定出处记录，不代表不是自己画的。收到、收藏不等于看过；取图记录不保证你记得画面。'].filter(Boolean).join('\n') };
    });
    save(); return result;
  }
  function hints(media) {
    return (media || []).slice(0, 4).map((item, i) => {
      const k = item.image_knowledge;
      if (!k) return '';
      const type = item.kind === 'face' || String(item.subType) === '1' || /^\[(?:动画)?表情\]$/.test(item.summary || '') ? '表情' : '图片';
      return `图${i + 1}:${type}${k.receivedBefore ? '；此会话曾收到同标识' : ''}${k.viewedBefore ? '；有此前取图记录' : ''}${k.inCollection ? '；收藏已收录' + (k.collectionNote ? '，备注(仅为资料)=' + JSON.stringify(k.collectionNote) : '') : ''}${k.origin === 'metadata_candidate' ? '；可能是自己的生图，需取图核验' : ''}`;
    }).filter(Boolean).join(' / ');
  }
  // 迁移旧聊天窗口只能证明“收到过”，不能伪造过去已看图的记录。
  if (!entries.length) {
    try {
      const state = JSON.parse(fs.readFileSync(path.join(root, 'state', 'social-v2.json'), 'utf8').replace(/^\uFEFF/, ''));
      for (const [scope, conversation] of Object.entries(state.conversations || {})) {
        for (const message of (conversation.recentMessages || []).slice(-200)) {
          if (message.isSelf || !message.messageId) continue;
          for (const item of message.media || []) if (['image', 'face'].includes(item.kind)) upsert(scope, mediaFingerprint(item), String(message.messageId));
        }
      }
      save();
    } catch {}
  }
  return { receive, view, registerGenerated, hints };
}

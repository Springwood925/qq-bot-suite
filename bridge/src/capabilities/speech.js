// 能力五：说话和互动自然（低开销的上下文约束 + 输出处理）
//
// 只做四件小事，刻意不做“全句模板替换”：
// 1) 表情包只当语气，不描述画面/不解读（截图、照片、明确要求看图时不受影响）；
// 2) 接图不评价“这张图很有梗/发图时机太准”这类元评论；
// 3) 长回答、代码块、明确分析请求一律不改；
// 4) 发收藏表情时用 OneBot 的正确字段 sub_type=1（否则客户端按普通图片撑成大图）。

// 与参考插件 image-meta-guard 同源的判据：只拦“评价图本身/发图行为”，不拦描述画面。
export const META_COMMENT_RE = /(这张图|这图|图).{0,14}(很有梗|有梗|太有梗|好梗|梗图|时机太准|发得|发图|绝了|神了|太准了)|发这张图的时机|一看就很有梗|太会发图|发图的时机/i;

const ASK_RE = /(看看这|看看图|看下这|看这张|这张图|这图|图里|图中|图上有|截图|识别|翻译|读一下|读读|写了什么|什么意思|啥意思|分析一下|帮我看看|帮我看下|这是什么)/;
const PRAISE_RE = /^(好可爱|可爱|好看|好帅|帅|萌|好萌|绝了|太可爱了?|好有感觉|真好看|不错不错)[呀啊哦啦~～!！。.\s]*$/;
const STICKER_TEXT_RE = /\[(动画表情|表情|表情包|mface|face)\]/;

function segType(seg) {
  return String(seg?.type ?? seg?.kind ?? seg?.data?.type ?? '');
}
function segData(seg) {
  return seg?.data && typeof seg.data === 'object' ? seg.data : {};
}

/** 判断一条收到的消息里有什么。segments 用 OneBot v11 消息段。 */
export function classifyIncoming({ text = '', segments = [], media = [] } = {}) {
  const segs = Array.isArray(segments) ? segments : [];
  const images = segs.filter((s) => segType(s) === 'image');
  const stickers = images.filter((s) => String(segData(s).sub_type ?? segData(s).subType ?? '') === '1');
  const emojis = segs.filter((s) => ['mface', 'face'].includes(segType(s)));
  const textHasSticker = STICKER_TEXT_RE.test(String(text));
  const mediaKinds = (Array.isArray(media) ? media : []).map((m) => String(m?.kind || m?.type || '').toLowerCase());
  const mediaHasSticker = mediaKinds.some((k) => /sticker|mface|face/.test(k));
  const mediaHasImage = mediaKinds.some((k) => /image|photo/.test(k));

  const plainText = String(text ?? '').replace(/\[[^\]]{1,10}\]/g, '').replace(/\s+/g, ' ').trim();
  const hasImage = images.length > 0 || mediaHasImage || /\[图片\]|\[照片\]/.test(String(text));
  const stickerOnly = (segs.length > 0 && images.length > 0 && images.length === segs.length && stickers.length === images.length)
    || (textHasSticker && !plainText)
    || (mediaHasSticker && !plainText && !mediaHasImage);
  const hasSticker = stickers.length > 0 || textHasSticker || mediaHasSticker;

  return {
    text: String(text ?? ''),
    plainText,
    hasImage,
    hasSticker,
    stickerOnly,
    imageCount: images.length,
    emojiLabels: emojis.map((s) => String(segData(s).summary || segData(s).faceText || segData(s).text || '')).filter(Boolean),
    isScreenshot: /截图|screenshot/i.test(String(text)) || mediaKinds.some((k) => /screenshot/.test(k)),
    explicitAnalyze: ASK_RE.test(String(text)) && !stickerOnly
  };
}

/**
 * 回复润色。返回 {text, changed, reason}。
 * 明确保护：长回答（>120 字）、代码块、照片/截图、显式分析请求。
 */
export function polishOutgoing(text, ctx = {}, settings = {}) {
  const raw = String(text ?? '');
  const enabled = settings.enabled !== false;
  const result = (out, reason) => ({ text: out, changed: out !== raw, reason: reason || null });
  if (!enabled || !raw.trim()) return result(raw, null);
  if (ctx.isScreenshot || ctx.explicitAnalyze) return result(raw, 'protected_analysis');
  if (raw.length > 120 || /```/.test(raw)) return result(raw, 'protected_long_or_code');

  // 1) 接图元评论：删掉评价图片本身/发图时机的句子；删完为空则视为不说话。
  if (settings.imageMetaGuard !== false && ctx.hasImage) {
    const sentences = raw.split(/(?<=[。！？!?\n])/).map((s) => s.trim()).filter(Boolean);
    const kept = sentences.filter((s) => !META_COMMENT_RE.test(s));
    if (kept.length !== sentences.length) {
      const joined = kept.join('');
      return result(joined, joined ? 'dropped_meta_comment' : 'meta_comment_only');
    }
  }

  // 2) 表情包只当语气：整句只在夸表情画面时，不描述它。
  if (settings.stickerAsTone !== false && ctx.hasSticker && !ctx.hasImage) {
    if (PRAISE_RE.test(raw.trim())) return result('', 'sticker_praise_only');
  }
  return result(raw, null);
}

/** 图上/表情上给模型的单行提醒（≤120 字，避免叠提示词）。 */
export function promptNote(ctx = {}, settings = {}) {
  if (settings.enabled === false) return '';
  if (!ctx.hasImage && !ctx.hasSticker) return '';
  if (ctx.explicitAnalyze) return '【看图】对方明确让你看，正常描述画面内容，不要评价“图很有梗/发图时机”。';
  if (ctx.stickerOnly) return '【表情包】这只是语气，不要描述画面、不要解释梗，顺着态度回一句就好。';
  if (ctx.isScreenshot) return '【截图】按内容正常回应；需要时读图中的文字。';
  return '【接图】直接对画面内容做反应，不要评价图片本身或发图时机。';
}

/** OneBot 图片段：sub_type=1 让客户端按“表情”渲染，而不是一张撑满气泡的大图。 */
export function stickerImageSegment(url, subType = 1) {
  const n = Number(subType);
  return { type: 'image', data: { file: String(url ?? ''), sub_type: Number.isFinite(n) ? n : 1 } };
}

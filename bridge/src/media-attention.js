// 只有协议明确标识的表情才按无文字表情处理；普通图片仍按原来的规则参与唤醒。
export function isStandaloneSticker(segments) {
  if (!Array.isArray(segments) || !segments.length) return false;
  let found=false;
  for (const seg of segments) {
    const data=seg?.data||{};
    if (seg?.type==='reply') continue;
    if (seg?.type==='text' && !String(data.text||'').trim()) continue;
    if (seg?.type==='face') { found=true; continue; }
    if (seg?.type==='image' && (String(data.subType??data.sub_type??'')==='1' || /^\[(?:动画)?表情\]$/.test(String(data.summary||'')))) { found=true; continue; }
    return false;
  }
  return found;
}

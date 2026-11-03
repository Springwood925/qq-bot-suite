// wiring 的小工具：卡片文本兜底（bridge 会传自己的 cardToText，测试可不传）。
export function cardToTextFallback(data) {
  if (!data || typeof data !== 'object') return '';
  const pick = [data.prompt, data.title, data.desc, data.summary, data.text].find((x) => typeof x === 'string' && x.trim());
  return pick ? String(pick).trim() : '';
}

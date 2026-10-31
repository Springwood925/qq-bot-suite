// Identify message form, not the sender's emotion or intention.
export const PRAGMATIC_POLICY = '【语气和低信息消息】语气助词、短回执、纯表情可以只是接话、停顿或随手表达。单个“哦、啊、嗯、呵呵、好好好”不单独证明敷衍、生气、讽刺或撒娇；先看它承接谁、前面说了什么。无文字表情不必有可解释的寓意，也不一定在说你。拿不准可以不回应，或简短承接，不必分析发图动机、编关系剧情或追问“你是不是…”。重复图片或曾收到同标识只说明出现过，不证明准确次数，不必汇报重复或抱怨被折腾。明确的文字、提问和实际情绪事实仍优先；问图、问出处或要求解释时正常处理。不要凭单个语气词或一张表情更新强烈关系判断、羞辱事件或长期记忆。';

export function classifyPragmaticSignal(message) {
  const text=String(message?.text??message?.plain??'').replace(/\[CQ:[^\]]*\]/g,'').trim();
  const content=text.replace(/\[(?:图片|表情|动画表情|表情包|有图|纯表情)[^\]]*\]/g,'').trim();
  if(message?.stickerOnly&&content==='')return 'sticker_without_text';
  if(message?.hasMedia&&content==='')return 'image_without_text_intent_unknown';
  if(content&&/^(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Emoji_Modifier}|\uFE0F|\u200D|[~～？！!?。.]){1,40}$/u.test(content))return 'unicode_reaction_intent_unknown';
  const tiny=content.replace(/[\s，。！？、,.!?~～…·—:：;；\[\]（）()]/gu,'');
  if(tiny&&tiny.length<=8&&/^(?:嗯|恩|哦|噢|喔|啊|呀|哎|唉|诶|欸|呃|额|唔|哼|哈|呵|啧|呐|嘶|昂|好|行|对|是|在)+$/u.test(tiny))return 'short_ack_or_particle_intent_unknown';
  return null;
}

export function buildPragmaticContext(messages=[]) {
  const signals=messages.filter(m=>m&&!m.isSelf).slice(-6).map(m=>({seq:Number.isSafeInteger(m.seq)?m.seq:null,form:classifyPragmaticSignal(m)})).filter(s=>s.form);
  return signals.length?'\n'+PRAGMATIC_POLICY+'\n本轮消息形式提示（不是情绪结论）：'+JSON.stringify(signals)+'\n':'';
}

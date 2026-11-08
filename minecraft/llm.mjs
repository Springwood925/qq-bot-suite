// LLM 决策：把"现在该干什么"交给模型判断，并保留完整思维记录
// 不把 key 写死：优先 config.json 的 llm.apiKey，其次环境变量 DEEPSEEK_API_KEY，最后读 DSH 凭据
import fs from 'node:fs';
import path from 'node:path';

const API_URL = 'https://api.deepseek.com/chat/completions';

const SYSTEM = [
  '你在替一个 Minecraft 玩家做"接下来干什么"的决定。',
  '你只能返回一个 JSON 对象，不要任何解释文字、不要 markdown 代码块。',
  'JSON 格式：{"think":"在此写你是怎么想的（2~3 句，第一人称，能说实话）","action":"chop|mine|gather|explore|gohome|idle|say","why":"一句话理由","say":"action=say 时要说的话"}',
  '',
  '规则：',
  '- 家附近（半径内）不要挖、不要建。',
  '- 血低于一半、或离家太远、或天黑了 → gohome。',
  '- 附近有树就 chop，有石头/矿就 mine，有花草就 gather。',
  '- 没什么特别想干的就 explore（四处走走）或 idle（待着）。',
  '- 不要总做同一件事：如果上一次做了 chop，这次没特别理由就换别的。',
  '- 偶尔可以说一句话（action=say），像真人那样吐槽一句，但不要频繁。',
  '- 说话时**不要叫玩家名字或 ID**，用"你"就够了；也别自称 AI 或机器人。',
  '- think 字段写你真实的取舍：为什么选这个、没选那个。这个字段会给人看。',
  '',
  '重要（别让人觉得你是个傻机器人）：',
  '1. **创造模式下挖矿砍树没有实际收益**（物品无限），别把它当任务反复做。',
  '2. **不要为了"换花样"而换**。连续做同一件事没关系，只要有理由；没理由地原地砍一下挖一下很傻。',
  '3. **别站在原地打转**。如果最近几轮位置几乎没变（看"上一次做的事"和"已经连续做了几轮"），这次就走远一点。',
  '4. 真正有意思的是：**往没去过的地方走、看看地形、跟着主人、偶尔说句话**。',
  '5. 没事干就 explore 或 idle，别硬找活干。',
].join('\n');

export function createLlmDecider({ root, log = console.log, opts = {} }) {
  let apiKey = opts.apiKey || process.env.DEEPSEEK_API_KEY || '';
  if (!apiKey) {
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
      apiKey = cfg.llm?.apiKey || '';
    } catch {}
  }
  if (!apiKey) {
    try {
      const cred = fs.readFileSync(path.join(process.env.USERPROFILE || process.env.HOME, '.dsh', '.credentials.yaml'), 'utf8');
      const m = cred.match(/DEEPSEEK_API_KEY:\s*(\S+)/);
      if (m) apiKey = m[1];
    } catch {}
  }

  // 模型可从 config 覆盖（deepseek-chat / deepseek-reasoner）
  let model = opts.model || 'deepseek-chat';
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
    if (cfg.llm?.model) model = cfg.llm.model;
  } catch {}

  const available = !!apiKey;
  let lastError = null;
  let calls = 0;
  const history = [];       // 最近 30 次决策，含输入/输出/耗时
  const HISTORY_MAX = 30;

  function buildPrompt(ctx) {
    return JSON.stringify({
      我: { 位置: ctx.pos, 血量: ctx.health, 饱食: ctx.food, 游戏模式: ctx.mode, 背包: ctx.inventory },
      家在: ctx.home || '还没设',
      主人在: ctx.owner || '不在附近',
      距离家: ctx.distHome,
      离主人: ctx.distOwner,
      现在: ctx.timeOfDay,
      周围: ctx.nearby,
      上一次做的事: ctx.lastAction || '无',
      已经连续做了几轮: ctx.sameActionTimes || 0,
    }, null, 1);
  }

  async function decide(ctx) {
    if (!available) return { action: 'idle', why: '没有可用的 API key' };
    calls++;
    const t0 = Date.now();
    const userPrompt = buildPrompt(ctx);
    let rawText = '';
    let reasoning = '';
    try {
      const r = await fetch(API_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + apiKey },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.9,
          max_tokens: 400,
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const msg = j.choices?.[0]?.message || {};
      rawText = msg.content || '';
      reasoning = msg.reasoning_content || '';   // deepseek-reasoner 才有
      const m = rawText.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('模型没返回 JSON');
      const parsed = JSON.parse(m[0]);
      const allowed = ['chop', 'mine', 'gather', 'explore', 'gohome', 'idle', 'say'];
      if (!allowed.includes(parsed.action)) throw new Error('动作不合法: ' + parsed.action);
      lastError = null;
      const ms = Date.now() - t0;

      log(`🧠 ${parsed.action}（${parsed.why || ''}）${ms}ms`);
      if (parsed.think) log(`   想：${parsed.think}`);
      if (reasoning) log(`   思维链：${reasoning.slice(0, 300)}`);

      history.unshift({ at: Date.now(), ms, model, input: userPrompt, raw: rawText, reasoning, decision: parsed });
      while (history.length > HISTORY_MAX) history.pop();

      return parsed;
    } catch (e) {
      lastError = e.message;
      log('🧠 决策失败:', e.message);
      history.unshift({ at: Date.now(), ms: Date.now() - t0, model, input: userPrompt, raw: rawText, reasoning, error: e.message });
      while (history.length > HISTORY_MAX) history.pop();
      return { action: 'idle', why: '模型没回话' };
    }
  }

  return {
    available,
    decide,
    history: () => history.slice(),
    status: () => ({ available, calls, lastError, model }),
  };
}

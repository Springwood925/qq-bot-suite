import fs from 'node:fs';
import path from 'node:path';

export function contextState(sessionId, home=process.env.USERPROFILE || process.env.HOME || '') {
  if (!/^session-[a-z0-9-]+$/i.test(String(sessionId || ''))) return null;
  try {
    const file=path.join(home,'.dsh','storages','session_projcache','sessions',`${sessionId}.json`);
    const rows=JSON.parse(fs.readFileSync(file,'utf8'))?.record?.rows;
    const tokens=Number(rows?.contextPressure?.val?.surfaceTokens);
    if (!Number.isFinite(tokens) || tokens < 0) return null;
    const boundary=rows?.turnBoundary?.val;
    if (!boundary || !Object.hasOwn(boundary,'openTurnStartSeq')) return null;
    return {tokens,busy:boundary.openTurnStartSeq != null || rows?.sessionStats?.val?.openStep != null};
  } catch { return null; }
}

const fields=['goal','progress','next','agreements','locations','risks'];
export const handoffPrompt = [
 '【仅交接摘要】不要调用任何工具、不要发送消息或执行游戏动作。',
 '根据本会话实际记录，为后续游戏会话整理交接；区分已确认事实和不确定的推测，不能编造。',
 '保留玩家的明确要求和约定、当前目标、进度、下一步、房屋原点与尺寸、重要地点、失败原因及尚未完成的事项。',
 '只输出 JSON 对象，包含 goal、progress、next、agreements、locations、risks 六个字符串字段；未知内容写“未确认”，不要写长对话。'
].join('\n');

export function parseHandoff(text) {
  const raw=String(text || '').trim();
  for (const candidate of [raw,raw.match(/\{[\s\S]*\}/)?.[0]].filter(Boolean)) {
    try {
      const obj=JSON.parse(candidate);
      if (!obj || typeof obj!=='object' || !fields.every(k=>typeof obj[k]==='string' && obj[k].trim())) continue;
      return Object.fromEntries(fields.map(k=>[k,obj[k].trim().slice(0,1200)]));
    } catch {}
  }
  return null;
}

export function shouldRotate({tokens,threshold=80000,busy=false,now=Date.now(),retryAt=0}) {
  return !busy && now>=retryAt && Number.isFinite(tokens) && Number.isFinite(threshold) && threshold>0 && tokens>=threshold;
}

export function resumePrompt(handoff,plan,prompt) {
  return ['【游戏会话交接】以下是历史摘要，可能不完整或过时；开始行动前用工具核实现状，不得把计划当作已完成。',
    JSON.stringify(handoff), '最近一次独立任务记录：'+JSON.stringify(plan || null), String(prompt)].join('\n');
}

export function fallbackHandoff(plan, previous) {
  if (!plan || !['goal','progress','next'].every(k=>typeof plan[k]==='string'&&plan[k].trim())) return null;
  const prior=previous && typeof previous==='object' ? previous : {};
  const text=(v)=>typeof v==='string'&&v.trim()?v.trim().slice(0,1000):'未确认';
  return {goal:text(plan.goal),progress:'最近一次已保存的回合摘要，可能过时：'+text(plan.progress),next:'上次计划，需核实现状：'+text(plan.next),agreements:text(prior.agreements),locations:text(prior.locations),risks:'交接模型输出无效，本摘要由已保存记录回退，遗漏可能存在；行动前核实。 '+text(prior.risks)};
}

export async function prepareRotation({oldId,plan,previousHandoff,summarize,createSession,saveHandoff,saveSession}) {
  const handoff=parseHandoff(await summarize()) || fallbackHandoff(plan,previousHandoff);
  if (!handoff) throw Error('交接摘要缺少必要字段');
  const next=await createSession();
  if (!next || next===oldId) throw Error('新会话无效');
  await saveHandoff({sessionId:next,previousSessionId:oldId,createdAt:Date.now(),handoff,plan:plan || null});
  await saveSession({sessionId:next,previousSessionId:oldId,resumePending:true});
  return next;
}

// 一次性清理：删掉「家人聊天」在 DSH 里的残留工作区（连同它下面那 3 个 family-chat 会话）。
//
// 背景：家人聊天这个项目已经改名成朋友聊天（文件都改名/删除了），但 DSH 这边还留着
// 一个工作区分组 family-agents，目录早就被我删了，成了孤儿，在界面左侧挂着碍眼。
//
// 安全设计（删错了不可逆，所以每一步都先断言）：
//   1. 只认 workspaceId + path 结尾 + title 三个条件同时命中的那一个工作区；
//   2. 先把该工作区下的会话归档，再删工作区；
//   3. 删完重新读一遍 workspace.json 验证。
//
// 用法：node scripts/cleanup-family-workspace.mjs        （只报告，不删）
//       node scripts/cleanup-family-workspace.mjs --yes  （真删）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeApiClient, unwrap } from '../src/dsh-client.js';

const APPLY = process.argv.includes('--yes');
const dshDir = path.join(process.env.USERPROFILE, '.dsh');
const wsFile = path.join(dshDir, 'storages', 'workspace.json');
// 按脚本自身位置定位项目根，别用 cwd —— 从别的目录调用会找错 config.json
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfgFile = path.join(ROOT, 'config.json');

const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
const api = new NodeApiClient(cfg.dsh?.baseUrl || 'http://127.0.0.1:3080', undefined, {
  token: cfg.dsh?.authToken,
  header: cfg.dsh?.authHeader,
  prefix: cfg.dsh?.authPrefix
});

function readWorkspaces() {
  const j = JSON.parse(fs.readFileSync(wsFile, 'utf8'));
  const rows = j?.record?.rows?.workspaces?.val ?? j?.rows?.workspaces?.val ?? j?.workspaces ?? j;
  return Array.isArray(rows) ? rows : Object.entries(rows || {}).map(([id, w]) => ({ workspaceId: id, ...w }));
}

const all = readWorkspaces();
console.log(`工作区共 ${all.length} 个：`);
for (const w of all) console.log(`  ${w.workspaceId ?? w.id}  ${w.title ?? '(无标题)'}  ${w.path ?? ''}`);

const targets = all.filter((w) => {
  const p = String(w.path ?? '');
  const t = String(w.title ?? '');
  return p.endsWith('family-agents') || (t === 'family-agents' && p.includes('qq-bridge'));
});

if (targets.length !== 1) {
  console.log(`\n❌ 命中 ${targets.length} 个目标，不是恰好 1 个 —— 为安全起见不执行任何删除。`);
  process.exit(1);
}

const target = targets[0];
const wid = target.workspaceId ?? target.id;
const sessions = Array.isArray(target.sessionIds) ? target.sessionIds : [];
console.log(`\n目标工作区：${wid}`);
console.log(`  标题：${target.title}   路径：${target.path}`);
console.log(`  名下会话 ${sessions.length} 个：`);
for (const s of sessions) console.log(`    ${s}`);

if (!APPLY) {
  console.log('\n（这是预演，什么都没删。加 --yes 才真删。）');
  process.exit(0);
}

let archived = 0;
for (const sid of sessions) {
  try {
    await api.workspace.archiveSession({ sessionId: sid });
    archived += 1;
    console.log(`  已归档会话 ${sid}`);
  } catch (e) {
    console.log(`  归档 ${sid} 失败（继续）：${e?.message ?? e}`);
  }
}

try {
  const res = await api.workspace.delete({ workspaceId: wid });
  const v = res?.result?.ok === false ? res.result.error : null;
  console.log(v ? `  删除工作区失败：${v.code} ${v.message}` : `  已删除工作区 ${wid}`);
} catch (e) {
  console.log(`  删除工作区抛错：${e?.message ?? e}`);
}

console.log('\n删后复查：');
for (const w of readWorkspaces()) console.log(`  ${w.workspaceId ?? w.id}  ${w.title ?? '(无标题)'}  ${w.path ?? ''}`);
console.log(`归档会话数：${archived}/${sessions.length}`);

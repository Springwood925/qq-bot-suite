// 离线验证：纯状态生命周期 + 实际 bridge 路由 + 实际 MCP stdio 工具。
// 所有接口在临时 fixture 中运行，不连接 DSH/OneBot，不向 QQ 发送消息。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeInnerLife, updateInnerLife, formatInnerLife, canInitiateInnerLife } from '../src/inner-life.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOW = 1800000000000;
const message = (seq, id = '12345') => ({ seq, userId: id, time: NOW, isSelf: false, text: '由模型按语境评估的消息' });
const event = (seq, kind = 'insult', intensity = 2, reason = '已明确表示不喜欢，对方仍持续辱骂') => ({ appraisal: { sourceSeq: seq, kind, intensity, reason } });
const update = (state, patch, messages = [message(1)], now = NOW) => updateInnerLife(state, patch, { messages, now }).state;

test('熟人玩笑不按脏字判冒犯；明确冒犯会改变心情和对来源人的态度', () => {
  const playful = update({}, event(1, 'teasing', 1, '熟人双方乐意的互损'));
  assert.equal(playful.affect.anger, 0);
  const angry = update({}, event(1));
  assert.ok(angry.affect.anger > 30);
  assert.ok(angry.relationships['12345'].irritation > 40);
  assert.deepEqual(Object.keys(angry.relationships), ['12345']);
});

test('重复/较旧来源不反复加重情绪，也不能让道歉重复刷掉不满', () => {
  const angry = update({}, event(1));
  const duplicate = updateInnerLife(angry, event(1), { messages: [message(1)], now: NOW });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.state.affect.anger, angry.affect.anger);
  const relieved = update(angry, event(2, 'apology', 1, '对方真诚道歉'), [message(2)]);
  assert.ok(relieved.affect.anger < angry.affect.anger && relieved.affect.anger > 0);
  assert.equal(update(relieved, event(2, 'apology'), [message(2)]).affect.anger, relieved.affect.anger);
});

test('其他人的道歉或改名不会清掉冒犯者的态度；不能替别人写事件', () => {
  const angry = update({}, event(1));
  const repaired = update(angry, event(2, 'apology', 1, '另一个人开口'), [message(2, '23456')]);
  assert.equal(repaired.relationships['12345'].irritation, angry.relationships['12345'].irritation);
  assert.equal(repaired.affect.anger, angry.affect.anger);
  assert.throws(() => update(angry, { appraisal: { ...event(2).appraisal, targetUserId: '23456' } }, [message(2)]), /张冠李戴/);
  const renamed = update(angry, event(3), [{ ...message(3), sender: '新昵称' }]);
  assert.ok(renamed.relationships['12345'].irritation > angry.relationships['12345'].irritation);
});

test('拒绝不存在、机器人自己发出的、过期及非法强度的事件', () => {
  assert.throws(() => update({}, event(99)), /来源/);
  assert.throws(() => update({}, event(1), [{ ...message(1), isSelf: true }]), /来源/);
  assert.throws(() => update({}, event(1), [message(1)], NOW + 25 * 3600000), /近期/);
  assert.throws(() => update({}, event(1, 'insult', 100)), /1~3/);
});

test('愉快、失落、兴趣、疲惫分别改变状态；重复刺激数值有界', () => {
  for (const [kind, key, direction] of [['success', 'joy', 1], ['disappointment', 'sadness', 1], ['interest', 'curiosity', 1], ['fatigue', 'energy', -1]]) {
    const baseline = normalizeInnerLife({}, NOW);
    const state = update(baseline, event(1, kind));
    assert.ok((state.affect[key] - baseline.affect[key]) * direction > 0);
  }
  let state = {};
  for (let seq = 1; seq < 100; seq++) state = update(state, event(seq, 'insult', 3), [message(seq)]);
  for (const key of ['joy', 'anger', 'sadness', 'curiosity', 'energy']) assert.ok(state.affect[key] >= 0 && state.affect[key] <= 100);
});

test('时间让心情自然平复，重启持久化后结果一致，不会重复衰减', () => {
  const angry = update({}, event(1));
  const afterHour = normalizeInnerLife(JSON.parse(JSON.stringify(angry)), NOW + 3600000);
  assert.equal(afterHour.affect.anger, angry.affect.anger / 2);
  const afterTwo = normalizeInnerLife(afterHour, NOW + 2 * 3600000);
  assert.equal(afterTwo.affect.anger, normalizeInnerLife(angry, NOW + 2 * 3600000).affect.anger);
  assert.ok(afterHour.relationships['12345'].irritation > afterHour.affect.anger);
});

test('目标会保存进展、完成/放下/过期；重复创建不重置，不重复完成拿奖励', () => {
  const goal = { action: 'set', title: '弄懂这个有趣的现象', motivation: '确实好奇', nextStep: '找两份可信资料', expiresInHours: 2 };
  let state = update({}, { goal });
  state = update(state, { goal });
  assert.equal(state.goals.length, 1);
  assert.equal(state.nextGoalId, 2);
  state = update(state, { goal: { action: 'progress', id: 'g1', nextStep: '对照已读资料中的两个解释' } });
  assert.match(state.goals[0].nextStep, /对照/);
  assert.equal(normalizeInnerLife(state, NOW + 3 * 3600000).goals[0].status, 'expired');
  const joy = state.affect.joy;
  state = update(state, { goal: { action: 'complete', id: 'g1' } });
  assert.equal(state.goals[0].status, 'done');
  assert.ok(state.affect.joy > joy);
  assert.throws(() => update(state, { goal: { action: 'complete', id: 'g1' } }), /找不到/);
});

test('最多三个目标，错误更新原状态不变，输入经过脱敏', () => {
  let state = {};
  for (let i = 1; i <= 3; i++) state = update(state, { goal: { action: 'set', title: `兴趣${i}`, motivation: '好奇', nextStep: '查资料' } });
  const before = JSON.stringify(state);
  assert.throws(() => update(state, { goal: { action: 'set', title: '第四个', motivation: '好奇', nextStep: '查资料' } }), /最多/);
  assert.equal(JSON.stringify(state), before);
  const result = updateInnerLife({}, event(1, 'interest', 1, 'secret'), { messages: [message(1)], now: NOW, sanitize: (value) => value.replaceAll('secret', '[已脱敏]') });
  assert.equal(result.state.affect.reason, '[已脱敏]');
});

test('冷场不连续独白，低精力减少主动冒泡，提示里能接上目标与分人的边界', () => {
  assert.equal(canInitiateInnerLife({}, { lastIncomingAt: 1, lastAiReplyAt: 2, now: NOW }), false);
  assert.equal(canInitiateInnerLife({}, { lastIncomingAt: 3, lastAiReplyAt: 2, now: NOW }), true);
  let state = update({}, event(1));
  state = update(state, { goal: { action: 'set', title: '弄懂现象', motivation: '好奇', nextStep: '查资料' } });
  const prompt = formatInnerLife(state, { messages: [message(1)], now: NOW });
  assert.match(prompt, /12345/);
  assert.match(prompt, /g1/);
  assert.match(prompt, /不用靠耍宝/);
});

test('实际桥接情绪开关可在主流程作用域运行，遵守角色/记忆/独立人格开关', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src/bridge.js'), 'utf8');
  const match = source.match(/function innerLifeEnabledV2\(st\) \{([\s\S]*?)\n  \}/);
  assert.ok(match);
  const enabled = new Function('cfg', 'readRoleState', 'st', match[1]);
  assert.equal(enabled({}, () => ({ role: '小鲸鱼' }), {}), true);
  assert.equal(enabled({}, () => ({ role: '其他角色' }), {}), false);
  assert.equal(enabled({}, () => ({ role: '小鲸鱼' }), { personaOverride: true }), false);
  assert.equal(enabled({ socialV2: { tools: { memory: false } } }, () => ({ role: '小鲸鱼' }), {}), false);
  assert.equal(enabled({ socialV2: { innerLife: { enabled: false } } }, () => ({ role: '小鲸鱼' }), {}), false);
});

test('实际 MCP→实际 bridge 路由：令牌隔离、开关、状态写盘后恢复；不连接 QQ', async () => {
  const require = createRequire(path.join(process.env.QQ_BRIDGE_DEPENDENCIES || ROOT, 'package.json'));
  const { Client } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')).href);
  const { StdioClientTransport } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href);
  const source = fs.readFileSync(path.join(ROOT, 'src/bridge.js'), 'utf8');
  const start = source.indexOf("        if (req.method === 'POST' && url.pathname === '/api/socialV2/inner-state') {");
  const end = source.indexOf('        if (MEMORY_PATHS.has(url.pathname)) {', start);
  assert.ok(start > 0 && end > start);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const route = new AsyncFunction('req', 'url', 'readBody', 'sendJson', 'agentTokenOk', 'v2SessionAllowed', 'v2ToolEnabled', 'getSocialV2State', 'innerLifeEnabledV2', 'updateInnerLife', 'redactKnownTokensOnly', 'saveSocialV2State', 'formatInnerLife', 'memoryTree', source.slice(start, end));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-inner-life-test-'));
  let enabled = true;
  let saved = 0;
  const state = { recentMessages: [{ ...message(1), time: Date.now() }], unread: [], innerLife: normalizeInnerLife() };
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    try {
      await route(req, new URL(req.url, 'http://localhost'), async () => JSON.parse(raw), (data, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); },
        (key, token) => key === 'group:12345' && token === 'fixture-token', () => true, () => enabled, () => state, () => true, updateInnerLife, (s) => s,
        () => { saved++; fs.writeFileSync(path.join(temp, 'saved.json'), JSON.stringify(state.innerLife)); }, formatInnerLife, {syncGoals:(key,goals)=>{assert.equal(key,'group:12345');assert.ok(Array.isArray(goals));}});
    } catch (error) { res.writeHead(500); res.end(JSON.stringify({ error: error.message })); }
    if (!res.writableEnded) { res.writeHead(404); res.end('{}'); }
  });
  let client;
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = server.address().port;
    fs.mkdirSync(path.join(temp, 'src'));
    for (const file of ['mcp-snowluma-safe.js', 'sensitive.js']) fs.copyFileSync(path.join(ROOT, 'src', file), path.join(temp, 'src', file));
    fs.writeFileSync(path.join(temp, 'package.json'), '{"type":"module"}');
    fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ consolePort: port }));
    const loader = path.join(temp, 'resolve-deps.mjs');
    fs.writeFileSync(loader, `import { registerHooks } from 'node:module'; const parentURL=${JSON.stringify(pathToFileURL(path.join(process.env.QQ_BRIDGE_DEPENDENCIES || ROOT, 'package.json')).href)}; registerHooks({resolve(s,c,next){try{return next(s,c)}catch(error){if(error.code==='ERR_MODULE_NOT_FOUND'&&!s.startsWith('.')&&!s.startsWith('/')&&!s.includes(':'))return next(s,{...c,parentURL});throw error}}});`);
    client = new Client({ name: 'inner-life-offline-test', version: '1.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: ['--import', pathToFileURL(loader).href, path.join(temp, 'src/mcp-snowluma-safe.js')] }));
    const list = await client.listTools();
    assert.ok(list.tools.some((tool) => tool.name === 'qq_update_inner_state'));
    const args = { key: 'group:12345', token: 'fixture-token', ...event(1) };
    const result = await client.callTool({ name: 'qq_update_inner_state', arguments: args });
    assert.ok(!result.isError, result.content?.[0]?.text);
    assert.equal(saved, 1);
    const restored = normalizeInnerLife(JSON.parse(fs.readFileSync(path.join(temp, 'saved.json'), 'utf8')));
    assert.ok(restored.relationships['12345'].irritation > 40);
    const wrongToken = await client.callTool({ name: 'qq_update_inner_state', arguments: { ...args, token: 'wrong-token' } });
    assert.equal(wrongToken.isError, true);
    const wrongKey = await client.callTool({ name: 'qq_update_inner_state', arguments: { ...args, key: 'group:23456' } });
    assert.equal(wrongKey.isError, true);
    enabled = false;
    assert.equal((await client.callTool({ name: 'qq_update_inner_state', arguments: args })).isError, true);
    assert.equal(saved, 1);
    const missingToken = await fetch(`http://127.0.0.1:${port}/api/socialV2/inner-state`, { method: 'POST', body: JSON.stringify(args) });
    assert.equal(missingToken.status, 403);
  } finally {
    if (client) await client.close();
    await new Promise((resolve) => server.close(resolve));
    const resolved = path.resolve(temp);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('qq-inner-life-test-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

// 自主学习区验证：全部用临时数据库 + 本地虚构数据，不碰真实 QQ / 不调模型。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createSelfLearning } from '../src/self-learning.js';

const DAY = 86400000;
const NOW = 1_700_000_000_000;

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'self-learning-test-'));
  const cleanup = () => { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* Windows 下 sqlite 句柄未释放时忽略 */ } };
  return { dir, db: path.join(dir, 'state.sqlite'), cleanup };
}

function open(file, clock = { t: NOW }) {
  const db = new DatabaseSync(file);
  const learning = createSelfLearning({ db, now: () => clock.t, scopeKey: (value) => value });
  return { db, learning, clock };
}

function urlSource(clock, extra = {}) {
  return { type: 'url', url: 'https://example.org/note', fetchedAt: clock.t, digest: 'ab'.repeat(16), ...extra };
}

test('真实工具/消息/网页来源可以收藏，来源按条保存并可回读', (t) => {
  const box = tempDir();
  t.after(box.cleanup);
  const { learning, clock } = open(box.db);
  const entry = learning.collect({
    scope: 'private:10001',
    kind: 'knowledge',
    title: 'SQLite 在线备份',
    content: 'VACUUM INTO 会把 WAL 里已提交的内容一并写出。',
    uncertainty: '未在超大库上验证耗时',
    applicability: '单机 SQLite',
    sources: [
      { type: 'url', url: 'https://sqlite.org/lang_vacuum.html', fetchedAt: clock.t, digest: 'cd'.repeat(20), note: '官方文档' },
      { type: 'tool', refId: 'tool-call-7f21', fetchedAt: clock.t, digest: 'ef'.repeat(20) },
      { type: 'message', refId: 'msg-9981', fetchedAt: clock.t, digest: '01'.repeat(20) }
    ]
  });
  const read = learning.read({ scope: 'private:10001', id: entry.id });
  assert.equal(read.status, 'candidate');
  assert.equal(read.ownerType, 'bot');
  assert.equal(read.sources.length, 3);
  assert.deepEqual(read.sources.map((s) => s.type), ['url', 'tool', 'message']);
  assert.equal(read.sources[1].refId, 'tool-call-7f21');
});

test('伪造来源被拒：缺摘要 / 坏 URL / 未来时间 / 空引用 / 缺来源', (t) => {
  const box = tempDir();
  t.after(box.cleanup);
  const { learning, clock } = open(box.db);
  const base = { scope: 'private:10001', kind: 'knowledge', title: 't', content: 'c' };
  assert.throws(() => learning.collect({ ...base, sources: [] }), /至少需要一个可验证来源/);
  assert.throws(() => learning.collect({ ...base, sources: [{ type: 'url', url: 'https://x.test', fetchedAt: clock.t, digest: 'short' }] }), /可复核摘要/);
  assert.throws(() => learning.collect({ ...base, sources: [{ type: 'url', url: 'ftp://x.test', fetchedAt: clock.t, digest: 'ab'.repeat(16) }] }), /http/);
  assert.throws(() => learning.collect({ ...base, sources: [{ type: 'tool', refId: '', fetchedAt: clock.t, digest: 'ab'.repeat(16) }] }), /引用 ID/);
  assert.throws(() => learning.collect({ ...base, sources: [{ type: 'url', url: 'https://x.test', fetchedAt: clock.t + 10 * 60000, digest: 'ab'.repeat(16) }] }), /未来/);
  assert.throws(() => learning.collect({ ...base, sources: [{ type: 'audio', fetchedAt: clock.t, digest: 'ab'.repeat(16) }] }), /来源类型/);
});

test('会话隔离：另一会话读不到，也不会出现在它的列表里', (t) => {
  const box = tempDir();
  t.after(box.cleanup);
  const { learning, clock } = open(box.db);
  const mine = learning.collect({ scope: 'private:10001', kind: 'knowledge', title: '只属于我', content: 'c', sources: [urlSource(clock)] });
  learning.collect({ scope: 'group:55555', kind: 'knowledge', title: '群里的', content: 'c', sources: [urlSource(clock)] });
  assert.throws(() => learning.read({ scope: 'private:20002', id: mine.id }), /找不到该学习条目/);
  assert.throws(() => learning.startTrial({ scope: 'group:55555', id: mine.id, version: 1 }), /找不到该学习条目/);
  const only = learning.list({ scope: 'private:10001' });
  assert.equal(only.total, 1);
  assert.equal(only.entries[0].title, '只属于我');
  const group = learning.list({ scope: 'group:55555' });
  assert.equal(group.total, 1);
  assert.equal(group.entries[0].title, '群里的');
});

test('状态机：合法迁移通过，非法迁移与过期版本被拒', (t) => {
  const box = tempDir();
  t.after(box.cleanup);
  const { learning, clock } = open(box.db);
  const scope = 'private:10001';
  const entry = learning.collect({ scope, kind: 'knowledge', title: 't', content: 'c', sources: [urlSource(clock)] });
  assert.equal(learning.startTrial({ scope, id: entry.id, version: 1 }).to, 'trial');
  assert.throws(() => learning.startTrial({ scope, id: entry.id, version: 2 }), /版本已过期/);
  assert.equal(learning.pause({ scope, id: entry.id, version: 1 }).to, 'paused');
  assert.throws(() => learning.startTrial({ scope, id: entry.id, version: 1 }), /不允许从 paused 变更到 trial/);
  assert.equal(learning.restore({ scope, id: entry.id, version: 1 }).to, 'candidate');
  assert.equal(learning.startTrial({ scope, id: entry.id, version: 1 }).to, 'trial');
  assert.equal(learning.archive({ scope, id: entry.id, version: 1 }).to, 'archived');
  assert.throws(() => learning.startTrial({ scope, id: entry.id, version: 1 }), /不允许从 archived 变更到 trial/);
  assert.equal(learning.restore({ scope, id: entry.id, version: 1 }).to, 'candidate');
});

test('表达类条目：无真实使用不得留用，五次真实正面使用后可留用', (t) => {
  const box = tempDir();
  t.after(box.cleanup);
  const { learning, clock } = open(box.db);
  const scope = 'private:10001';
  const entry = learning.collect({
    scope, kind: 'style', title: '少用反问收尾', content: '结尾不要每次都用反问句逼对方接话',
    applicability: '闲聊', sources: [{ type: 'message', refId: 'msg-1', fetchedAt: clock.t, digest: 'aa'.repeat(16) }]
  });
  learning.startTrial({ scope, id: entry.id, version: 1 });
  assert.throws(() => learning.retain({ scope, id: entry.id, version: 1 }), /真实适用次数不足/);
  for (let index = 0; index < 5; index++) {
    clock.t += 1000;
    learning.review({ scope, id: entry.id, replyId: 'reply-' + index, outcome: 'positive', conditions: '群聊闲聊' });
  }
  const kept = learning.retain({ scope, id: entry.id, version: 1 });
  assert.equal(kept.to, 'retained');
  const read = learning.read({ scope, id: entry.id });
  assert.equal(read.status, 'retained');
  assert.equal(read.usage.length, 5);
  assert.ok(Number.isSafeInteger(read.retainedAt));
});

test('表达类条目：任何负面证据都会阻止留用', (t) => {
  const box = tempDir();
  t.after(box.cleanup);
  const { learning, clock } = open(box.db);
  const scope = 'private:10001';
  const entry = learning.collect({
    scope, kind: 'style', title: '少用长段落', content: '单条回复不要超过三行',
    sources: [{ type: 'message', refId: 'msg-2', fetchedAt: clock.t, digest: 'bb'.repeat(16) }]
  });
  learning.startTrial({ scope, id: entry.id, version: 1 });
  for (let index = 0; index < 6; index++) {
    clock.t += 1000;
    learning.review({ scope, id: entry.id, replyId: 'reply-' + index, outcome: index === 5 ? 'negative' : 'positive' });
  }
  assert.throws(() => learning.retain({ scope, id: entry.id, version: 1 }), /负面证据/);
});

test('未过期才能留用：试用期过后表达条目不能直接留用', (t) => {
  const box = tempDir();
  t.after(box.cleanup);
  const { learning, clock } = open(box.db);
  const scope = 'private:10001';
  const entry = learning.collect({
    scope, kind: 'style', title: 't', content: '不要在句首加语气词',
    sources: [{ type: 'message', refId: 'msg-3', fetchedAt: clock.t, digest: 'cc'.repeat(16) }]
  });
  learning.startTrial({ scope, id: entry.id, version: 1 });
  for (let index = 0; index < 5; index++) {
    clock.t += 1000;
    learning.review({ scope, id: entry.id, replyId: 'reply-' + index, outcome: 'positive' });
  }
  clock.t += 8 * DAY;
  assert.throws(() => learning.retain({ scope, id: entry.id, version: 1 }), /试用期已过/);
});

test('注入只取试用中且未过期的条目，并遵守条数与字数上限', (t) => {
  const box = tempDir();
  t.after(box.cleanup);
  const { learning, clock } = open(box.db);
  const scope = 'private:10001';
  const make = (title, content, source) => learning.collect({
    scope, kind: 'style', title, content,
    sources: [{ type: 'message', refId: source, fetchedAt: clock.t, digest: 'dd'.repeat(16) }]
  });
  const first = make('A', 'A 原则', 'msg-a');
  const second = make('B', 'B 原则', 'msg-b');
  const third = make('C', 'C 原则', 'msg-c');
  learning.startTrial({ scope, id: first.id, version: 1 });
  learning.startTrial({ scope, id: second.id, version: 1 });
  learning.startTrial({ scope, id: third.id, version: 1 });
  const one = learning.injection({ scope, limit: 1, budget: 200 });
  assert.equal(one.items.length, 1);
  const all = learning.injection({ scope, limit: 3, budget: 200 });
  assert.equal(all.items.length, 3);
  // 暂停后立即停止注入，缓存不需要额外失效动作
  learning.pause({ scope, id: first.id, version: 1 });
  const after = learning.injection({ scope, limit: 3, budget: 200 });
  assert.equal(after.items.length, 2);
  assert.ok(!after.items.some((item) => item.id === first.id));
  // 过期也停止注入
  clock.t += 8 * DAY;
  const expired = learning.injection({ scope, limit: 3, budget: 200 });
  assert.equal(expired.items.length, 0);
});

test('修订创建新版本并归档旧版，来源随版本继承', (t) => {
  const box = tempDir();
  t.after(box.cleanup);
  const { learning, clock } = open(box.db);
  const scope = 'private:10001';
  const first = learning.collect({ scope, kind: 'knowledge', title: '旧标题', content: '旧内容', sources: [urlSource(clock)] });
  clock.t += 1000;
  const second = learning.revise({ scope, id: first.id, version: 1, content: '新内容', reason: '来源有更新' });
  assert.equal(second.version, 2);
  assert.equal(second.parentId, first.id);
  const oldRead = learning.read({ scope, id: first.id });
  assert.equal(oldRead.status, 'archived');
  const newRead = learning.read({ scope, id: second.id });
  assert.equal(newRead.content, '新内容');
  assert.equal(newRead.sources.length, 1);
  assert.equal(newRead.sources[0].url, 'https://example.org/note');
  assert.throws(() => learning.revise({ scope, id: second.id, version: 1, content: 'x' }), /版本已过期/);
});

test('审计是追加式的：每次动作留痕，且记录前后状态', (t) => {
  const box = tempDir();
  t.after(box.cleanup);
  const { learning, clock } = open(box.db);
  const scope = 'private:10001';
  const entry = learning.collect({ scope, kind: 'knowledge', title: 't', content: 'c', sources: [urlSource(clock)] });
  learning.startTrial({ scope, id: entry.id, version: 1, reason: '值得一试' });
  learning.pause({ scope, id: entry.id, version: 1, reason: '暂不需要' });
  const diag = learning.diagnostics({ scope });
  assert.equal(diag.auditCount, 3);
  const rows = learning.__audit ? learning.__audit(scope) : null;
  if (rows) {
    assert.deepEqual(rows.map((row) => row.action), ['collect', 'start_trial', 'pause']);
    assert.equal(rows[1].from_status, 'candidate');
    assert.equal(rows[1].to_status, 'trial');
  }
});

test('重开数据库后数据仍在，迁移可重入且不会重复插表', (t) => {
  const box = tempDir();
  t.after(box.cleanup);
  const scope = 'private:10001';
  const first = open(box.db);
  const entry = first.learning.collect({ scope, kind: 'knowledge', title: '持久化', content: 'c', sources: [urlSource(first.clock)] });
  first.learning.startTrial({ scope, id: entry.id, version: 1 });
  first.db.close();
  const second = open(box.db);
  const read = second.learning.read({ scope, id: entry.id });
  assert.equal(read.status, 'trial');
  assert.equal(second.learning.list({ scope }).total, 1);
  second.db.close();
});

test('总开关关闭时不应产生任何试用注入（调用方不取即为关闭，此处验证空集）', (t) => {
  const box = tempDir();
  t.after(box.cleanup);
  const { learning } = open(box.db);
  assert.deepEqual(learning.injection({ scope: 'private:10001' }).items, []);
});

test('内容与标题有硬上限，表达类内容更短', (t) => {
  const box = tempDir();
  t.after(box.cleanup);
  const { learning, clock } = open(box.db);
  const scope = 'private:10001';
  assert.throws(() => learning.collect({ scope, kind: 'knowledge', title: 'x', content: 'a'.repeat(4001), sources: [urlSource(clock)] }), /超过 4000 字/);
  assert.throws(() => learning.collect({ scope, kind: 'style', title: 'x', content: 'a'.repeat(201), sources: [urlSource(clock)] }), /不能超过 200 字/);
  assert.throws(() => learning.collect({ scope, kind: 'knowledge', title: 'x'.repeat(121), content: 'c', sources: [urlSource(clock)] }), /超过 120 字/);
});

test('同一 scope 多次收集互不影响，overview 统计正确', (t) => {
  const box = tempDir();
  t.after(box.cleanup);
  const { learning, clock } = open(box.db);
  const scope = 'private:10001';
  const a = learning.collect({ scope, kind: 'knowledge', title: 'a', content: 'c', sources: [urlSource(clock)] });
  const b = learning.collect({ scope, kind: 'style', title: 'b', content: 'c', sources: [urlSource(clock)] });
  learning.startTrial({ scope, id: a.id, version: 1 });
  const view = learning.overview({ scope });
  assert.equal(view.counts.candidate, 1);
  assert.equal(view.counts.trial, 1);
  assert.equal(view.recent.length, 2);
  assert.ok(b.id);
});

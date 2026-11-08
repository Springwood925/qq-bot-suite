import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createCompanionObserver } from './companion-observer.mjs';

test('只记录附近指定玩家的行为，过期与关闭后清除', () => {
  let time = 1000;
  const bot = new EventEmitter();
  bot.entity = { position: { distanceTo: p => p.distance } };
  const obs = createCompanionObserver(bot, 'owner', { now: () => time, ttlMs: 100 });
  const block = { name: 'log', position: { distance: 4 } };
  bot.emit('blockBreakProgressEnd', block, { username: 'other' });
  assert.equal(obs.status(), null);
  bot.emit('blockBreakProgressEnd', { ...block, position: { distance: 17 } }, { username: 'owner' });
  assert.equal(obs.status(), null);
  bot.emit('blockBreakProgressEnd', block, { username: 'owner' });
  assert.equal(obs.status().activity, '采集木头');
  time += 101;
  assert.equal(obs.status(), null);
  obs.close();
  bot.emit('blockBreakProgressEnd', block, { username: 'owner' });
  assert.equal(obs.status(), null);
});

test('连续采集只触发一次通知，冷却结束后可以再次触发', () => {
  let time = 1000;
  const events = [];
  const bot = new EventEmitter();
  bot.entity = { position: { distanceTo: () => 2 } };
  const obs = createCompanionObserver(bot, 'owner', { now: () => time, notifyIntervalMs: 100, onActivity: e => events.push(e) });
  const block = { name:'log', position:{} };
  bot.emit('blockBreakProgressEnd', block, {username:'owner'});
  time += 50;
  bot.emit('blockBreakProgressEnd', block, {username:'owner'});
  assert.equal(events.length, 1);
  time += 50;
  bot.emit('blockBreakProgressEnd', block, {username:'owner'});
  assert.equal(events.length, 2);
  obs.close();
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTurnController } from './turn-controller.mjs';

test('新发言打断旧识别，即使识别器忽略取消也不会播放旧回复', async () => {
  let finishOld, played = [];
  const c = createTurnController({
    transcribe: a => a === 'old' ? new Promise(r => { finishOld = r; }) : Promise.resolve('新发言'),
    respond: async text => text + '回复',
    speak: async text => { played.push(text); },
  });
  const old = c.submit('old');
  const fresh = await c.submit('new');
  finishOld('旧发言');
  assert.deepEqual(await old, { interrupted: true });
  assert.equal(fresh.reply, '新发言回复');
  assert.deepEqual(played, ['新发言回复']);
});

test('结束通话后迟到的结果不会继续执行，且拒绝新输入', async () => {
  let finish, spoken = false;
  const c = createTurnController({ transcribe: () => new Promise(r => { finish = r; }), respond: async () => '好', speak: async () => { spoken = true; } });
  const result = c.submit('audio'); c.close(); finish('你好');
  assert.deepEqual(await result, { interrupted: true });
  assert.equal(spoken, false);
  await assert.rejects(c.submit('again'), /已结束/);
});

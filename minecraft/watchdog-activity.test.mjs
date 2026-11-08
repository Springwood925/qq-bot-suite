import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createWatchdog} from './watchdog.mjs';

test('游戏活动只有监听开启时才发送，并通过现有事件链路', async () => {
  const bot = new EventEmitter();
  bot.entity = {position:{x:1,y:64,z:2}};
  bot.health = 20;
  const events = [];
  const w = createWatchdog(bot, {log:()=>{}, onWake:async e=>events.push(e), opts:{observeWindowMs:5,wakeOn:{heartbeat:false}}});
  w.companionActivity({activity:'采集木头',block:'log'});
  w.arm();
  w.companionActivity({activity:'未知',block:'stone'});
  w.companionActivity({activity:'采集木头',block:'log'});
  await new Promise(r=>setTimeout(r,30));
  assert.equal(events.length,1);
  assert.deepEqual(events[0].reasons,['companionActivity']);
  assert.match(events[0].events[0].text,/采集木头/);
  w.disarm();
});

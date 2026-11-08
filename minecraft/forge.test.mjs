import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import forge from 'minecraft-protocol-forge';

test('Forge 服务端状态触发握手安装，普通服务端不受影响', () => {
  const client = new EventEmitter();
  forge.autoVersionForge(client);
  assert.equal(client.autoVersionHooks.length, 1);
  client.autoVersionHooks[0]({}, client, {});
  assert.equal(client.listenerCount('custom_payload'), 0);
  client.autoVersionHooks[0]({modinfo:{type:'FML',modList:[]}}, client, {});
  assert.equal(client.listenerCount('custom_payload'), 1);
  assert.equal(client.tagHost, '\0FML\0');
});

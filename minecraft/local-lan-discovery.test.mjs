import {test} from 'node:test';import assert from 'node:assert/strict';
import {portsForProcesses,pickUniqueMinecraftPort} from './local-lan-discovery.mjs';
test('只取指定 Java 进程的监听端口并去重',()=>{
 const raw='  TCP    0.0.0.0:60683   0.0.0.0:0   LISTENING   42\n  TCP [::]:60683 [::]:0 LISTENING 42\n  TCP 127.0.0.1:1234 0.0.0.0:0 LISTENING 99\n  TCP 127.0.0.1:500 127.0.0.1:600 ESTABLISHED 42';
 assert.deepEqual(portsForProcesses(raw,[42]),[60683]);
});
test('只有唯一的 1.12.2 服务才返回端口',async()=>{
 const ping=async p=>({version:{protocol:p===10?340:47}});
 assert.equal(await pickUniqueMinecraftPort([10,11],ping),10);
 assert.equal(await pickUniqueMinecraftPort([10,10],ping),null);
 assert.equal(await pickUniqueMinecraftPort([11],ping),null);
});

import {test} from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';const {patch}=createRequire(import.meta.url)('./ensure-door-pathfinder-patch.cjs');
test('安装后应用门路径点补丁，并保持幂等',()=>{const source='  function getPositionOnTopOf (block) {\n    if (!block || block.shapes.length === 0) return null\n    return block\n  }\n';const once=patch(source);assert.match(once,/open door.s thin vertical panel/);assert.equal(patch(once),once)});
test('上游实现变化时拒绝盲改',()=>assert.throws(()=>patch('changed source'),/不匹配/));

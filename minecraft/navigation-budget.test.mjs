import {test} from 'node:test';
import assert from 'node:assert/strict';
import {navigationTimeout,followNeedsUnstick} from './navigation-budget.mjs';
test('长距离寻路获得更多时间且始终有上限',()=>{
 const from={x:0,y:64,z:0};
 assert.equal(navigationTimeout(from,{x:2,y:64,z:0}),12000);
 assert.equal(navigationTimeout(from,{x:50,y:64,z:0}),33000);
 assert.equal(navigationTimeout(from,{x:1000,y:64,z:0}),50000);
 assert.equal(navigationTimeout(null,{x:1,y:2,z:3}),12000);
});
test('跟随时有进展不应误判卡住',()=>{
 assert.equal(followNeedsUnstick(3,8),false);assert.equal(followNeedsUnstick(0.1,8),true);assert.equal(followNeedsUnstick(0.1,3),false);
});

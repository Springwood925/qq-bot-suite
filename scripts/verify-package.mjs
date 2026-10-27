// 校验真正安装/解压出的包，避免仅后端更新或前端版本错配。
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const pkg=JSON.parse(read('package.json')),ui=read('client.js'),host=read('lib/index.js'),tree=read('bridge/src/memory-tree.js'),extensions=read('bridge/src/memory-tree-extensions.js'),bridge=read('bridge/src/bridge.js');
assert.equal(pkg.version,'0.3.2');assert.ok(ui.includes("const UI_VERSION = '"+pkg.version+"'"),'界面版本应与安装包一致');
for(const text of ['function MemoryManager(',"h(MemoryManager,",'人物好感度','批量审核','全选当前页待核实','打开记忆树 / 好感度 / 批量审核'])assert.ok(ui.includes(text),'缺少界面：'+text);
assert.ok(host.includes('packageVersion: PACKAGE_VERSION'));assert.ok(host.includes("'/api/socialV2/memory-admin'"));
assert.ok(tree.includes("import { createAffinity } from './affinity.js'"));assert.ok(tree.includes('batchReview:true'));assert.ok(extensions.includes("action==='batchReview'"));assert.ok(bridge.includes('ownerQQ:()=>cfg.ownerQQ'));
assert.ok(fs.existsSync(path.join(root,'bridge/src/affinity.js')));assert.equal(pkg.exports['./client'],'./client.js');assert.equal(pkg.dsh.client.immediately,true);
console.log(JSON.stringify({passed:true,version:pkg.version,memoryTreeUI:true,affinityUI:true,batchReviewUI:true,frontendBackendTogether:true},null,2));

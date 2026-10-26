import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createMemoryDatabase} from '../src/memory-database.js';
import {createMemoryTree} from '../src/memory-tree.js';
function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-maintenance-'));
  t.after(()=>{assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(dir).startsWith('qq-maintenance-'));fs.rmSync(dir,{recursive:true,force:true});});
  return path.join(dir,'test.sqlite');
}
test('SQL 缓存有界、复用语句但不缓存数据',t=>{
  const file=fixture(t),db=createMemoryDatabase(file,{cacheLimit:2,checkpointIntervalMs:0});
  try {
    db.exec('CREATE TABLE t(value);INSERT INTO t VALUES (1)');
    const first=db.prepare('SELECT value FROM t');assert.equal(first.get().value,1);
    db.exec('UPDATE t SET value=2');assert.equal(db.prepare('SELECT value FROM t'),first);assert.equal(first.get().value,2);
    for(let i=0;i<20;i++)db.prepare('SELECT '+i).get();
    assert.equal(db.diagnostics().cached,2);assert.equal(db.diagnostics().hits,1);
  } finally {db.close();db.close();}
  assert.throws(()=>db.prepare('SELECT 1'),/已关闭/);
});
test('检查点保留数据、恢复忙等待设置且不进入正在进行的事务',t=>{
  const file=fixture(t),db=createMemoryDatabase(file,{checkpointIntervalMs:0,walThresholdBytes:1});
  try {
    db.exec('PRAGMA journal_mode=WAL;PRAGMA busy_timeout=3000;CREATE TABLE t(value);INSERT INTO t VALUES (42)');
    db.exec('BEGIN IMMEDIATE');assert.equal(db.checkpoint({force:true}).skipped,true);db.exec('COMMIT');
    assert.equal(db.checkpoint().busy,0);assert.equal(fs.statSync(file+'-wal').size,0);
    assert.equal(db.prepare('SELECT value FROM t').get().value,42);assert.equal(db.prepare('PRAGMA busy_timeout').get().timeout,3000);
  } finally {db.close();}
});
test('长读事务存在时检查点立即退让，读者可继续读旧快照，下一次可收缩',t=>{
  const file=fixture(t),db=createMemoryDatabase(file,{checkpointIntervalMs:0,walThresholdBytes:1});
  db.exec('PRAGMA journal_mode=WAL;PRAGMA busy_timeout=3000;CREATE TABLE t(value);INSERT INTO t VALUES (1)');
  const reader=new DatabaseSync(file);
  try {
    reader.exec('BEGIN');assert.equal(reader.prepare('SELECT value FROM t').get().value,1);
    db.exec('UPDATE t SET value=2');const start=performance.now();
    assert.equal(db.checkpoint().busy,1);assert.ok(performance.now()-start<1000);
    assert.equal(reader.prepare('SELECT value FROM t').get().value,1);
    assert.equal(db.prepare('PRAGMA busy_timeout').get().timeout,3000);
    reader.exec('COMMIT');assert.equal(db.checkpoint().busy,0);assert.equal(fs.statSync(file+'-wal').size,0);
    assert.equal(db.prepare('SELECT value FROM t').get().value,2);
  } finally {reader.close();db.close();}
});
test('定期检查点会执行，关闭后不会留下维护任务',async t=>{
  const file=fixture(t),db=createMemoryDatabase(file,{checkpointIntervalMs:15,walThresholdBytes:1});
  db.exec('PRAGMA journal_mode=WAL;CREATE TABLE t(value);INSERT INTO t VALUES (1)');
  await new Promise(resolve=>setTimeout(resolve,60));
  assert.equal(fs.statSync(file+'-wal').size,0);db.close();
  await new Promise(resolve=>setTimeout(resolve,30));assert.equal(db.diagnostics().closed,true);
});
test('重复回放人物观察不写 WAL，但更新昵称和真实新时间仍然生效',t=>{
  const file=fixture(t),tree=createMemoryTree({file,now:()=>1800000000000}),scope='group:12345';
  const m={userId:'12345',sender:'旧昵称',time:1799999999000};
  const reader=new DatabaseSync(file);
  try {
    tree.observe(scope,[m]);reader.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    const before=reader.prepare('SELECT * FROM people').all();
    for(let i=0;i<100;i++)tree.observe(scope,[m]);
    assert.equal(fs.statSync(file+'-wal').size,0);assert.deepEqual(reader.prepare('SELECT * FROM people').all(),before);
    tree.observe(scope,[{...m,sender:'新昵称',time:m.time+1000}]);
    tree.observe(scope,[{...m,sender:'更早昵称',time:m.time-1000}]);
    const row=reader.prepare('SELECT * FROM people').get();assert.deepEqual(JSON.parse(row.aliases),['更早昵称','旧昵称','新昵称']);assert.equal(row.last_seen,m.time+1000);
  } finally {reader.close();tree.close();}
});
test('密集写入合并后台索引任务，语义内容和遗忘屏障依然生效',async t=>{
  const file=fixture(t);let calls=0;
  const embeddings={status:()=>({model:'fake'}),embed:async texts=>{calls++;return texts.map(()=>Array.from({length:512},(_,i)=>i===0?1:0));}};
  const tree=createMemoryTree({file,embeddings}),scope='group:12345';
  try {
    const ids=[];
    for(let i=0;i<10;i++)ids.push(tree.recordObservation(scope,{messageId:String(i),vision:{status:'ok',images:[{description:'虚构蓝色鲸鱼'+i,visible_text:[],uncertain:[]}]},images:[{data:'fake'+i}]}).record.id);
    await new Promise(resolve=>setTimeout(resolve,100));assert.equal(calls,1);
    tree.forget(scope,ids[0]);const result=await tree.search(scope,{q:'蓝色鲸鱼'});assert.ok(!result.records.some(r=>r.id===ids[0]));
    tree.close();await new Promise(resolve=>setTimeout(resolve,40));
  } finally {tree.close();}
});

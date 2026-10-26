import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {test} from 'node:test';
const root=path.resolve(process.argv[2]||path.join(path.dirname(fileURLToPath(import.meta.url)),'..'));
const bridge=fs.readFileSync(path.join(root,'src/bridge.js'),'utf8');
function extract(source,name,next){const a=source.indexOf(`  function ${name}(`),b=source.indexOf(`  function ${next}(`,a);assert.ok(a>=0&&b>a);return source.slice(a,b);}
const memory=new Function(extract(bridge,'formatMemoryV2','appendMemoryV2')+'return formatMemoryV2;')();
const {formatInnerLife,updateInnerLife}=await import(pathToFileURL(path.join(root,'src/inner-life.js')).href);
const fixture={activeTopics:Array.from({length:10},(_,i)=>({text:`话题${i}`,lastMentionAt:Date.now()})),pendingThoughts:Array.from({length:10},(_,i)=>({text:`想法${i}`})),memberImpressions:{甲:{traits:['旧细节0','旧细节1','近期细节2','近期细节3','近期细节4']},乙:{traits:['另一个人的往事']}},recentMessages:[{sender:'乙',userId:'22'},...Array.from({length:26},()=>({sender:'甲',userId:'11',text:'最近发言'}))],unread:[]};
test('唤醒只取当前参与者的近期事实，完整记忆仍可读取且原状态不变',()=>{
  const before=JSON.stringify(fixture),full=memory(fixture),short=memory(fixture,{compact:true});
  assert.match(full,/另一个人的往事/);assert.match(full,/旧细节0/);
  assert.doesNotMatch(short,/另一个人的往事|旧细节0|旧细节1/);
  for(const s of ['近期细节2','近期细节3','近期细节4','甲(11)','qq_memory_query'])assert.ok(short.includes(s));
  assert.equal((short.match(/- 话题/g)||[]).length,3);assert.equal((short.match(/- 想法/g)||[]).length,3);
  assert.equal(JSON.stringify(fixture),before);assert.equal(memory(fixture),full);assert.ok(short.length<full.length);
});
test('未读的新参与者不会被摘要裁掉，机器人自己说过的名字不作为在场证明',()=>{
  const st=structuredClone(fixture);st.unread=[{sender:'乙',userId:'22'}];assert.match(memory(st,{compact:true}),/另一个人的往事/);
  st.unread=[];st.recentMessages.push({sender:'乙',userId:'22',isSelf:true});assert.doesNotMatch(memory(st,{compact:true}),/另一个人的往事/);
});
test('情绪摘要保留情绪、对象边界、目标及下一步，省去重复说明且不改存档',()=>{
  const now=Date.now(),messages=[{seq:1,userId:'11111',isSelf:false,time:now,text:'实际事件'}];
  const {state}=updateInnerLife({}, {appraisal:{sourceSeq:1,kind:'insult',intensity:2,reason:'已经明确拒绝，仍持续辱骂'},goal:{action:'set',title:'研究一个现象',motivation:'好奇',nextStep:'对照两份资料'}},{messages,now});
  const before=JSON.stringify(state),full=formatInnerLife(state,{messages,now}),short=formatInnerLife(state,{messages,now,compact:true});
  for(const s of ['恼火','QQ 11111','研究一个现象','对照两份资料','sourceSeq'])assert.ok(short.includes(s),s);
  assert.ok(short.length<full.length-150);assert.equal(JSON.stringify(state),before);
});
test('实际唤醒装配使用摘要，但仍携带完整角色、表情提醒和动态等待协议',()=>{
  const deps={cfg:{socialV2:{wake:{preSleepWaitMs:60000},sticker:{}}},readRoleState:()=>({role:'小鲸鱼'}),getSocialV2State:()=>({...fixture,msgsSinceSticker:28,wakeConfig:{}}),innerLifeEnabledV2:()=>true,currentRoleHintV2:()=> '严禁 AI 八股；完整角色保留',formatMemoryV2:memory,formatParticipationV2:()=>'',formatInnerLife,buildStickerStrategyHint:()=>'',buildStickerContext:()=>'',stickerEntries:[],buildStickerDueLineV2:()=> '表情提醒',looksLikeUnfinished:()=>false,buildAgentPrivilegeLine:()=>''};
  const wake=new Function(...Object.keys(deps),extract(bridge,'buildWakePromptV2','buildWakeReminderPromptV2')+'return buildWakePromptV2;')(...Object.values(deps));
  const text=wake('group:1','message');
  for(const s of ['严禁 AI 八股','完整角色保留','表情提醒','timeoutMs=60000','近期细节4'])assert.ok(text.includes(s),s);
  assert.doesNotMatch(text,/旧细节0|另一个人的往事|目标只在现有权限内推进/);
});

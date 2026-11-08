const bool=v=>v===true||v==='true'?true:v===false||v==='false'?false:null;
export async function interactBlock(bot,block,{wait=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
 if(!block||!block.position)return {ok:false,error:'目标方块未加载'};
 const name=String(block.name||''), door=/(?:^|_)(?:door|trapdoor|fence_gate)$/.test(name),switchBlock=/(?:^|_)(?:button|lever)$/.test(name);
 if(!door&&!switchBlock){try{await bot.activateBlock(block);return {ok:true,action:'useBlock',block:name,verified:false,note:'交互请求已发送，具体效果需核实。'}}catch(e){return {ok:false,error:'交互失败：'+String(e.message||e),block:name}}}
 if(door&&/^iron_door$/.test(name))return {ok:false,error:'铁门不能直接右键打开，先检查按钮、拉杆或红石'};
 let target=block;
 if(door&&/door$/.test(name)&&!name.includes('trapdoor')&&Number(block.metadata)&8){const lower=bot.blockAt(block.position.offset(0,-1,0));if(lower?.name===name)target=lower;}
 function observed(b){if(!b)return null;let p={};try{p=b.getProperties?.()||{}}catch{}let value=bool(door?p.open:p.powered);if(value!==null)return value;
  if(/^1\.12(?:\.|$)/.test(String(bot.version||''))&&Number.isInteger(b.metadata)){if(door)return !!(b.metadata&4);if(switchBlock)return !!(b.metadata&8);}return null;}
 const before=observed(target);
 try{await bot.activateBlock(target);await wait(150);const afterBlock=bot.blockAt(target.position),after=observed(afterBlock);
  if((door||switchBlock)&&before!==null&&after!==null&&before!==after)return {ok:true,action:'interact',block:name,before,after};
  return {ok:false,uncertain:true,action:'interact',block:name,before,after,note:'已请求交互，但状态变化未确认；请重新观察，不要据此声称已打开。'};
 }catch(e){return {ok:false,error:'交互失败：'+String(e.message||e),block:name};}
}

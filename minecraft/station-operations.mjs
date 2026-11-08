export function createStationOperations({timeoutMs=18000}={}) {
 let busy=false;
 const view=i=>i?{name:i.name,count:i.count,metadata:i.metadata??0}:null;
 const total=(items,it)=>items.filter(x=>x.type===it.type&&(x.metadata??0)===(it.metadata??0)).reduce((n,x)=>n+x.count,0);
 async function run(bot,block,{operation='inspect',name,count=1}={}) {
  if(busy)throw Error('另一容器操作尚未结束');
  if(bot.currentWindow)throw Error('已有容器界面打开，请先关闭');
  if(!block||!['furnace','lit_furnace','enchanting_table'].includes(block.name))throw Error('不支持的方块');
  if(bot.entity.position.distanceTo(block.position)>4.5)throw Error('距离太远，请先走近');
  if(!Number.isInteger(count)||count<1||count>64)throw Error('数量必须为 1 到 64 的整数');
  busy=true;let window=null,expired=false,timer;
  const task=(async()=>{
   try{
    if(block.name==='enchanting_table'){
     if(!['enchant-options','enchant-apply'].includes(operation))throw Error('请选择附魔选项或执行附魔');
     if(!name)throw Error('需要指定背包中的物品英文名');
     window=await bot.openEnchantmentTable(block);if(expired)throw Error('打开附魔台超时');
     const target=window.items().find(i=>i.name===name);if(!target)throw Error('背包中没有 '+name);
     const old=JSON.stringify(target.nbt||null);
     await window.putTargetItem(target);
     if(operation==='enchant-apply'){
      if(count>3)throw Error('附魔选项须为 1、2 或 3');
      const lapis=window.items().find(i=>(i.name==='dye' && i.metadata===4) || i.name==='lapis_lazuli');
      if(!lapis||lapis.count<count)throw Error('青金石不足');
      await window.putLapis(lapis);
     }
     const available=()=>window.enchantments?.length===3&&window.enchantments.every(v=>v.level>=0);
     if(!available())await new Promise((resolve,reject)=>{let t;const done=()=>{clearTimeout(t);window.removeListener('ready',done);resolve();};window.once('ready',done);t=setTimeout(()=>{window.removeListener('ready',done);reject(Error('附魔选项读取超时'));},5000);});
     const offers=window.enchantments.map((v,i)=>({choice:i+1,level:v.level,expected:v.expected}));
     if(operation==='enchant-options')return {ok:true,action:operation,offers,experienceLevel:Number.isFinite(bot.experience?.level)?bot.experience.level:null};
     if(offers[count-1].level<=0)throw Error('该附魔选项不可用');
     if(!Number.isFinite(bot.experience?.level))throw Error('无法确认当前经验等级，未执行附魔');
     if(bot.experience.level<offers[count-1].level)throw Error(`经验不足，需要 ${offers[count-1].level} 级，当前 ${bot.experience.level} 级`);
     const result=await window.enchant(count-1);
     const changed=JSON.stringify(result?.nbt||null)!==old;
     return {ok:changed,action:operation,item:name,choice:count,...(!changed?{reason:'执行后未能确认附魔变化，请检查物品'}:{})};
    }
    window=await bot.openFurnace(block);if(expired)throw Error('打开熔炉超时');
    const state=()=>({input:view(window.inputItem()),fuel:view(window.fuelItem()),output:view(window.outputItem()),progress:window.progress});
    if(operation==='furnace-inspect')return {ok:true,action:operation,...state()};
    if(['furnace-take','furnace-take-input','furnace-take-fuel'].includes(operation)){
      const pick=operation==='furnace-take'?['outputItem','takeOutput']:operation==='furnace-take-input'?['inputItem','takeInput']:['fuelItem','takeFuel'];
      const before=window[pick[0]]();if(!before)throw Error('对应熔炉槽位为空');
      const n=total(window.items(),before);await window[pick[1]]();const after=total(window.items(),before);
      return {ok:after>n,action:operation,item:before.name,amount:after-n,...state(),...(after<=n?{reason:'未确认产物进入背包'}:{})};
    }
    if(!['furnace-input','furnace-fuel'].includes(operation)||!name)throw Error('需要指定熔炉操作和背包物品');
    const chosen=window.items().find(i=>i.name===name);if(!chosen)throw Error('背包中没有 '+name);
    if(total(window.items(),chosen)<count)throw Error('背包数量不足');
    const prior=total(window.items(),chosen);
    if(operation==='furnace-input')await window.putInput(chosen.type,chosen.metadata??0,count);
    else await window.putFuel(chosen.type,chosen.metadata??0,count);
    const after=total(window.items(),chosen),slot=operation==='furnace-input'?window.inputItem():window.fuelItem();
    return {ok:prior-after===count&&!!slot,action:operation,item:name,requested:count,...state(),...(prior-after!==count||!slot?{reason:'投入后数量变化未确认'}:{})};
   } finally {
    const cleanupErrors=[];
    if(window && block.name==='enchanting_table'){
     try{if(window.targetItem())await window.takeTargetItem();}catch(e){cleanupErrors.push('目标物品：'+e.message);}
     try{if(window.slots?.[1])await bot.putAway(1);}catch(e){cleanupErrors.push('青金石：'+e.message);}
    }
    try{window?.close();}catch{} busy=false;
    if(cleanupErrors.length)throw Error('附魔台物品回收未确认，请检查背包和地面：'+cleanupErrors.join('；'));
   }
  })();
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;try{window?.close();}catch{}reject(Error('操作超时，结果未确认；请检查容器与背包'));},timeoutMs);});
  try{return await Promise.race([task,timeout]);}finally{clearTimeout(timer);}
 }
 return {run,isBusy:()=>busy};
}

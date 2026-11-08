const tally=items=>{
 const out=new Map();for(const i of items){const key=`${i.type}:${i.maxDurability>0?'durable':(i.metadata??0)}`;const prev=out.get(key)||{name:i.name,id:i.type,metadata:i.metadata??0,count:0};prev.count+=i.count;out.set(key,prev)}return out;
};
export async function digWithHarvestCheck(bot,target,{wait=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
 if(!target||['air','cave_air','void_air'].includes(target.name))return {ok:false,error:'那里没有方块'};
 if(['water','flowing_water','lava','flowing_lava'].includes(target.name))return {ok:false,error:'目标是液体，不能像普通方块一样挖掘；先检查液体来源和安全退路',block:target.name};
 if(target.name==='bedrock')return {ok:false,error:'基岩挖不动'};
 if(/(?:^|_)(?:chest|shulker_box|barrel)$/.test(target.name))return {ok:false,error:'这是储物容器，不能通过挖掘工具破坏',block:target.name};
 const feet=bot.entity?.position, pos=target.position;
 if(feet&&pos&&[feet.x,feet.y,feet.z,pos.x,pos.y,pos.z].every(Number.isFinite)&&Math.hypot(feet.x-pos.x-.5,feet.y+1.62-pos.y-.5,feet.z-pos.z-.5)>4.5)
  return {ok:false,error:'目标超出挖掘距离，请先走近并重新检查方块',block:target.name};
 if(feet&&pos&&Math.floor(feet.x)===pos.x&&Math.floor(feet.z)===pos.z&&pos.y===Math.floor(feet.y)-1)
  return {ok:false,error:'目标是脚下支撑方块，未挖掘；请先移动到安全位置',block:target.name};
 const falling=b=>b && /^(?:sand|red_sand|gravel|anvil|concrete_powder)$/.test(b.name);
 if(typeof target.position?.offset==='function') {
  const above=bot.blockAt(target.position.offset(0,1,0));
  if(falling(above))return {ok:false,error:'目标正上方有会下落的方块，未挖掘；请从安全侧面自上而下处理沙砾',block:target.name,above:above.name};
  const p=bot.entity?.position;
  if(falling(target)&&p && Math.floor(p.x)===target.position.x && Math.floor(p.z)===target.position.z && target.position.y>=Math.floor(p.y)+1)
   return {ok:false,error:'头顶的沙砾可能落在身上，未挖掘；请从安全侧面处理',block:target.name};
 }
 let selected=bot.heldItem;
 if(bot.game?.gameMode!=='creative' && target.harvestTools) {
  const matches=i=>!!i && !!target.harvestTools[i.type];
  // Save higher-tier pickaxe durability for blocks that require it.
  const ordinary=['stone','cobblestone','coal_ore','iron_ore'].includes(target.name);
  const economical=ordinary?bot.inventory.items().find(i=>i.name==='stone_pickaxe'&&matches(i)):null;
  if(economical && selected?.type!==economical.type) {
   try{await bot.equip(economical,'hand');selected=economical}catch(e){return {ok:false,error:'装备采集工具失败：'+String(e?.message||e)}}
  }
  if(!matches(selected)) {
   selected=bot.inventory.items().find(matches);
   if(!selected)return {ok:false,error:'没有可收获该方块的工具，未挖掘',block:target.name};
   try{await bot.equip(selected,'hand')}catch(e){return {ok:false,error:'装备采集工具失败：'+String(e?.message||e)}}
  }
  if(!matches(bot.heldItem))return {ok:false,error:'无法确认已手持合适工具，未挖掘',block:target.name};
 }
 const before=tally(bot.inventory.items());
 try {await bot.dig(target)}catch(e){return {ok:false,error:'挖掘未完成：'+String(e?.message||e),block:target.name};}
 await wait(700);
 const after=tally(bot.inventory.items()),gained=[];
 for(const [key,item] of after){const delta=item.count-(before.get(key)?.count||0);if(delta>0)gained.push({...item,count:delta});}
 const current=bot.blockAt(target.position);
 return {ok:true,action:'dig',block:target.name,original:{name:target.name,metadata:target.metadata??null,position:{x:target.position.x,y:target.position.y,z:target.position.z}},tool:bot.heldItem?.name||null,locallyAir:!!current&&['air','cave_air','void_air'].includes(current.name),gained,pickupObserved:gained.length>0,note:'记录原方块与坐标供必要时恢复；普通放置不保证还原状态。挖掘结束不等于服务器确认，背包增量可能来自其他掉落。'};
}

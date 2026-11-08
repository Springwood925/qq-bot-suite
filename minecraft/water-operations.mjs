const AIR=new Set(['air','cave_air','void_air']);
export async function waterOperation(bot,{operation,position,makePos,wait=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 const p=bot?.entity?.position;
 if(!p||!position||!['x','y','z'].every(k=>Number.isInteger(position[k]))||typeof makePos!=='function')return {ok:false,error:'需要整数目标坐标'};
 if(Math.hypot(p.x-position.x-.5,p.y-position.y,p.z-position.z-.5)>4.5)return {ok:false,error:'距离太远，请先走近'};
 if(bot.currentWindow||bot.isSleeping)return {ok:false,error:'请先关闭容器并起床'};
 const {x,y,z}=position,at=(x,y,z)=>bot.blockAt(makePos(x,y,z),false),target=at(x,y,z);
 if(!target)return {ok:false,error:'目标方块未加载'};
 const items=()=>bot.inventory.items(),count=n=>items().filter(i=>i.name===n).reduce((a,i)=>a+i.count,0);
 if(operation==='fill'){
  if(!['water','flowing_water'].includes(target.name)||target.metadata!==0)return {ok:false,error:'需要确认是水源方块，不能从流动水取水'};
  const bucket=items().find(i=>i.name==='bucket'&&i.count>0);if(!bucket)return {ok:false,error:'没有空桶，可先查配方制作铁桶'};
  const before=count('water_bucket');
  try{await bot.equip(bucket,'hand');await bot.lookAt(makePos(x+.5,y+.5,z+.5),true);bot.activateItem();await wait(1000);const after=count('water_bucket');return after>before?{ok:true,action:'waterFill',waterBuckets:after}:{ok:false,uncertain:true,error:'已尝试取水但未确认水桶增加，请先检查背包'};}catch(e){return {ok:false,uncertain:true,error:'取水结果未确认，请先检查背包：'+String(e.message||e)}}
 }
 if(operation==='pour'){
  if(!AIR.has(target.name))return {ok:false,error:'放水位置不是空方块'};
  const support=at(x,y-1,z);if(!support||support.boundingBox!=='block')return {ok:false,error:'目标下方没有可确认的支撑方块'};
  const bucket=items().find(i=>i.name==='water_bucket'&&i.count>0);if(!bucket)return {ok:false,error:'背包没有水桶'};
  try{await bot.equip(bucket,'hand');await bot.activateBlock(support);await wait(750);const after=at(x,y,z);return after&&['water','flowing_water'].includes(after.name)?{ok:true,action:'waterPour',position,actual:after.name,metadata:after.metadata??null}:{ok:false,uncertain:true,error:'已尝试放水但未确认目标出现水，请先检查现场和背包'};}catch(e){return {ok:false,uncertain:true,error:'放水结果未确认，请先检查现场：'+String(e.message||e)}}
 }
 return {ok:false,error:'未知水桶操作'};
}

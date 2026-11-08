export function createFishOperations({timeoutMs=45000}={}) {
 let busy=false,generation=0;
 const counts=items=>Object.fromEntries(items.reduce((m,i)=>m.set(i.name,(m.get(i.name)||0)+i.count),new Map()));
 async function run(bot,water){
  if(busy)throw Error('正在钓鱼');
  if(!water||!['water','flowing_water'].includes(water.name))throw Error('请指定可见的水方块');
  if(bot.entity.position.distanceTo(water.position)>20)throw Error('水面太远');
  const rod=bot.inventory.items().find(i=>i.name==='fishing_rod');if(!rod)throw Error('背包没有钓鱼竿');
  busy=true;const turn=++generation;let timer,expired=false,cast=false,reeled=false;
  const before=counts(bot.inventory.items());
  const task=(async()=>{try{
    await bot.equip(rod,'hand');await bot.lookAt(water.position.offset(0.5,0.3,0.5),true);
    if(expired)throw Error('钓鱼已超时');
    cast=true;await bot.fish();reeled=true;
    if(expired)throw Error('钓鱼已超时');
    await new Promise(r=>setTimeout(r,1200));
    const after=counts(bot.inventory.items());const gains=Object.entries(after).filter(([k,n])=>n>(before[k]||0)).map(([name,n])=>({name,count:n-(before[name]||0)}));
    return {ok:true,action:'fish',gains,note:gains.length?'检测到背包增加物品':'鱼漂已收回，尚未确认物品进入背包'};
  }finally{if(turn===generation)busy=false;}})();
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;if(cast&&!reeled&&bot.heldItem?.name==='fishing_rod'){try{bot.activateItem();}catch{}}if(turn===generation)busy=false;reject(Error('钓鱼超时；没有确认钓获，不能仅凭超时判断水域太小'));},timeoutMs);});
  try{return await Promise.race([task,timeout]);}finally{clearTimeout(timer);}
 }
 return {run,isBusy:()=>busy};
}

// Chest interactions are serialized because Mineflayer has one active window.
export function createChestOperations({timeoutMs=15000}={}) {
  let busy=false;
  const sum=(items,type,meta)=>items.filter(i=>i.type===type && (i.metadata??0)===meta).reduce((n,i)=>n+i.count,0);
  const describe=i=>({name:i.name,count:i.count,metadata:i.metadata??0});
  async function run(bot,block,{take,put,count=1}={}) {
    if(busy) throw Error('另一个箱子操作尚未结束');
    if(bot.currentWindow) throw Error('已有容器界面打开，请先关闭');
    if(!block || !['chest','trapped_chest'].includes(block.name)) throw Error('目标不是受支持的原版箱子');
    if(take && put) throw Error('一次只能取出或存入');
    const transfer=Boolean(take||put);
    if(transfer && (!Number.isInteger(count)||count<1||count>64)) throw Error('数量必须为 1 到 64 的整数');
    if(transfer && bot.entity.position.distanceTo(block.position)>4.5) throw Error('箱子太远，请先走近');
    if(!transfer && bot.entity.position.distanceTo(block.position)>4.5) throw Error('箱子太远，请先走近');
    busy=true;
    let expired=false, window=null, timer;
    const operation=(async()=>{
      try {
        window=await bot.openContainer(block);
        if(expired) throw Error('箱子打开超时');
        const contents=()=>window.containerItems();
        if(!transfer) return {ok:true,action:'chestList',items:contents().map(describe)};
        const name=String(take||put).trim();
        const inventory=()=>window.items();
        const items=take?contents():inventory();
        const selected=items.find(i=>i.name===name);
        if(!selected) throw Error((take?'箱子':'背包')+'中没有该物品：'+name);
        const type=selected.type, meta=selected.metadata??0;
        const beforeChest=sum(contents(),type,meta),beforeInv=sum(inventory(),type,meta);
        if((take?beforeChest:beforeInv)<count) throw Error('同类型物品数量不足');
        if(take) await window.withdraw(type,meta,count,selected.nbt||null);
        else await window.deposit(type,meta,count,selected.nbt||null);
        const afterChest=sum(contents(),type,meta),afterInv=sum(inventory(),type,meta);
        const verified=take ? beforeChest-afterChest===count && afterInv-beforeInv===count : afterChest-beforeChest===count && beforeInv-afterInv===count;
        return {ok:verified,action:take?'chestTake':'chestPut',item:name,metadata:meta,requested:count,beforeChest,afterChest,beforeInv,afterInv,...(!verified?{reason:'操作已发出，但物品数量变化未能确认，请重新查看箱子与背包'}:{})};
      } finally { try{window?.close();}catch{} busy=false; }
    })();
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;try{window?.close();}catch{}reject(Error('箱子操作超时；结果尚未确认，请检查箱子和背包'));},timeoutMs);});
    try{return await Promise.race([operation,timeout]);}finally{clearTimeout(timer);}
  }
  return {run,isBusy:()=>busy};
}
